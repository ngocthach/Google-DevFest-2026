"""Google ADK bidirectional Live session; tools remain in the current browser tab."""
import asyncio
import base64
from google.adk.agents import LiveRequestQueue, RunConfig
from google.adk.agents.run_config import StreamingMode
from google.genai import types
from starlette.websockets import WebSocketDisconnect

async def run_voice(ws, runner, app_name, sid, pending):
    queue = LiveRequestQueue()
    config = RunConfig(streaming_mode=StreamingMode.BIDI, response_modalities=['AUDIO'],
                       input_audio_transcription=types.AudioTranscriptionConfig(),
                       output_audio_transcription=types.AudioTranscriptionConfig())
    async def receive():
        while True:
            msg = await ws.receive()
            if msg['type'] == 'websocket.disconnect':
                break
            if msg.get('bytes'):
                queue.send_realtime(types.Blob(data=msg['bytes'], mime_type='audio/pcm;rate=16000'))
            elif msg.get('text'):
                import json
                data = json.loads(msg['text'])
                if data.get('type') == 'tool_result':
                    future = pending.get(data.get('id'))
                    if future and not future.done(): future.set_result(data.get('result'))
    async def send():
        ready = False
        async for event in runner.run_live(user_id='local', session_id=sid, live_request_queue=queue, run_config=config):
            if not ready:
                ready = True
                await ws.send_json({'type':'ready'})
            if event.content:
                for part in event.content.parts or []:
                    if part.inline_data and part.inline_data.data:
                        await ws.send_json({'type':'audio','data':base64.b64encode(part.inline_data.data).decode()})
            for field, role in [('input_transcription','user'), ('output_transcription','agent')]:
                transcription = getattr(event, field, None)
                if transcription and transcription.text:
                    await ws.send_json({'type':'transcript','role':role,'text':transcription.text})
            if getattr(event, 'interrupted', False): await ws.send_json({'type':'interrupted'})
    tasks = [asyncio.create_task(receive()), asyncio.create_task(send())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            exc = task.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                print('Live session error:', type(exc).__name__, str(exc)[:500], flush=True)
                try: await ws.send_json({'type':'error','message':'Không kết nối được Gemini Live. Kiểm tra quyền model, mạng và log; dùng chat chữ nếu cần.'})
                except Exception: pass
    finally:
        queue.close()
        for task in tasks: task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for future in pending.values():
            if not future.done(): future.cancel()
