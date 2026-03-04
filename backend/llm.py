"""
Gemini LLM for DataPilot
Uses GOOGLE_API_KEY from .env
"""
import os


def get_gemini():
    """Return a Gemini chat model. Requires GOOGLE_API_KEY in .env."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise ValueError(
            "GOOGLE_API_KEY is not set. Add it to your .env file. "
            "Get a key at https://aistudio.google.com/apikey"
        )
    from langchain_google_genai import ChatGoogleGenerativeAI
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    # max_retries=1: no retries on 429 – fail fast instead of burning more quota (0 = SDK default 5 retries!)
    return ChatGoogleGenerativeAI(model=model, api_key=api_key, max_retries=1)
