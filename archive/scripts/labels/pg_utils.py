import os
import psycopg2
from psycopg2 import sql
from psycopg2.extras import execute_values, RealDictCursor
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables
root_dir = Path(__file__).resolve().parent.parent.parent
env_path = root_dir / '.env'
load_dotenv(dotenv_path=env_path)

class PGUtils:
    @staticmethod
    def get_connection(cursor_factory=RealDictCursor):
        """Establishes a connection to PostgreSQL using DATABASE_URL from .env."""
        dsn = os.getenv('DATABASE_URL')
        if not dsn:
            raise ValueError("DATABASE_URL not found in .env")
        conn = psycopg2.connect(dsn, cursor_factory=cursor_factory)
        conn.set_client_encoding('UTF8')
        return conn

    @staticmethod
    def create_schema(schema_name):
        """Creates a schema if it doesn't exist."""
        conn = PGUtils.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema_name)))
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def bulk_insert(table_name, columns, data, schema='public', on_conflict=None):
        """
        Efficiently inserts multiple rows into a table.
        :param table_name: Name of the table.
        :param columns: List of column names.
        :param data: List of tuples (data rows).
        :param schema: Schema name.
        :param on_conflict: Conflict resolution clause (e.g., 'DO NOTHING' or 'DO UPDATE SET ...').
        """
        if not data:
            return

        conn = PGUtils.get_connection()
        try:
            with conn.cursor() as cur:
                full_table_name = sql.Identifier(schema, table_name)
                col_names = [sql.Identifier(c) for c in columns]
                
                query = sql.SQL("INSERT INTO {table} ({cols}) VALUES %s").format(
                    table=full_table_name,
                    cols=sql.SQL(', ').join(col_names)
                )
                
                if on_conflict:
                    query = sql.SQL("{} {}").format(query, sql.SQL(on_conflict))

                execute_values(cur, query, data)
            conn.commit()
        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()

    @staticmethod
    def execute_query(query, params=None, fetch=False):
        """Executes a single query."""
        conn = PGUtils.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(query, params)
                if fetch:
                    return cur.fetchall()
            conn.commit()
        finally:
            conn.close()

if __name__ == "__main__":
    # Test connection
    try:
        conn = PGUtils.get_connection()
        print("Successfully connected to PostgreSQL.")
        with conn.cursor() as cur:
            cur.execute("SELECT version();")
            print(f"PostgreSQL Version: {cur.fetchone()['version']}")
        conn.close()
    except Exception as e:
        print(f"Connection failed: {e}")
