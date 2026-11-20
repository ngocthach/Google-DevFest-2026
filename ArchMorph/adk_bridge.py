"""Local-only ADK bridge; tool calls execute through the connected tab's WebMCP API."""
import asyncio, json, os, uuid, sys
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent / "output/demo"))
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from google.adk.agents import Agent
from google.adk.runners import InMemoryRunner
from google.genai import types
from config import DEMO_RESPONSE_LANGUAGE, get_google_model

for path in (Path(__file__).parent / '.env', Path(__file__).parent.parent / '.env'):
    load_dotenv(path, override=False)
if not os.getenv('GOOGLE_API_KEY') and os.getenv('GOOGLE_AI_API_KEY'):
    os.environ['GOOGLE_API_KEY'] = os.environ['GOOGLE_AI_API_KEY']

from gemini_network import configure_gemini_network
configure_gemini_network()

CORE_READ_TOOLS = {'inspect_project','inspect_floor','inspect_circulation','inspect_room','inspect_wall','validate_layout','__discover__'}
app=FastAPI()

@app.websocket('/voice')
@app.websocket('/ws')
async def chat(ws: WebSocket):
    if ws.headers.get('origin') not in {'http://localhost:3000','http://127.0.0.1:3000','http://localhost:3001','http://127.0.0.1:3001'}:
        await ws.close(code=1008);return
    await ws.accept(); pending={}; tasks=set(); lock=asyncio.Lock(); sid=str(uuid.uuid4()); summary_mode=False
    async def request_browser(name, arguments):
        if summary_mode and name not in CORE_READ_TOOLS:
            return {'status':'error','error':'Changes are disabled while preparing the summary.'}
        ident=str(uuid.uuid4()); future=asyncio.get_running_loop().create_future();pending[ident]=future
        try:
            await ws.send_json({'type':'tool_call','id':ident,'name':name,'arguments':arguments})
            return await asyncio.wait_for(future,45)
        except asyncio.TimeoutError:
            return {'status':'error','error':'Browser did not respond to the tool request.'}
        finally: pending.pop(ident,None)
    async def inspect_project() -> dict:
        """Inspect the current project and obtain stable floor IDs and overall validation."""
        return await request_browser('inspect_project', {})
    async def inspect_floor(floorId: str, detail: str = 'summary') -> dict:
        """Inspect the rooms, walls and openings of one floor using its actual ID; detail is summary or full."""
        return await request_browser('inspect_floor', {'floorId':floorId,'detail':detail})
    async def inspect_room(roomId: str) -> dict:
        """Inspect exact room geometry, wall IDs, openings and adjacent rooms."""
        return await request_browser('inspect_room', {'roomId':roomId})
    async def inspect_wall(wallId: str) -> dict:
        """Inspect a wall's endpoints, length, adjacent rooms and existing openings."""
        return await request_browser('inspect_wall', {'wallId':wallId})
    async def inspect_circulation() -> dict:
        """Inspect entrance reachability, room-to-room doors, stairs and disconnected rooms."""
        return await request_browser('inspect_circulation', {})
    async def validate_layout() -> dict:
        """Check geometry, access, openings and stair findings for the full project."""
        return await request_browser('validate_layout', {})
    async def create_room(floorId: str, name: str, roomType: str, x: float, y: float, width: float, length: float) -> dict:
        """Create an explicitly requested room in feet. roomType is one of Living Room, Kitchen, Bedroom, Bathroom, Garage, Office, Dining Room, Storage, Courtyard, Custom. Obtain floor ID from inspection."""
        return await request_browser('create_room', {'floorId':floorId,'name':name,'roomType':roomType,'x':x,'y':y,'width':width,'length':length})
    async def move_room(roomId: str, x: float, y: float) -> dict:
        """Move an existing room to exact x/y in feet. Inspect the room and lower floor first. The app rejects overlap, out-of-plot edits and moves that worsen upper-floor overhang."""
        return await request_browser('move_room', {'roomId':roomId,'x':x,'y':y})
    async def add_door(wallId: str, offset: float, width: float = 3) -> dict:
        """Add a requested door to an inspected canonical wall. offset is the door center measured in feet from wall start. Inspect existing openings first."""
        return await request_browser('add_door', {'wallId':wallId,'offset':offset,'width':width})
    async def add_window(wallId: str, offset: float, width: float = 4, windowType: str = 'fixed') -> dict:
        """Add a requested window to an inspected exterior wall. offset is its center measured in feet from wall start. Inspect existing openings first."""
        return await request_browser('add_window', {'wallId':wallId,'offset':offset,'width':width,'windowType':windowType})
    async def create_floor(name: str = '', height: float = 9) -> dict:
        """Create the next storey only when the user explicitly asks. Height is in feet, between 7 and 16; default 9. Inspect the project first. The new floor becomes active."""
        args = {'height': height}
        if name.strip(): args['name'] = name.strip()
        return await request_browser('create_floor', args)
    async def set_navigation_mode(mode: str, roomId: str = '', roomName: str = '') -> dict:
        """Enter first-person Walk or exterior orbit mode. For a named room, supply BOTH its exact name and its real inspected roomId; inspect floors and rooms first. The name and ID are verified before switching. Omit both to enter Walk without a requested destination."""
        if bool(roomId.strip()) != bool(roomName.strip()):
            return {'status':'error','error':'For a specific room, inspect it first and provide both its exact name and room ID.'}
        args = {'mode': mode}
        if roomId.strip():
            result = await request_browser('inspect_room', {'roomId':roomId.strip()})
            # WebMCP implementations may return JSON text, a direct object, or content blocks.
            if isinstance(result, str):
                try: result=json.loads(result)
                except (ValueError,TypeError): pass
            if isinstance(result, dict) and isinstance(result.get('content'), list):
                texts=[part.get('text') for part in result['content'] if isinstance(part,dict) and isinstance(part.get('text'),str)]
                if texts:
                    try: result=json.loads(texts[0])
                    except (ValueError,TypeError): pass
            room = result.get('room', {}) if isinstance(result,dict) else {}
            actual = room.get('name', '') if isinstance(room,dict) else ''
            if actual.casefold().strip() != roomName.casefold().strip():
                return {'status':'error','error':f'Room ID does not match the requested name {roomName!r}. Inspect the floors and use the exact ID.'}
            args['roomId'] = roomId.strip()
        return await request_browser('set_navigation_mode', args)
    async def switch_view(mode: str) -> dict:
        """Switch the shared canvas to 2d or 3d when the user asks."""
        return await request_browser('switch_view', {'mode':mode})
    async def set_active_floor(floorId: str) -> dict:
        """Switch active floor to an ID obtained from inspection."""
        return await request_browser('set_active_floor', {'floorId':floorId})
    async def focus_element(elementId: str) -> dict:
        """Focus the visible view on an inspected element ID."""
        return await request_browser('focus_element', {'elementId':elementId})
    async def list_archmorph_tools(group: str = 'all', name: str = '') -> dict:
        """Discover native Studio tools. Groups: inspect, layout, connections, site, presentation. Use all for group counts. Pass name to get the exact input schema for one tool."""
        return await request_browser('__discover__', {'group': group, 'name': name})
    async def run_archmorph_tool(name: str, arguments_json: str = '{}') -> dict:
        """Call a discovered native Studio tool. Pass its arguments as a JSON object string matching the discovered input schema."""
        try:
            args = json.loads(arguments_json)
        except (ValueError, TypeError):
            return {'status': 'error', 'error': 'arguments_json must contain a valid JSON object.'}
        if not isinstance(args, dict) or not name or name.startswith('__'):
            return {'status': 'error', 'error': 'Supply a native Studio tool name and a JSON object.'}
        return await request_browser(name, args)
    async def propose_room_layout(roomId: str, goal: str, areaPercent: float = 20, neighborRoomId: str = '') -> dict:
        """Read-only geometry search. Goals: move without coordinates, shrink or grow by areaPercent, or rebalance (shrink roomId and grow neighborRoomId). Returns tested plans and separately approvable partial alternatives."""
        args = {'roomId':roomId,'goal':goal,'areaPercent':areaPercent}
        if neighborRoomId:
            args['neighborRoomId'] = neighborRoomId
        return await request_browser('propose_room_layout', args)
    async def rebalance_rooms(roomId: str, neighborRoomId: str, areaPercent: float = 20) -> dict:
        """Use for one request to shrink one room and expand a second. Supply both inspected room IDs and the percentage reduction in area. Tests both goals together without saving."""
        return await propose_room_layout(roomId, 'rebalance', areaPercent, neighborRoomId)
    async def preview_room_growth(roomId: str, areaPercent: float = 25) -> dict:
        """Preview expanding just the named room. Use when the user asks to grow a single room. Do not select a donor room."""
        return await propose_room_layout(roomId, 'grow', areaPercent)
    layout_instruction = (
        'HIGHEST PRIORITY FOR LAYOUT: if the user names two rooms and asks to reduce one and expand the other, '
        'call rebalance_rooms with both IDs before answering. A blocked shrink alone does not answer the expansion request. '
        'For an expansion of one room use preview_room_growth, never rebalance. '
        'When a tool returns no_complete_plan but alternatives is nonempty, ALWAYS immediately name the best '
        'alternative and speak its before and after area in Vietnamese, then ask whether to apply that alternative. '
        'When the user approves it, use the exact changes and expectedVersion from that alternative. '
        'ArchMorph area numbers are in square feet. In Vietnamese audio say “feet vuông” after every area number. '
        'Never say “mét vuông” for an unchanged square-foot value. Keep lengths in feet. '
        'Describe upper-floor footprint overlap as modeled geometry. Never say there is a structural problem or that '
        'there is physical support. Do not translate footprint as dấu chân. '

        'Discover native tools by relevant group, then inspect their schema by name before calling. '
        'For room moves with a delegated position, area percentages, or coordinated shrink/grow requests, '
        'use inspect_floor with summary to resolve IDs, then call propose_room_layout directly. It checks floors and validation. Never ask for x/y when the user delegated placement. '
        'Report the suggested plan and its actual sizes. When requested to make the full edit, apply the best complete '
        'checked plan by calling apply_changes with its exact expectedVersion and changes. '
        'If no complete plan passes, report blockers and offer the best partial alternative; do not apply a partial edit '
        'without separate approval. Do not silently substitute rooms. Distinguish Guest Lounge from Family Living. '
        'Preview multi-step edits with preview_changes and commit them together with apply_changes only if there are no '
        'new errors or newly unsupported upper-floor footprints. Keep authorization specific. '
        'For purposes of validation, a new occupied room must include its connecting door in the same batch. '
        'If the user asks for the full Creative Studio demo (room and openings), use a single batch for the room, door '
        'and window with the existing preset geometry. For that preset only, the new shared wall is '
        'wall-floor-e0df61af-h-5000-600-1600 and the new west wall is wall-floor-e0df61af-v-600-5000-6200. '
        'Preview the full batch before applying, inspect its results and then switch view. '
    )
    agent=Agent(name='archmorph_assistant',model=get_google_model(voice=ws.url.path == '/voice'),instruction=(layout_instruction + 'You are an architectural concept-design assistant in ArchMorph. Inspect before changing the design and use real floor, room and wall IDs from tool results. The tools run in the shared browser page via WebMCP. Only make explicitly requested edits. Before adding, moving, or resizing upper-floor rooms, inspect the floor immediately below and preserve its modeled footprint. If a tool rejects an overhang, report it and do not claim success. Geometric footprint alignment does not establish structural safety. To enter Walk use set_navigation_mode with mode walk; if a named Walk destination is requested, inspect the relevant floor and pass both the exact roomName and the matching roomId to set_navigation_mode; never infer or guess an ID. If the verification fails, inspect again. For ordinary 3D use switch_view with mode 3d, and for Plan use 2d. Create a floor only on explicit request and report the actual result. Work sequentially, inspect wall geometry and existing openings before adding doors or windows; report errors and never invent success. Do not make substitutes unless asked. ArchMorph uses feet. Validation is conceptual, not building-code certification. If the user asks about reachability or circulation, call inspect_circulation before stating a conclusion. Never say you checked circulation unless you actually called inspect_circulation. For the prepared Sukoon House — Studio Demo (terrace removed) only, if the user asks for the Creative Studio demo, the agreed brief is: on First Floor create an Office named Creative Studio at x 6, y 50, width 10 and length 12 feet. If asked for its connecting door, use its shared wall with Bedroom West, 3 feet wide at center offset 2 feet. If asked for its window, use its west exterior wall, casement type, 4 feet wide at center offset 2 feet. Inspect the project and actual walls before each operation. Do not use these demo defaults for other projects or other room names. Only perform each operation after the user asks for it. ' + DEMO_RESPONSE_LANGUAGE),tools=[inspect_project,inspect_floor,inspect_room,inspect_wall,inspect_circulation,validate_layout,create_room,move_room,add_door,add_window,create_floor,set_navigation_mode,switch_view,set_active_floor,focus_element,list_archmorph_tools,run_archmorph_tool,propose_room_layout,rebalance_rooms,preview_room_growth])
    runner=InMemoryRunner(agent=agent,app_name='archmorph_demo');await runner.session_service.create_session(app_name='archmorph_demo',user_id='local',session_id=sid)
    if ws.url.path == '/voice':
        from voice_live import run_voice
        await run_voice(ws, runner, 'archmorph_demo', sid, pending)
        return
    async def turn(prompt):
        nonlocal summary_mode
        async with lock:
            try:
                if not os.getenv('GOOGLE_API_KEY'):
                    await ws.send_json({'type':'error','message':'Set GOOGLE_AI_API_KEY or GOOGLE_API_KEY in the project .env.'});return
                async def run_message(message):
                    answered=False
                    async for event in runner.run_async(user_id='local',session_id=sid,new_message=types.Content(role='user',parts=[types.Part(text=message)])):
                        if event.is_final_response() and event.content:
                            answer=''.join(part.text or '' for part in event.content.parts or [])
                            if answer.strip():
                                await ws.send_json({'type':'answer','text':answer});answered=True
                    return answered
                if not await run_message(prompt):
                    summary_mode=True
                    try:
                        answered=await run_message('Summarize the actual results of the previous request, including failures and validation. Do not make any changes or switch the view.')
                    finally:
                        summary_mode=False
                    if not answered:
                        await ws.send_json({'type':'error','message':'The agent returned no summary. Inspect the visible tool results and ask it to summarize before continuing.'})
            except Exception as e:
                await ws.send_json({'type':'error','message':f'ADK error ({type(e).__name__}). Check server log and Gemini access.'})
                detail=str(e)
                for key in ('GOOGLE_API_KEY','GOOGLE_AI_API_KEY'):
                    secret=os.getenv(key)
                    if secret: detail=detail.replace(secret,'[redacted]')
                print('ADK error:',type(e).__name__,detail[:1500],flush=True)
            finally:await ws.send_json({'type':'done'})
    try:
        while True:
            msg=await ws.receive_json()
            if msg.get('type')=='tool_result':
                f=pending.get(msg.get('id'))
                if f and not f.done():f.set_result(msg.get('result'))
            elif msg.get('type')=='chat' and isinstance(msg.get('text'),str):
                task=asyncio.create_task(turn(msg['text'][:4000]));tasks.add(task);task.add_done_callback(tasks.discard)
    except WebSocketDisconnect:pass
    finally:
        for task in tasks:task.cancel()
        for f in pending.values():
            if not f.done():f.cancel()
