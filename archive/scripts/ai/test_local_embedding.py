import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add backend to path
sys.path.append(str(Path(__file__).resolve().parent.parent / 'backend'))

# Load env before imports that might use it
load_dotenv()

from dashboard.services.ai_handler import call_embedding

def test_local_embedding():
    print("Testing Local Embedding (sentence-transformers)...")
    
    # Test single text
    text = "FDA regulated drug labeling information."
    emb = call_embedding(text)
    if emb:
        print(f"Single text success! Dimension: {len(emb)}")
        print(f"First 5 values: {emb[:5]}")
    else:
        print("Single text failed.")

    # Test batch
    texts = ["Aspirin is for pain.", "Metformin is for diabetes."]
    embs = call_embedding(texts)
    if embs and len(embs) == 2:
        print(f"Batch success! Got {len(embs)} embeddings.")
        print(f"First embedding dimension: {len(embs[0])}")
    else:
        print("Batch failed.")

if __name__ == "__main__":
    try:
        import sentence_transformers
        import torch
        test_local_embedding()
    except ImportError:
        print("Error: sentence-transformers or torch not installed.")
        print("Please run: pip install sentence-transformers torch")
