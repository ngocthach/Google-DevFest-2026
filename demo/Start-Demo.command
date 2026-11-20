#!/bin/bash
cd "$(dirname "$0")" || exit 1
if [ ! -x .venv/bin/python ]; then
  echo 'First-time setup: creating a Python virtual environment and installing dependencies...'
  python3 -m venv .venv || exit 1
fi
if ! .venv/bin/python -c "import google.adk, fastapi, uvicorn, dotenv, python_socks" >/dev/null 2>&1; then
  .venv/bin/python -m pip install -r requirements.txt || exit 1
fi
if ! .venv/bin/python -c "from config import configure_google_credentials; exit(0 if configure_google_credentials() else 1)"; then
  echo 'Enter your Google AI Studio Gemini API key (input is hidden):'
  read -rs GOOGLE_API_KEY
  echo
  export GOOGLE_API_KEY
fi
if ! .venv/bin/python -c "from config import configure_google_credentials; exit(0 if configure_google_credentials() else 1)"; then echo 'API key is required.'; exit 1; fi
echo 'Open http://127.0.0.1:8766 in a WebMCP-compatible Chrome. Keep this window open.'
exec .venv/bin/python -m uvicorn server:app --host 127.0.0.1 --port 8766 --loop asyncio
