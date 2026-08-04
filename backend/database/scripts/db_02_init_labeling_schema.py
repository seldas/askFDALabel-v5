from pg_utils import PGUtils
from psycopg2 import sql

# Columns the criteria builder matches with ILIKE '%term%'. A btree index cannot
# serve a leading-wildcard pattern, so these get pg_trgm GIN indexes — without
# them every Product Name, Labeling Type, Route or Marketing Category criterion
# is a sequential scan over the whole table.
#
# gin_trgm_ops (not gist) because these are read-mostly: GIN is slower to build
# and update but substantially faster to search, and the table only changes
# during an import.
_TRIGRAM_INDEXES = [
    # (index name, table, indexed expression — a bare column, or SQL wrapped in
    #  parentheses below so an expression index works the same way)
    ('idx_sum_spl_product_names_trgm', 'labeling.sum_spl', 'product_names'),
    ('idx_sum_spl_generic_names_trgm', 'labeling.sum_spl', 'generic_names'),
    ('idx_sum_spl_active_ingr_trgm', 'labeling.sum_spl', 'active_ingredients'),
    ('idx_sum_spl_manufacturer_trgm', 'labeling.sum_spl', 'manufacturer'),
    ('idx_sum_spl_doc_type_trgm', 'labeling.sum_spl', 'doc_type'),
    ('idx_sum_spl_market_cat_trgm', 'labeling.sum_spl', 'market_categories'),
    ('idx_sum_spl_routes_trgm', 'labeling.sum_spl', 'routes'),
    ('idx_sum_spl_dosage_forms_trgm', 'labeling.sum_spl', 'dosage_forms'),
    ('idx_sum_spl_appr_num_trgm', 'labeling.sum_spl', 'appr_num'),
    # Expression index, not a plain column one: NDCs are stored hyphenated but
    # pasted in either form, so the identifier criterion always searches
    # REPLACE(ndc_codes, '-', ''). An index on the raw column cannot serve that.
    ('idx_sum_spl_ndc_codes_trgm', 'labeling.sum_spl', "REPLACE(ndc_codes, '-', '')"),
    ('idx_sum_spl_epc_trgm', 'labeling.sum_spl', 'epc'),
    ('idx_epc_map_term_trgm', 'labeling.epc_map', 'epc_term'),
    ('idx_substance_indexing_iname_trgm', 'labeling.substance_indexing', 'indexing_name'),
    ('idx_active_ingr_name_trgm', 'labeling.active_ingredients_map', 'substance_name'),
]


def create_query_indexes(cursor):
    """
    Indexes that make the criteria builder usable at full-import scale.

    Idempotent, and safe to re-run on a populated database. Deliberately NOT
    CONCURRENTLY: this script runs at setup rather than against live traffic,
    and a failed concurrent build leaves an INVALID index behind that nothing
    here would clean up. On a large table these take minutes to build.
    """
    print("Ensuring pg_trgm extension...")
    try:
        cursor.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm;")
    except Exception as e:
        # Needs superuser on some managed instances. The indexes below are the
        # only thing that depends on it, so degrade instead of aborting the
        # whole schema init.
        print(f"[WARN] Could not enable pg_trgm ({e}). Skipping trigram indexes; "
              f"name and category searches will use sequential scans.")
        return

    print(f"Ensuring {len(_TRIGRAM_INDEXES)} trigram indexes (may take a while on a full import)...")
    for name, table, expression in _TRIGRAM_INDEXES:
        # An expression index needs its own parentheses; a bare column must not
        # have them, or Postgres treats it as an expression and the planner will
        # not match it to a plain column predicate.
        indexed = f'({expression})' if '(' in expression else expression
        try:
            cursor.execute(
                f"CREATE INDEX IF NOT EXISTS {name} ON {table} "
                f"USING GIN ({indexed} gin_trgm_ops);"
            )
        except Exception as e:
            print(f"[WARN] Index {name} failed: {e}")

    # Every criteria query filters on is_latest and orders by revised_date.
    # Partial on is_latest so the index only carries the rows queries can reach.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_sum_spl_latest_revised "
        "ON labeling.sum_spl (revised_date DESC) WHERE is_latest;"
    )
    # Identifier lookups by set_id/spl_id are exact, so btree, not trigram.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_sum_spl_spl_id ON labeling.sum_spl (spl_id);"
    )
    # Supports the ingredient-name join in the pharmacologic class criterion.
    cursor.execute(
        "CREATE INDEX IF NOT EXISTS idx_active_ingr_name_upper "
        "ON labeling.active_ingredients_map (UPPER(substance_name));"
    )


