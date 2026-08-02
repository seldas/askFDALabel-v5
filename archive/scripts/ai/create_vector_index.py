import os
import psycopg2
from dotenv import load_dotenv
import logging

# Setup Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

def create_hnsw_index():
    """
    Applies HNSW indexing to the label_embeddings table for sub-second search latency.
    Requires pgvector extension to be installed in the PostgreSQL database.
    """
    load_dotenv()
    database_url = os.getenv('DATABASE_URL')

    if not database_url:
        logger.error("DATABASE_URL not found in environment variables.")
        return

    try:
        # Connect to the database
        conn = psycopg2.connect(database_url)
        conn.autocommit = True  # CREATE INDEX CONCURRENTLY (if we were using it) requires autocommit
        cursor = conn.cursor()

        # 1. Ensure pgvector extension exists
        logger.info("Checking for pgvector extension...")
        cursor.execute("SELECT * FROM pg_extension WHERE extname = 'vector'")
        if not cursor.fetchone():
            logger.info("Installing pgvector extension...")
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
        else:
            logger.info("pgvector extension already installed.")

        # 2. Check if table exists
        logger.info("Checking if 'label_embeddings' table exists...")
        cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'label_embeddings')")
        if not cursor.fetchone()[0]:
            logger.error("Table 'label_embeddings' does not exist. Please run migrations first.")
            return

        # 3. Apply HNSW index
        # We check if index already exists to prevent error
        index_name = "label_embeddings_embedding_idx" # Default name or we can specify one
        
        logger.info("Checking if HNSW index already exists...")
        cursor.execute(f"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relname = '{index_name}'")
        if cursor.fetchone()[0] > 0:
            logger.info(f"Index '{index_name}' already exists.")
        else:
            logger.info("Applying HNSW index (this may take a few minutes for large datasets)...")
            # Using the exact command requested by the user
            # Note: We can specify the name if we want, but Postgres generates one if omitted
            cursor.execute("CREATE INDEX label_embeddings_embedding_idx ON label_embeddings USING hnsw (embedding vector_cosine_ops);")
            logger.info("HNSW index created successfully.")

        conn.close()
        logger.info("Indexing step complete.")

    except Exception as e:
        logger.error(f"Error applying vector index: {e}")

if __name__ == "__main__":
    create_hnsw_index()
