import os
from google import genai
from dotenv import load_dotenv

load_dotenv()
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY"))

for model in client.models.list():
    print(f"Model: {model.name}, Actions: {model.supported_actions}")
