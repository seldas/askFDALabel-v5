import os
import sys
import psycopg2
from psycopg2.extras import execute_values
from pathlib import Path
from dotenv import load_dotenv
import logging
import time

# Setup Logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Add backend to path
sys.path.append(str(Path(__file__).resolve().parent.parent / 'backend'))

from dashboard.services.ai_handler import call_embedding

load_dotenv()
DATABASE_URL = os.getenv('DATABASE_URL')

def chunk_text(text, max_words=500):
    words = text.split()
    for i in range(0, len(words), max_words):
        yield " ".join(words[i:i + max_words])

def populate_embeddings(limit_labels=None, batch_size=50):
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    # 1. Get list of set_ids that haven't been embedded yet
    if limit_labels:
        cursor.execute("SELECT DISTINCT set_id FROM labeling.sum_spl LIMIT %s", (limit_labels,))
    else:
        cursor.execute("""
            SELECT DISTINCT s.set_id 
            FROM labeling.sum_spl s
            WHERE NOT EXISTS (SELECT 1 FROM label_embeddings e WHERE e.set_id = s.set_id)
        """)
    
    set_ids = [r[0] for r in cursor.fetchall()]
    logger.info(f"Found {len(set_ids)} labels to process.")

    for sid in set_ids:
        logger.info(f"Processing set_id: {sid}")
        cursor.execute("""
            SELECT spl_id, title, loinc_code, content_xml 
            FROM labeling.spl_sections 
            WHERE spl_id = (SELECT spl_id FROM labeling.sum_spl WHERE set_id = %s LIMIT 1)
        """, (sid,))
        
        sections = cursor.fetchall()
        
        # Prepare all chunks for this label
        pending_chunks = []
        for spl_id, title, loinc, content in sections:
            if not content: continue
            chunks = list(chunk_text(content, 500))
            for i, chunk in enumerate(chunks):
                pending_chunks.append({
                    'sid': sid, 'spl_id': spl_id, 'title': title, 
                    'loinc': loinc, 'index': i, 'text': chunk
                })
        
        if not pending_chunks: continue

        # Process chunks in batches for the embedding API
        all_embeddings_to_insert = []
        for i in range(0, len(pending_chunks), batch_size):
            batch = pending_chunks[i:i + batch_size]
            texts = [c['text'] for c in batch]
            
            # call_embedding now supports list input
            embeddings = call_embedding(texts)
            
            if embeddings and len(embeddings) == len(batch):
                for chunk_data, emb in zip(batch, embeddings):
                    all_embeddings_to_insert.append((
                        chunk_data['sid'], chunk_data['spl_id'], chunk_data['title'], 
                        chunk_data['loinc'], chunk_data['index'], chunk_data['text'], emb
                    ))
            else:
                logger.error(f"Failed to get embeddings for batch in {sid}")
            
            # Small delay to respect rate limits if needed
            time.sleep(0.5)

        if all_embeddings_to_insert:
            insert_sql = """
                INSERT INTO label_embeddings (set_id, spl_id, section_title, loinc_code, chunk_index, chunk_text, embedding)
                VALUES %s
            """
            execute_values(cursor, insert_sql, all_embeddings_to_insert)
            conn.commit()
            logger.info(f"  Inserted {len(all_embeddings_to_insert)} chunks for {sid}.")

    conn.close()

if __name__ == "__main__":
    # Start with a small batch of 10 labels for testing
    populate_embeddings(limit_labels=10, batch_size=80)
