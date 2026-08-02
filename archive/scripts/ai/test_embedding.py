import os
import sys
from pathlib import Path

# Add backend to path
sys.path.append(str(Path(__file__).resolve().parent.parent / 'backend'))

from dashboard.services.ai_handler import call_embedding

def test():
    text = "Drug labeling information for FDA review."
    embedding = call_embedding(text)
    if embedding:
        print(f"Success! Embedding length: {len(embedding)}")
        print(f"First 5 values: {embedding[:5]}")
    else:
        print("Failed to generate embedding.")

if __name__ == "__main__":
    test()
