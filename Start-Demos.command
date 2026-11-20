#!/bin/bash
set -e
cd "$(dirname "$0")"
mode="${1:-both}"
if ! command -v python3 >/dev/null || ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Python 3, Node.js 22+ and npm are required.'; exit 1
fi
if [ ! -x .venv/bin/python ]; then
  echo 'Creating the Python environment...'; python3 -m venv .venv
fi
if ! .venv/bin/python -c 'import google.adk, fastapi, uvicorn, dotenv, python_socks' >/dev/null 2>&1; then
  echo 'Installing Python dependencies (first run)...'
  .venv/bin/python -m pip install -r demo/requirements.txt
fi
if [ "$mode" != roomlab ] && [ ! -x ArchMorph/node_modules/.bin/vinext ]; then
  echo 'Installing ArchMorph dependencies (first run)...'
  (cd ArchMorph && npm ci --no-audit --no-fund)
fi
if ! .venv/bin/python -c 'import sys; sys.path.insert(0,"demo"); from config import configure_google_credentials; raise SystemExit(0 if configure_google_credentials() else 1)'; then
  echo 'Enter your Google AI Studio API key (hidden):'
  read -rs GOOGLE_API_KEY; echo; export GOOGLE_API_KEY
  if [ -z "$GOOGLE_API_KEY" ]; then echo 'API key is required.'; exit 1; fi
fi
exec .venv/bin/python run_demos.py "$mode"
