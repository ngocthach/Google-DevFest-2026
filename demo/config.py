"""Shared Gemini settings and local credential loading for both demos."""
import os
from pathlib import Path
from dotenv import load_dotenv


DEMO_RESPONSE_LANGUAGE = (
    'Reply in natural Vietnamese by default, including spoken responses, '
    'even if the input contains English or the audio is unclear. '
    'Use English only when the user explicitly asks for an English reply. '
    'Use no other response languages. Keep names and IDs as shown in the design. '
    'If you cannot understand the request, ask the user to repeat it in Vietnamese '
    'unless they have explicitly requested English.'
)


def get_google_model(*, voice: bool) -> str:
    if voice:
        return os.getenv('GOOGLE_LIVE_MODEL', 'gemini-3.8-live')
    return os.getenv('GOOGLE_MODEL', 'gemini-4-hydrogen')


def configure_google_credentials():
    demo = Path(__file__).resolve().parent
    # Explicit process variables win. The nearest .env wins over its parents.
    for directory in (demo, demo.parent, demo.parent.parent):
        load_dotenv(directory / '.env', override=False)
    # Gemini's SDK accepts GOOGLE_API_KEY; also support the user's chosen name.
    if not os.environ.get('GOOGLE_API_KEY') and os.environ.get('GOOGLE_AI_API_KEY'):
        os.environ['GOOGLE_API_KEY'] = os.environ['GOOGLE_AI_API_KEY']
    return bool(os.environ.get('GOOGLE_API_KEY'))