def init_labeling_schema():
    print("Initializing 'labeling' schema in PostgreSQL...")
    PGUtils.create_schema('labeling')
    
    conn = PGUtils.get_connection()
    try:
        # Use autocommit to ensure each command is its own transaction,
        # preventing "transaction is aborted" errors from cascading.
        conn.autocommit = True
        with conn.cursor() as cursor:
            # 1. Main Metadata Table
            print("Ensuring 'labeling.sum_spl' exists...")
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.sum_spl (
                spl_id TEXT PRIMARY KEY,
                set_id TEXT,
                product_names TEXT,
                generic_names TEXT,
                manufacturer TEXT,
                appr_num TEXT,
                active_ingredients TEXT,
                market_categories TEXT,
                doc_type TEXT,
                routes TEXT,
                dosage_forms TEXT,
                epc TEXT,
                ndc_codes TEXT,
                revised_date TEXT,
                initial_approval_year INTEGER,
                is_rld INTEGER DEFAULT 0,
                is_rs INTEGER DEFAULT 0,
                local_path TEXT
            )
            """)

            cursor.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS effective_time_raw TEXT;")
            cursor.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
            cursor.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS is_latest BOOLEAN DEFAULT FALSE;")
            cursor.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS version_number INTEGER;")
            cursor.execute("ALTER TABLE labeling.sum_spl ADD COLUMN IF NOT EXISTS parent_spl_id TEXT;")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_sum_spl_set_id ON labeling.sum_spl(set_id);")

            # 1.1 create history table:
            cursor.execute("""
                SELECT 1 FROM information_schema.tables 
                WHERE table_schema = 'labeling' 
                AND table_name = 'history_analysis'
            """)
            if not cursor.fetchone():
                cursor.execute("""
                 CREATE TABLE labeling.history_analysis (
                     id SERIAL PRIMARY KEY,
                     set_id TEXT NOT NULL,
                     current_spl_id TEXT NOT NULL UNIQUE,
                     previous_spl_id TEXT,
                     executive_summary TEXT, 
                     is_regulatory_notable BOOLEAN DEFAULT FALSE,
                     analysis_json JSONB, 
                     raw_prompt_version TEXT, 
                     last_analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                 )
                 """)

            # 2. Section Content Table
            print("Ensuring 'labeling.spl_sections' exists...")
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.spl_sections (
                id INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
                spl_id TEXT,
                loinc_code TEXT,
                title TEXT,
                content_xml TEXT,
                FOREIGN KEY(spl_id) REFERENCES labeling.sum_spl(spl_id) ON DELETE CASCADE
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_spl_sections_spl_id ON labeling.spl_sections(spl_id);")
            
            # Check if search_vector exists
            cursor.execute("""
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'labeling' 
                AND table_name = 'spl_sections' 
                AND column_name = 'search_vector'
            """)
            if not cursor.fetchone():
                print("Adding 'search_vector' column to 'spl_sections'... (This may take several minutes for large datasets)")
                cursor.execute("""
                    ALTER TABLE labeling.spl_sections 
                    ADD COLUMN search_vector TSVECTOR 
                    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content_xml, ''))) STORED;
                """)

            # Full-Text Search Index on the STORED column
            print("Creating GIN index on pre-computed search_vector...")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_spl_sections_fts ON labeling.spl_sections USING GIN (search_vector);")

            # 3. Mapping Tables
            print("Ensuring 'labeling.active_ingredients_map' exists...")
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.active_ingredients_map (
                id INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
                spl_id TEXT,
                substance_name TEXT,
                unii TEXT,
                is_active INTEGER,
                FOREIGN KEY(spl_id) REFERENCES labeling.sum_spl(spl_id) ON DELETE CASCADE
            )
            """)
            
            # Fix missing 'id' column if table existed without it
            cursor.execute("""
                SELECT 1 FROM information_schema.columns 
                WHERE table_schema = 'labeling' AND table_name = 'active_ingredients_map' AND column_name = 'id'
            """)
            if not cursor.fetchone():
                print("Adding missing 'id' column to 'active_ingredients_map'...")
                cursor.execute("ALTER TABLE labeling.active_ingredients_map ADD COLUMN id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY;")
            
            # Ensure 'unii' column exists
            cursor.execute("ALTER TABLE labeling.active_ingredients_map ADD COLUMN IF NOT EXISTS unii TEXT;")
            
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_active_ingr_spl_id ON labeling.active_ingredients_map(spl_id);")
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_active_ingr_unii ON labeling.active_ingredients_map(unii);")

            # 4. EPC Map
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.epc_map (
                id INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
                spl_id TEXT,
                epc_term TEXT,
                FOREIGN KEY(spl_id) REFERENCES labeling.sum_spl(spl_id) ON DELETE CASCADE,
                UNIQUE (spl_id, epc_term)
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_epc_map_spl_id ON labeling.epc_map(spl_id);")

            # 5. Substance Indexing Table
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.substance_indexing (
                id SERIAL PRIMARY KEY,
                substance_unii TEXT,
                substance_name TEXT,
                indexing_code TEXT,
                indexing_name TEXT,
                indexing_type TEXT,
                UNIQUE (substance_name, indexing_code)
            )
            """)
            cursor.execute("CREATE INDEX IF NOT EXISTS idx_substance_indexing_name ON labeling.substance_indexing(UPPER(substance_name));")

            # 6. Tracking Table for Bulk ZIPs
            cursor.execute("""
            CREATE TABLE IF NOT EXISTS labeling.processed_zips (
                zip_name TEXT PRIMARY KEY,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """)

            # 7. Indexes for the query builder
            create_query_indexes(cursor)

            print("[SUCCESS] 'labeling' schema initialized.")
    except Exception as e:
        print(f"[ERROR] Failed to initialize labeling schema: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    init_labeling_schema()
