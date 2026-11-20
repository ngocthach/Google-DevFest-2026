"""Local RoomLab ADK server. WebMCP calls execute in the connected browser tab."""
import asyncio
import os
import uuid
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types
from config import DEMO_RESPONSE_LANGUAGE, configure_google_credentials, get_google_model
from starlette.exceptions import HTTPException

configure_google_credentials()
from gemini_network import configure_gemini_network
configure_gemini_network()

app = FastAPI()

@app.websocket('/voice')
@app.websocket('/ws')
async def chat(socket: WebSocket):
    origin = socket.headers.get('origin', '')
    if origin not in ('http://127.0.0.1:8766', 'http://localhost:8766'):
        await socket.close(code=1008)
        return
    await socket.accept()
    pending = {}
    lock = asyncio.Lock()
    session_id = str(uuid.uuid4())
    async def call_browser(name, arguments):
        call_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        pending[call_id] = future
        try:
            await socket.send_json({'type': 'tool_call', 'id': call_id, 'name': name, 'arguments': arguments})
            return await asyncio.wait_for(future, timeout=30)
        except asyncio.TimeoutError:
            return {'error': 'BROWSER_TIMEOUT', 'message': 'The page did not return a WebMCP result.'}
        finally:
            pending.pop(call_id, None)
    async def inspect_plan() -> dict:
        """Read the current shared plan, room IDs, dimensions, and revision."""
        return await call_browser('inspect_plan', {})
    async def resize_room(id: str, width: float, height: float, expectedRevision: int) -> dict:
        """Resize a room in metres. Inspect first and use the latest revision. App rejects overlaps."""
        return await call_browser('resize_room', {'id': id, 'width': width, 'height': height, 'expectedRevision': expectedRevision})
    async def create_room(id: str, name: str, x: float, y: float, width: float, height: float, expectedRevision: int) -> dict:
        """Create a room in metres at (x, y), measured from the top-left. Inspect first and use the latest revision. Rejects overlap or outside the 12 by 10 plot."""
        return await call_browser('create_room', {'id': id, 'name': name, 'x': x, 'y': y, 'width': width, 'height': height, 'expectedRevision': expectedRevision})
    async def place_furniture(roomId: str, kind: str, expectedRevision: int, position: str = 'auto') -> dict:
        """Place furniture to scale in a room. Kinds: sofa, chair, table, desk, bed, bookshelf, plant, lamp. Position: auto, left, center, right. Inspect first and use the current revision. Footprints use preset approximate dimensions in metres; overlaps and out-of-room placements are rejected."""
        return await call_browser('place_furniture', {'roomId':roomId,'kind':kind,'position':position,'expectedRevision':expectedRevision})
    async def move_furniture(roomId: str, furnitureId: str, x: float, y: float, expectedRevision: int) -> dict:
        """Move an existing item in its current room. Use inspect_plan for IDs and current revision. x and y are the centre as fractions from the room top-left, 0–1. Overlap and boundary checks are enforced."""
        return await call_browser('move_furniture', {'roomId':roomId,'furnitureId':furnitureId,'x':x,'y':y,'expectedRevision':expectedRevision})
    async def undo_last_edit() -> dict:
        """Undo the last saved room or furniture edit only when the user requests undo."""
        return await call_browser('undo_last_edit', {})
    agent = Agent(
        name='roomlab_agent',
        model=get_google_model(voice=socket.url.path == '/voice'),
        instruction=(
            'You help the user edit the shared RoomLab plan. Always inspect before edits, use the '
            'current revision, respect errors, and never claim an edit succeeded when rejected. '
            f'Explain results briefly. {DEMO_RESPONSE_LANGUAGE}'
        ),
        tools=[inspect_plan, resize_room, create_room, place_furniture, move_furniture, undo_last_edit],
    )
    runner = InMemoryRunner(agent=agent, app_name='roomlab')
    await runner.session_service.create_session(app_name='roomlab', user_id='local', session_id=session_id)
    if socket.url.path == '/voice':
        from voice_live import run_voice
        await run_voice(socket, runner, 'roomlab', session_id, pending)
        return
    async def run_turn(message):
        async with lock:
            try:
                if not os.getenv('GOOGLE_API_KEY'):
                    await socket.send_json({'type':'error','message':'Set GOOGLE_API_KEY in the terminal before starting the server.'})
                    return
                content=types.Content(role='user', parts=[types.Part(text=message)])
                async for event in runner.run_async(user_id='local', session_id=session_id, new_message=content):
                    if event.is_final_response() and event.content:
                        text=''.join(part.text or '' for part in event.content.parts or [])
                        if text: await socket.send_json({'type':'answer','text':text})
            except Exception as exc:
                await socket.send_json({'type':'error','message':f'Agent error: {type(exc).__name__}. Check your API key and model access.'})
            finally:
                await socket.send_json({'type':'done'})
    tasks=set()
    try:
        while True:
            data=await socket.receive_json()
            if data.get('type')=='tool_result':
                future=pending.get(data.get('id'))
                if future and not future.done(): future.set_result(data.get('result'))
            elif data.get('type')=='chat' and isinstance(data.get('text'),str):
                task=asyncio.create_task(run_turn(data['text'][:4000]));tasks.add(task);task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:
        pass
    finally:
        for task in tasks: task.cancel()
        for future in pending.values():
            if not future.done(): future.cancel()

class SafeStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        if any(part.startswith('.') for part in Path(path).parts):
            raise HTTPException(status_code=404)
        return await super().get_response(path, scope)

app.mount('/', SafeStaticFiles(directory=Path(__file__).parent, html=True), name='site')
