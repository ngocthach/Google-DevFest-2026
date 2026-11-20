"""Start and supervise both local demos without killing unrelated processes."""
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / '.venv/bin/python'
SERVICES = (
    ('RoomLab', 8766, [str(PYTHON), '-m', 'uvicorn', 'server:app', '--host', '127.0.0.1', '--port', '8766', '--loop', 'asyncio'], ROOT / 'demo'),
    ('ArchMorph ADK', 8767, [str(PYTHON), '-m', 'uvicorn', 'adk_bridge:app', '--host', '127.0.0.1', '--port', '8767', '--loop', 'asyncio'], ROOT / 'ArchMorph'),
    ('ArchMorph', 3001, ['npm', 'run', 'dev', '--', '--port', '3001', '--hostname', '127.0.0.1'], ROOT / 'ArchMorph'),
)

def available(port):
    with socket.socket() as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind(('127.0.0.1', port))
            return True
        except OSError:
            return False

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'both'
    if mode not in ('roomlab', 'archmorph', 'both'):
        print('Usage: run_demos.py [roomlab|archmorph|both]'); return 2
    services = SERVICES[:1] if mode == 'roomlab' else SERVICES[1:] if mode == 'archmorph' else SERVICES
    busy = [f'{name} ({port})' for name, port, *_ in services if not available(port)]
    if busy:
        print('Cannot start: these ports are already in use: ' + ', '.join(busy), flush=True)
        print('Stop the existing servers, then run this command again. No processes were stopped.', flush=True)
        return 1
    processes = []
    with tempfile.TemporaryDirectory(prefix='devfest-demos-') as temp:
        try:
            for name, port, command, cwd in services:
                log = open(Path(temp) / f'{port}.log', 'w+')
                proc = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                processes.append((name, port, proc, log))
            print('Starting selected demo services; the first build may take a minute…', flush=True)
            deadline = time.monotonic() + 120
            pending = {port for _, port, *_ in services}
            while pending and time.monotonic() < deadline:
                for name, port, proc, _ in processes:
                    if proc.poll() is not None:
                        print(f'{name} stopped during startup (exit {proc.returncode}).', flush=True)
                        return 1
                    if port in pending:
                        try:
                            with socket.create_connection(('127.0.0.1', port), timeout=.2):
                                pending.remove(port)
                        except OSError:
                            pass
                if pending: time.sleep(.3)
            if pending:
                print('Startup timed out on: ' + ', '.join(str(p) for p in sorted(pending)), flush=True)
                return 1
            print('\nReady. Open in a WebMCP-compatible Chrome:', flush=True)
            if mode != 'archmorph': print('  RoomLab:   http://127.0.0.1:8766/', flush=True)
            if mode != 'roomlab': print('  ArchMorph: http://127.0.0.1:3001/studio', flush=True)
            print('\nKeep this terminal open. Press Ctrl+C to stop the selected demo.', flush=True)
            while True:
                for name, _, proc, _ in processes:
                    if proc.poll() is not None:
                        print(f'\n{name} stopped (exit {proc.returncode}); stopping the other demo processes.', flush=True)
                        return 1
                time.sleep(.5)
        except KeyboardInterrupt:
            print('\nStopping demo servers…', flush=True)
            return 0
        finally:
            for _, _, proc, _ in processes:
                try: os.killpg(proc.pid, signal.SIGTERM)
                except ProcessLookupError: pass
            for _, _, proc, log in processes:
                try: proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try: os.killpg(proc.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                    proc.wait()
                log.close()

if __name__ == '__main__':
    sys.exit(main())
