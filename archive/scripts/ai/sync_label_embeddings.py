import os
import sys
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from dotenv import load_dotenv
import logging
import time
import torch

# Setup Logging
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("sync_embeddings_multigpu.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Add backend to path to import ai_handler
sys.path.append(str(Path(__file__).resolve().parent.parent / 'backend'))

from dashboard.services.ai_handler import _get_local_model

# Load environment variables
load_dotenv()

def chunk_text(text, max_words=500):
    """Splits text into chunks of max_words for embedding."""
    if not text: return []
    words = text.split()
    return [" ".join(words[i:i + max_words]) for i in range(0, len(words), max_words)]

def sync_embeddings_multigpu(batch_size=256, labels_per_batch=50):
    """
    High-performance sync using all available GPUs.
    Processes labels in large batches to keep multiple GPUs saturated.
    """
    database_url = os.getenv('DATABASE_URL')
    model_name = os.getenv("LOCAL_EMBEDDING_MODEL_ID", "all-mpnet-base-v2")
    
    if not database_url:
        logger.error("DATABASE_URL not found.")
        return

    # 1. Initialize Model and Multi-GPU Pool
    num_gpus = torch.cuda.device_count()
    logger.info(f"Detected {num_gpus} GPUs. Initializing multi-process pool...")
    
    model = _get_local_model(model_name)
    # Start a pool where each process is assigned to one of the 8 V100s
    pool = model.start_multi_process_pool()

    conn = psycopg2.connect(database_url)
    cursor = conn.cursor()

    # 2. Identify missing labels
    cursor.execute("""
        SELECT DISTINCT s.set_id, s.spl_id, s.product_names
        FROM labeling.sum_spl s
        WHERE NOT EXISTS (
            SELECT 1 FROM label_embeddings e WHERE e.set_id = s.set_id
        )
    """)
    missing_labels = cursor.fetchall()
    total_missing = len(missing_labels)
    
    if total_missing == 0:
        logger.info("Database is already in sync.")
        model.stop_multi_process_pool(pool)
        return

    logger.info(f"Syncing {total_missing} labels across {num_gpus} GPUs...")

    # 3. Process in large outer batches (accumulate chunks from multiple labels)
    for i in range(0, total_missing, labels_per_batch):
        label_batch = missing_labels[i:i + labels_per_batch]
        all_chunks_metadata = []
        all_texts = []

        # Extract chunks from this batch of labels
        for set_id, spl_id, product_names in label_batch:
            # Note: product_names is used instead of brand_name
            cursor.execute("SELECT spl_id, title, loinc_code, content_xml FROM labeling.spl_sections WHERE spl_id = %s", (spl_id,))
            sections = cursor.fetchall()
            
            for s_spl_id, title, loinc, content in sections:
                if not content or len(content.strip()) < 20: continue
                chunks = chunk_text(content, 500)
                for idx, chunk in enumerate(chunks):
                    all_texts.append(chunk)
                    all_chunks_metadata.append({
                        'sid': set_id, 'spl': s_spl_id, 't': title or "Section", 
                        'l': loinc, 'idx': idx, 'txt': chunk
                    })

        if not all_texts: continue

        # 4. Multi-GPU Embedding Generation
        logger.info(f"Generating embeddings for {len(all_texts)} chunks using {num_gpus} GPUs...")
        try:
            # This distributes all_texts across the 8 V100s automatically
            embeddings = model.encode_multi_process(all_texts, pool, batch_size=batch_size)
            
            # 5. Bulk Database Insert
            insert_data = []
            for meta, emb in zip(all_chunks_metadata, embeddings):
                insert_data.append((meta['sid'], meta['spl'], meta['t'], meta['l'], meta['idx'], meta['txt'], emb.tolist()))

            execute_values(cursor, """
                INSERT INTO label_embeddings (set_id, spl_id, section_title, loinc_code, chunk_index, chunk_text, embedding)
                VALUES %s
            """, insert_data)
            conn.commit()
            logger.info(f"Successfully synced batch ending at index {i + len(label_batch)}/{total_missing}")

        except Exception as e:
            conn.rollback()
            logger.error(f"Error in batch processing: {e}")

    # Cleanup
    model.stop_multi_process_pool(pool)
    conn.close()
    logger.info("Multi-GPU Sync complete.")

if __name__ == "__main__":
    # Optimal for 8x V100: Larger batch size to keep Tensor Cores busy
    sync_embeddings_multigpu(batch_size=512, labels_per_batch=100)
