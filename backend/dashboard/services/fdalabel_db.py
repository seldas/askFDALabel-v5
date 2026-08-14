import hashlib
import os
import random
import threading
import psycopg2
from psycopg2.extras import RealDictCursor
from flask import current_app

# Graceful import for oracledb
try:
    import oracledb
    ORACLE_AVAILABLE = True
except ImportError:
    ORACLE_AVAILABLE = False
    print("Warning: oracledb not installed. Internal DB features disabled.")

class FDALabelDBService:
    _is_connected = None  # Tri-state: None (unknown), True (connected), False (failed)
    _db_type = None       # 'oracle' or 'postgres' — cached after first successful connection

    _oracle_pool = None       # oracledb.ConnectionPool, created lazily on first use
    _oracle_pool_key = None   # (user, dsn) the current pool was built for
    _oracle_pool_lock = threading.Lock()

    @classmethod
    def get_postgres_connection(cls):
        """Establishes a connection to the PostgreSQL database."""
        try:
            dsn = current_app.config.get('DATABASE_URL')
            if not dsn:
                return None
            connection = psycopg2.connect(dsn, cursor_factory=RealDictCursor)
            return connection
        except Exception as e:
            print(f"Postgres Connection Failed: {e}")
            return None

    @classmethod
    def get_oracle_env_preset(cls, oracle_env):
        """
        Returns the host/port/service baked into .env for 'dev' or 'tst'.

        These are the values the admin panel offers behind its DEV / TST quick
        buttons; they are also the fallback whenever the admin override for a
        field is blank.
        """
        prefix = 'FDALABEL_DEV' if oracle_env == 'dev' else 'FDALABEL_TST'

        def cfg(name):
            try:
                return current_app.config.get(name)
            except Exception:
                return None

        host = os.getenv(f'{prefix}_HOST') or cfg(f'{prefix}_HOST') or os.getenv('FDALabel_HOST') or os.getenv('FDALabel_SERV') or os.getenv('FDALABEL_HOST')
        port = os.getenv(f'{prefix}_PORT') or cfg(f'{prefix}_PORT') or os.getenv('FDALabel_PORT') or os.getenv('FDALABEL_PORT')
        service = os.getenv(f'{prefix}_SERVICE') or cfg(f'{prefix}_SERVICE') or os.getenv('FDALabel_SERVICE') or os.getenv('FDALabel_APP') or os.getenv('FDALABEL_SERVICE')
        return {
            'host': host or '',
            'port': str(port or ''),
            'service': service or '',
        }

    @classmethod
    def get_oracle_env_credentials(cls):
        """Returns the (user, password) pair from .env, shared by both DEV and TST."""

        def cfg(name):
            try:
                return current_app.config.get(name)
            except Exception:
                return None

        user = cfg('FDALabel_USER') or cfg('FDALABEL_USER') or os.getenv('FDALabel_USER') or os.getenv('FDALABEL_USER')
        psw = (cfg('FDALabel_PASSWORD') or cfg('FDALabel_PSW') or
               cfg('FDALABEL_PASSWORD') or cfg('FDALABEL_PSW') or
               os.getenv('FDALabel_PASSWORD') or os.getenv('FDALabel_PSW') or
               os.getenv('FDALABEL_PASSWORD') or os.getenv('FDALABEL_PSW'))
        return user or '', psw or ''

    @classmethod
    def resolve_oracle_target(cls):
        """
        Resolves the Oracle target actually used for connections.

        Admin overrides stored by EnvService win field by field; any field left
        blank falls back to the .env preset for the selected oracle_db_env.
        Returns a dict with host/port/service/user/password plus the env name.
        """
        from dashboard.services.env_service import EnvService

        config = EnvService.get_config()
        oracle_env = config.get("oracle_db_env") or "tst"
        preset = cls.get_oracle_env_preset(oracle_env)
        env_user, env_psw = cls.get_oracle_env_credentials()

        return {
            'oracle_db_env': oracle_env,
            'host': (config.get('oracle_host') or '').strip() or preset['host'],
            'port': str(config.get('oracle_port') or '').strip() or preset['port'],
            'service': (config.get('oracle_service') or '').strip() or preset['service'],
            'user': (config.get('oracle_user') or '').strip() or env_user,
            'password': config.get('oracle_password') or env_psw,
        }

    @classmethod
    def get_oracle_connection(cls):
        """Attempts connection directly to Oracle DB without checking labeling_source setting or falling back."""
        if not ORACLE_AVAILABLE:
            return None

        target = cls.resolve_oracle_target()
        user, psw = target['user'], target['password']
        host, port, service = target['host'], target['port'], target['service']

        try:
            if psw and host and port and service:
                dsnStr = oracledb.makedsn(host, port, service)
                pool = cls._get_oracle_pool(user, psw, dsnStr)
                connection = pool.acquire()
                cls._db_type = 'oracle'
                return connection
        except Exception as e:
            print(f"  [!] Direct Oracle Connection Exception ({target['oracle_db_env']}): {e}")
        return None

    @classmethod
    def test_oracle_connection(cls, host, port, service, user, password):
        """
        Opens a throwaway (non-pooled) Oracle connection with the supplied
        parameters and runs `SELECT 1 FROM DUAL`.

        Deliberately bypasses the pool so an admin can probe a target without
        disturbing the pool the app is serving traffic from. Returns
        (ok: bool, message: str, elapsed_ms: int|None).
        """
        import time

        if not ORACLE_AVAILABLE:
            return False, "The 'oracledb' driver is not installed on the server.", None

        missing = [n for n, v in (('host', host), ('port', port), ('service', service), ('password', password)) if not v]
        if missing:
            return False, f"Missing required field(s): {', '.join(missing)}", None

        try:
            port_num = int(str(port).strip())
        except (TypeError, ValueError):
            return False, f"Port must be a number (got '{port}').", None

        started = time.time()
        conn = None
        try:
            dsn = oracledb.makedsn(host.strip(), port_num, service.strip())
            conn = oracledb.connect(user=(user or '').strip(), password=password, dsn=dsn)
            cursor = conn.cursor()
            cursor.execute("SELECT 1 FROM DUAL")
            cursor.fetchone()
            cursor.close()
            elapsed = int((time.time() - started) * 1000)
            return True, f"Connected to {host}:{port_num}/{service}", elapsed
        except Exception as e:
            return False, str(e).strip().splitlines()[0] if str(e).strip() else repr(e), None
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:
                    pass

    @classmethod
    def _get_oracle_pool(cls, user, psw, dsnStr):
        """
        Returns a cached oracledb.ConnectionPool for (user, dsn), creating one on
        first use. Every call site acquires via this pool and releases with the
        connection's own .close() (unchanged elsewhere) -- python-oracledb treats
        close() on a pooled connection as "return to pool", not "tear down the
        session", so no other call site needs to change.

        Rebuilds the pool if the target (user/host/port/service) changes, which
        happens when an admin flips the oracle_db_env dev/tst setting.

        The password is part of the key -- hashed, so it never sits in a class
        attribute in the clear. Without it, a password-only edit in the admin
        panel would leave every *other* Gunicorn/Celery process serving from a
        pool built with the old credentials, since only the process that handled
        the save calls reset_oracle_pool().
        """
        psw_digest = hashlib.sha256((psw or '').encode('utf-8')).hexdigest()
        key = (user, dsnStr, psw_digest)
        if cls._oracle_pool is not None and cls._oracle_pool_key == key:
            return cls._oracle_pool

        with cls._oracle_pool_lock:
            if cls._oracle_pool is not None and cls._oracle_pool_key == key:
                return cls._oracle_pool
            if cls._oracle_pool is not None:
                try:
                    cls._oracle_pool.close(force=True)
                except Exception:
                    pass
            cls._oracle_pool = oracledb.create_pool(
                user=user, password=psw, dsn=dsnStr,
                min=1, max=10, increment=1,
                getmode=oracledb.POOL_GETMODE_WAIT,
            )
            cls._oracle_pool_key = key
            return cls._oracle_pool

    @classmethod
    def execute_oracle_query(cls, sql, params=None):
        """
        Runs one read-only statement against Oracle and returns a list of dicts
        keyed by the column names Oracle reports -- upper case unless the SELECT
        quoted an alias.

        Callers read both cases (`r.get('NAME') or r.get('name')`) because that
        is not worth depending on. Returns [] when Oracle is unreachable rather
        than raising, so a caller that has a local fallback can take it; a
        failed statement still raises, since that is a bug rather than a
        deployment state.
        """
        conn = cls.get_oracle_connection()
        if not conn:
            return []
        try:
            cursor = conn.cursor()
            cursor.execute(sql, params or {})
            columns = [d[0] for d in cursor.description]
            rows = [dict(zip(columns, row)) for row in cursor.fetchall()]
            cursor.close()
            return rows
        finally:
            conn.close()

    @classmethod
    def get_connection(cls, force_local=False, force_oracle=False):
        """
        Establishes a DB connection.

        Priority:
          1. force_oracle=True → attempt direct Oracle connection.
          2. Default → always use local Postgres DB.
        """
        if force_oracle:
            conn = cls.get_oracle_connection()
            if conn:
                cls._db_type = 'oracle'
                return conn

        # Local Postgres DB is the default across the app
        conn = cls.get_postgres_connection()
        if conn:
            cls._db_type = 'postgres'
        return conn

    @classmethod
    def is_available(cls):
        if cls._is_connected is not None:
            return cls._is_connected
        conn = cls.get_postgres_connection()
        if conn:
            cls._is_connected = True
            cls._db_type = 'postgres'
            conn.close()
        else:
            cls._is_connected = False
        return cls._is_connected

    @classmethod
    def reset_cache(cls):
        """Clears the cached connection state and tears down the Oracle pool."""
        cls._is_connected = None
        cls._db_type = None
        cls.reset_oracle_pool()

    @classmethod
    def reset_oracle_pool(cls):
        """
        Drops the cached Oracle pool so the next connection is built from the
        current settings. `_get_oracle_pool` already rebuilds when the (user,
        dsn) key changes, but a password-only edit keeps the same key.
        """
        with cls._oracle_pool_lock:
            if cls._oracle_pool is not None:
                try:
                    cls._oracle_pool.close(force=True)
                except Exception:
                    pass
            cls._oracle_pool = None
            cls._oracle_pool_key = None

    @classmethod
    def is_internal(cls):
        """Retired: internal auto-switching is disabled; explicit target_db switch is used instead."""
        return False

    @classmethod
    def is_local(cls):
        return True

    @classmethod
    def check_connectivity(cls):
        return cls.is_available()



    @classmethod
    def _get_count(cls, res):
        """Safely extracts a count value from a cursor.fetchone() result."""
        if res is None:
            return 0
        if isinstance(res, (tuple, list)):
            return res[0]
        if isinstance(res, dict):
            # Try common count keys
            return res.get('count') or res.get('COUNT(*)') or res.get('count(*)') or 0
        return 0

    @classmethod
    def filter_labels(cls, filters, limit=5000, force_local=False):
        if not cls.check_connectivity(): return [], 0
        conn = cls.get_connection(force_local=force_local)
        if not conn: return [], 0
        
        results = []
        total_count = 0
        try:
            cursor = conn.cursor()
            is_pg = (cls._db_type == 'postgres')
            
            # Table and Schema mapping
            schema = "labeling." if is_pg else "druglabel."
            table = "sum_spl" if is_pg else "DGV_SUM_SPL"
            
            # Column mapping
            c_prod = "product_names" if is_pg else "PRODUCT_NAMES"
            c_gen = "generic_names" if is_pg else "PRODUCT_NORMD_GENERIC_NAMES"
            c_ingr = "active_ingredients" if is_pg else "ACT_INGR_NAMES"
            c_ndc = "ndc_codes" if is_pg else "NDC_CODES"
            c_date = "revised_date" if is_pg else "EFF_TIME"
            c_mfg = "manufacturer" if is_pg else "AUTHOR_ORG_NORMD_NAME"
            c_type = "doc_type" if is_pg else "DOCUMENT_TYPE"
            
            where_clauses = []
            params = {}

            if filters.get("drugNames"):
                drug_clauses = []
                for i, drug in enumerate(filters["drugNames"]):
                    key = f"drug_{i}"
                    params[key] = f"%{drug}%"
                    if is_pg:
                        drug_clauses.append(f"({c_prod} ILIKE %(drug_{i})s OR {c_gen} ILIKE %(drug_{i})s OR {c_ingr} ILIKE %(drug_{i})s)")
                    else:
                        drug_clauses.append(f"(UPPER({c_prod}) LIKE UPPER(:drug_{i}) OR UPPER({c_gen}) LIKE UPPER(:drug_{i}) OR UPPER({c_ingr}) LIKE UPPER(:drug_{i}))")
                where_clauses.append(f"({ ' OR '.join(drug_clauses) })")

            if filters.get("ndcs"):
                ndc_clauses = []
                for i, ndc in enumerate(filters["ndcs"]):
                    # Extract only the first two sections of the NDC if it has three (Labeler-Product-Package)
                    parts = ndc.strip().split("-")
                    if len(parts) >= 2:
                        base_ndc = parts[0] + parts[1]
                    else:
                        base_ndc = ndc.replace("-", "").strip()
                        
                    key = f"ndc_{i}"
                    params[key] = f"%{base_ndc}%"
                    # Strip hyphens from DB column as well to ensure format-agnostic matching
                    if is_pg:
                        ndc_clauses.append(f"REPLACE({c_ndc}, '-', '') LIKE %(ndc_{i})s")
                    else:
                        ndc_clauses.append(f"REPLACE({c_ndc}, '-', '') LIKE :ndc_{i}")
                where_clauses.append(f"({ ' OR '.join(ndc_clauses) })")

                if not is_pg:
                    # Oracle: CONTAINS uses explicit AND operators
                    oracle_term = " AND ".join([f"{{{term}}}" for term in ae_terms])  # Wrap in braces to handle spaces in terms
                    params[key] = oracle_term
                    ae_subquery = f"EXISTS (SELECT 1 FROM druglabel.SPL_SEC s WHERE s.SPL_ID = druglabel.DGV_SUM_SPL.SPL_ID AND CONTAINS(s.CONTENT_XML, :ae_combined) > 0)"
                    where_clauses.append(ae_subquery)

            if filters.get("labelingTypes"):
                key = "doc_types"
                if is_pg:
                    where_clauses.append(f"{c_type} = ANY(%(doc_types)s)")
                    params[key] = filters["labelingTypes"]
                else:
                    placeholders = []
                    for i, t in enumerate(filters["labelingTypes"]):
                        k = f"type_{i}"
                        params[k] = t
                        placeholders.append(f":{k}")
                    where_clauses.append(f"{c_type} IN ({', '.join(placeholders)})")

            if filters.get("isRx"):
                if is_pg:
                    where_clauses.append(f"({c_type} ILIKE '%%PRESCRIPTION%%' AND {c_type} NOT ILIKE '%%OVER-THE-COUNTER%%')")
                else:
                    where_clauses.append(f"(UPPER({c_type}) LIKE '%%PRESCRIPTION%%' AND UPPER({c_type}) NOT LIKE '%%OVER-THE-COUNTER%%')")

            if filters.get("isRLD"):
                if is_pg:
                    where_clauses.append("is_rld = 1")
                else:
                    # RLD check for Oracle (using subquery check as seen in select logic)
                    where_clauses.append(f"EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = {schema}{table}.SPL_ID)")

            if is_pg:
                where_clauses.append("is_latest = TRUE")

            # Fetch results directly without slow COUNT(*)
            count_where = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
            fetch_limit = limit + 1

            sql = f"""
                SELECT set_id, {c_prod}, {c_gen}, {c_mfg}, appr_num, {c_ndc}, 
                       {c_date}, market_categories, {c_type}, is_rld, active_ingredients,
                       dosage_forms, routes, epc
                FROM {schema}{table}
                {count_where}
                ORDER BY {c_date} DESC
                LIMIT {fetch_limit}
            """
            if not is_pg:
                # Oracle LIMIT conversion
                sql = f"""
                    SELECT * FROM (
                        SELECT set_id, {c_prod}, {c_gen}, {c_mfg}, appr_num, {c_ndc}, 
                               {c_date}, market_categories, {c_type}, (SELECT COUNT(*) FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = {schema}{table}.SPL_ID) as is_rld, ACT_INGR_NAMES as active_ingredients,
                               dosage_forms, ROUTES_OF_ADMINISTRATION as routes, epc
                        FROM {schema}{table}
                        {count_where}
                        ORDER BY {c_date} DESC
                    ) WHERE ROWNUM <= {fetch_limit}
                """

            cursor.execute(sql, params)
            rows = cursor.fetchall()
            
            if len(rows) > limit:
                # Limit breached. We let the caller decide whether to hide them or show the first {limit}
                rows = rows[:limit]
                total_count = limit + 1
            else:
                total_count = len(rows)
            for r in rows:
                if is_pg:
                    results.append({
                        'set_id': r['set_id'], 
                        'PRODUCT_NAMES': r[c_prod],
                        'GENERIC_NAMES': r[c_gen], 
                        'COMPANY': r[c_mfg],
                        'APPR_NUM': r['appr_num'], 
                        'NDC_CODES': r[c_ndc],
                        'revised_date': r[c_date],
                        'MARKET_CATEGORIES': r['market_categories'], 
                        'DOCUMENT_TYPE': r[c_type],
                        'ACT_INGR_NAMES': r['active_ingredients'],
                        'DOSAGE_FORMS': r['dosage_forms'],
                        'Routes': r['routes'],
                        'EPC': r['epc'],
                        'is_rld': r['is_rld'], 
                        'is_rs': r.get('is_rs', 0)
                    })
                else:
                    # Oracle results (RealDictCursor usually converts to dict but let's be safe)
                    results.append({
                        'set_id': r[0] if isinstance(r, (tuple, list)) else r.get('SET_ID'), 
                        'PRODUCT_NAMES': r[1] if isinstance(r, (tuple, list)) else r.get(c_prod),
                        'GENERIC_NAMES': r[2] if isinstance(r, (tuple, list)) else r.get(c_gen), 
                        'COMPANY': r[3] if isinstance(r, (tuple, list)) else r.get(c_mfg),
                        'APPR_NUM': r[4] if isinstance(r, (tuple, list)) else r.get('APPR_NUM'), 
                        'NDC_CODES': r[5] if isinstance(r, (tuple, list)) else r.get(c_ndc),
                        'revised_date': r[6] if isinstance(r, (tuple, list)) else r.get(c_date),
                        'MARKET_CATEGORIES': r[7] if isinstance(r, (tuple, list)) else r.get('MARKET_CATEGORIES'), 
                        'DOCUMENT_TYPE': r[8] if isinstance(r, (tuple, list)) else r.get(c_type),
                        'ACT_INGR_NAMES': r[10] if isinstance(r, (tuple, list)) else r.get('ACTIVE_INGREDIENTS'),
                        'DOSAGE_FORMS': r[11] if isinstance(r, (tuple, list)) else r.get('DOSAGE_FORMS'),
                        'Routes': r[12] if isinstance(r, (tuple, list)) else r.get('ROUTES'),
                        'EPC': r[13] if isinstance(r, (tuple, list)) else r.get('EPC'),
                        'is_rld': bool(r[9] if isinstance(r, (tuple, list)) else r.get('IS_RLD')), 
                        'is_rs': False
                    })
            
            cursor.close()
        except Exception as e:
            print(f"Filter Error: {e}")
            import traceback
            traceback.print_exc()
        finally:
            conn.close()
            
        return results, total_count

    @classmethod
    def search_labels(cls, query, skip=0, limit=100000, force_local=False):
        if not cls.check_connectivity(): return []
        conn = cls.get_connection(force_local=force_local)
        if not conn: return []
        results = []
        try:
            cursor = conn.cursor()
            q = f"%{query}%"
            if cls._db_type == 'oracle':
                sql = """
                    SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, 
                           MARKET_CATEGORIES, APPR_NUM, NDC_CODES, EFF_TIME, ACT_INGR_NAMES, 
                           DOCUMENT_TYPE as LABELING_TYPE, DOSAGE_FORMS,
                           ROUTES_OF_ADMINISTRATION as ROUTES, EPC, 0 as IS_RLD, 0 as IS_RS
                    FROM druglabel.DGV_SUM_SPL
                    WHERE UPPER(TITLE) LIKE UPPER(:q) OR UPPER(PRODUCT_NAMES) LIKE UPPER(:q) OR
                          UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q) OR UPPER(ACT_INGR_NAMES) LIKE UPPER(:q) OR NDC_CODES LIKE :q_exact OR UPPER(SET_ID) = UPPER(:q_exact_id)
                    OFFSET :skip ROWS FETCH NEXT :limit ROWS ONLY
                """
                cursor.execute(sql, {"q": q, "q_exact": query, "q_exact_id": query, "skip": skip, "limit": limit})
                rows = cursor.fetchall()
                for r in rows:
                    results.append({
                        'set_id': r[0], 'brand_name': (r[1] or "").replace(';', ', '),
                        'generic_name': (r[2] or "").replace(';', ', '), 'manufacturer_name': r[3],
                        'effective_time': r[7], 'label_format': 'FDALabel', 'application_number': (r[5] or "")[:50],
                        'market_category': r[4], 'ndc': r[6], 'active_ingredients': r[8],
                        'labeling_type': r[9], 'dosage_forms': r[10], 'routes': r[11], 'epc': r[12],
                        'is_rld': r[13], 'is_rs': r[14] if len(r) > 14 else 0
                    })
            else:
                schema = "labeling."
                sql = f"""
                    SELECT set_id, product_names, generic_names, manufacturer, market_categories, appr_num,
                           ndc_codes, revised_date, active_ingredients, doc_type, dosage_forms, routes, epc, is_rld, is_rs
                    FROM {schema}sum_spl
                    WHERE (product_names ILIKE %(q)s OR generic_names ILIKE %(q)s
                           OR active_ingredients ILIKE %(q)s OR manufacturer ILIKE %(q)s
                           OR ndc_codes ILIKE %(q)s OR set_id ILIKE %(q_exact_id)s)
                    AND is_latest = TRUE
                    LIMIT %(limit)s OFFSET %(skip)s
                """
                params = {"q": q, "q_exact_id": query, "limit": limit, "skip": skip}
                cursor.execute(sql, params)
                rows = cursor.fetchall()
                for r in rows:
                    results.append({
                        'set_id': r['set_id'], 'brand_name': (r['product_names'] or "").replace(';', ', '),
                        'generic_name': (r['generic_names'] or "").replace(';', ', '), 'manufacturer_name': r['manufacturer'] or "",
                        'effective_time': (r['revised_date'] or "").replace('-', ''), 'label_format': 'FDALabel (Local)',
                        'application_number': (r['appr_num'] or "")[:50], 'market_category': r['market_categories'] or "",
                        'ndc': r['ndc_codes'] or "", 'active_ingredients': r['active_ingredients'],
                        'labeling_type': r['doc_type'], 'dosage_forms': r['dosage_forms'], 'routes': r['routes'],
                        'epc': r['epc'], 'is_rld': r['is_rld'], 'is_rs': r['is_rs']
                    })
            cursor.close()
        except Exception as e: print(f"Search Error: {e}")
        finally: conn.close()
        return results

    @classmethod
    def get_labels_by_set_ids_bulk(cls, set_ids, force_local=False):
        if not set_ids:
            return []
        if not cls.check_connectivity():
            return []
        conn = cls.get_connection(force_local=force_local)
        if not conn:
            return []

        clean_ids = list(dict.fromkeys([str(s).strip() for s in set_ids if str(s).strip()]))
        if not clean_ids:
            return []

        results = []
        CHUNK_SIZE = 500
        try:
            cursor = conn.cursor()
            for i in range(0, len(clean_ids), CHUNK_SIZE):
                chunk = clean_ids[i:i + CHUNK_SIZE]
                if cls._db_type == 'oracle':
                    bind_names = [f":id_{j}" for j in range(len(chunk))]
                    params = {f"id_{j}": chunk[j] for j in range(len(chunk))}
                    sql = f"""
                        SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, 
                               MARKET_CATEGORIES, APPR_NUM, NDC_CODES, EFF_TIME, ACT_INGR_NAMES, 
                               DOCUMENT_TYPE as LABELING_TYPE, DOSAGE_FORMS,
                               ROUTES_OF_ADMINISTRATION as ROUTES, EPC
                        FROM druglabel.DGV_SUM_SPL
                        WHERE SET_ID IN ({','.join(bind_names)})
                    """
                    cursor.execute(sql, params)
                    for r in cursor.fetchall():
                        results.append({
                            'set_id': r[0],
                            'brand_name': (r[1] or "").replace(';', ', '),
                            'generic_name': (r[2] or "").replace(';', ', '),
                            'manufacturer_name': r[3] or "n/a",
                            'market_category': r[4] or "n/a",
                            'application_number': (r[5] or "")[:50] or "n/a",
                            'ndc': r[6] or "n/a",
                            'effective_time': r[7] or "n/a",
                            'active_ingredients': r[8] or "n/a",
                            'labeling_type': r[9] or "n/a",
                            'dosage_forms': r[10] or "n/a",
                            'routes': r[11] or "n/a",
                            'epc': r[12] or "n/a",
                        })
                else:
                    schema = "labeling."
                    sql = f"""
                        SELECT set_id, product_names, generic_names, manufacturer, market_categories, appr_num,
                               ndc_codes, revised_date, active_ingredients, doc_type, dosage_forms, routes, epc
                        FROM {schema}sum_spl
                        WHERE set_id IN %s
                    """
                    cursor.execute(sql, (tuple(chunk),))
                    for r in cursor.fetchall():
                        results.append({
                            'set_id': r['set_id'] if isinstance(r, dict) else r[0],
                            'brand_name': ((r.get('product_names') if isinstance(r, dict) else r[1]) or "").replace(';', ', '),
                            'generic_name': ((r.get('generic_names') if isinstance(r, dict) else r[2]) or "").replace(';', ', '),
                            'manufacturer_name': (r.get('manufacturer') if isinstance(r, dict) else r[3]) or "n/a",
                            'market_category': (r.get('market_categories') if isinstance(r, dict) else r[4]) or "n/a",
                            'application_number': ((r.get('appr_num') if isinstance(r, dict) else r[5]) or "")[:50] or "n/a",
                            'ndc': (r.get('ndc_codes') if isinstance(r, dict) else r[6]) or "n/a",
                            'effective_time': str((r.get('revised_date') if isinstance(r, dict) else r[7]) or "n/a"),
                            'active_ingredients': (r.get('active_ingredients') if isinstance(r, dict) else r[8]) or "n/a",
                            'labeling_type': (r.get('doc_type') if isinstance(r, dict) else r[9]) or "n/a",
                            'dosage_forms': (r.get('dosage_forms') if isinstance(r, dict) else r[10]) or "n/a",
                            'routes': (r.get('routes') if isinstance(r, dict) else r[11]) or "n/a",
                            'epc': (r.get('epc') if isinstance(r, dict) else r[12]) or "n/a",
                        })
            cursor.close()
        except Exception as e:
            print(f"Bulk Fetch Error: {e}")
        finally:
            conn.close()
        return results

    @classmethod
    def search_labels_with_count(cls, query, skip=0, limit=10, force_local=False):
        """
        Efficient search that returns (results_list, total_count).
        Runs COUNT(*) first, then fetches at most `limit` rows.
        Used by the /db_search endpoint to support the 4-path decision tree.
        """
        if not cls.check_connectivity(): return [], 0
        conn = cls.get_connection(force_local=force_local)
        if not conn: return [], 0
        results = []
        total_count = 0
        try:
            cursor = conn.cursor()
            q = f"%{query}%"
            if cls._db_type == 'oracle':
                where = """
                    UPPER(TITLE) LIKE UPPER(:q) OR UPPER(PRODUCT_NAMES) LIKE UPPER(:q) OR
                    UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q) OR UPPER(ACT_INGR_NAMES) LIKE UPPER(:q)
                    OR NDC_CODES LIKE :q_exact OR UPPER(SET_ID) = UPPER(:q_exact_id)
                """
                count_sql = f"SELECT COUNT(*) FROM druglabel.DGV_SUM_SPL WHERE {where}"
                cursor.execute(count_sql, {"q": q, "q_exact": query, "q_exact_id": query})
                total_count = cls._get_count(cursor.fetchone())

                if total_count > 0:
                    sql = f"""
                        SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME,
                               MARKET_CATEGORIES, APPR_NUM, NDC_CODES, EFF_TIME, ACT_INGR_NAMES,
                               DOCUMENT_TYPE as LABELING_TYPE, DOSAGE_FORMS,
                               ROUTES_OF_ADMINISTRATION as ROUTES, EPC, 0 as IS_RLD, 0 as IS_RS
                        FROM druglabel.DGV_SUM_SPL
                        WHERE {where}
                        OFFSET :skip ROWS FETCH NEXT :limit ROWS ONLY
                    """
                    cursor.execute(sql, {"q": q, "q_exact": query, "q_exact_id": query, "skip": skip, "limit": limit})
                    rows = cursor.fetchall()
                    for r in rows:
                        results.append({
                            'set_id': r[0], 'brand_name': (r[1] or "").replace(';', ', '),
                            'generic_name': (r[2] or "").replace(';', ', '), 'manufacturer_name': r[3],
                            'effective_time': r[7], 'label_format': 'FDALabel', 'application_number': (r[5] or "")[:50],
                            'market_category': r[4], 'ndc': r[6], 'active_ingredients': r[8],
                            'labeling_type': r[9], 'dosage_forms': r[10], 'routes': r[11], 'epc': r[12],
                            'is_rld': r[13], 'is_rs': r[14] if len(r) > 14 else 0
                        })
            else:
                schema = "labeling."
                where = """
                    (product_names ILIKE %(q)s OR generic_names ILIKE %(q)s
                     OR active_ingredients ILIKE %(q)s OR manufacturer ILIKE %(q)s
                     OR ndc_codes ILIKE %(q)s OR set_id ILIKE %(q_exact_id)s)
                    AND is_latest = TRUE
                """
                count_sql = f"SELECT COUNT(*) FROM {schema}sum_spl WHERE {where}"
                cursor.execute(count_sql, {"q": q, "q_exact_id": query})
                total_count = cls._get_count(cursor.fetchone())

                if total_count > 0:
                    sql = f"""
                        SELECT set_id, product_names, generic_names, manufacturer, market_categories, appr_num,
                               ndc_codes, revised_date, active_ingredients, doc_type, dosage_forms, routes, epc, is_rld, is_rs
                        FROM {schema}sum_spl
                        WHERE {where}
                        LIMIT %(limit)s OFFSET %(skip)s
                    """
                    cursor.execute(sql, {"q": q, "q_exact_id": query, "limit": limit, "skip": skip})
                    rows = cursor.fetchall()
                    for r in rows:
                        results.append({
                            'set_id': r['set_id'], 'brand_name': (r['product_names'] or "").replace(';', ', '),
                            'generic_name': (r['generic_names'] or "").replace(';', ', '), 'manufacturer_name': r['manufacturer'] or "",
                            'effective_time': (r['revised_date'] or "").replace('-', ''), 'label_format': 'FDALabel (Local)',
                            'application_number': (r['appr_num'] or "")[:50], 'market_category': r['market_categories'] or "",
                            'ndc': r['ndc_codes'] or "", 'active_ingredients': r['active_ingredients'],
                            'labeling_type': r['doc_type'], 'dosage_forms': r['dosage_forms'], 'routes': r['routes'],
                            'epc': r['epc'], 'is_rld': r['is_rld'], 'is_rs': r['is_rs']
                        })
            cursor.close()
        except Exception as e:
            print(f"search_labels_with_count Error: {e}")
            import traceback; traceback.print_exc()
        finally:
            conn.close()
        return results, total_count

    @classmethod
    def get_label_counts(cls, generic_name=None, epc=None, force_local=False):
        if not cls.check_connectivity(): return {"generic_count": 0, "epc_count": 0}
        conn = cls.get_connection(force_local=force_local)
        if not conn: return {"generic_count": 0, "epc_count": 0}
        
        results = {"generic_count": 0, "epc_count": 0}
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                if generic_name:
                    sql = "SELECT COUNT(DISTINCT SET_ID) FROM druglabel.DGV_SUM_SPL WHERE UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q)"
                    cursor.execute(sql, {"q": f"%{generic_name}%"})
                    results["generic_count"] = cls._get_count(cursor.fetchone())
                if epc:
                    sql = "SELECT COUNT(DISTINCT SET_ID) FROM druglabel.DGV_SUM_SPL WHERE UPPER(EPC) LIKE UPPER(:q)"
                    cursor.execute(sql, {"q": f"%{epc}%"})
                    results["epc_count"] = cls._get_count(cursor.fetchone())
            else:
                schema = "labeling."
                if generic_name and not epc:
                    sql = f"""
                        SELECT COUNT(DISTINCT s.set_id) 
                        FROM {schema}sum_spl s
                        WHERE s.generic_names ILIKE %(q)s AND s.is_latest = TRUE
                    """
                    cursor.execute(sql, {"q": f"%{generic_name}%"})
                    results["generic_count"] = cls._get_count(cursor.fetchone())
                
                if epc:
                    # 1. Find all unique generic names under this EPC
                    clean_epc = epc.split('[')[0].strip()
                    sql_gns = f"""
                        SELECT DISTINCT generic_names 
                        FROM {schema}sum_spl s
                        LEFT JOIN {schema}epc_map e ON s.spl_id = e.spl_id
                        WHERE (s.epc ILIKE %(q)s OR e.epc_term ILIKE %(q)s OR s.epc ILIKE %(cq)s OR e.epc_term ILIKE %(cq)s)
                        AND s.is_latest = TRUE
                    """
                    cursor.execute(sql_gns, {"q": f"%{epc}%", "cq": f"%{clean_epc}%"})
                    all_gns = set()
                    for row in cursor.fetchall():
                        gn_str = row['generic_names'] if isinstance(row, dict) else row[0]
                        if gn_str:
                            for gn in gn_str.split(';'):
                                if gn.strip(): all_gns.add(gn.strip().upper())
                    
                    # Force include the provided generic_name if we are counting for its EPC
                    if generic_name:
                        for gn in generic_name.split(','):
                            if gn.strip(): all_gns.add(gn.strip().upper())

                    if all_gns:
                        # 2. Count labels that have ANY of these generic names
                        where_parts = [f"s.generic_names ILIKE %s"] * len(all_gns)
                        sql_count = f"""
                            SELECT COUNT(DISTINCT s.set_id) 
                            FROM {schema}sum_spl s
                            WHERE ({' OR '.join(where_parts)}) AND s.is_latest = TRUE
                        """
                        cursor.execute(sql_count, [f"%{gn}%" for gn in all_gns])
                        results["epc_count"] = cls._get_count(cursor.fetchone())
                    else:
                        # Fallback to direct EPC count
                        sql = f"""
                            SELECT COUNT(DISTINCT s.set_id) 
                            FROM {schema}sum_spl s 
                            LEFT JOIN {schema}epc_map e ON s.spl_id = e.spl_id 
                            WHERE (s.epc ILIKE %(q)s OR e.epc_term ILIKE %(q)s) AND s.is_latest = TRUE
                        """
                        cursor.execute(sql, {"q": f"%{epc}%"})
                        results["epc_count"] = cls._get_count(cursor.fetchone())
        except Exception as e:
            print(f"Error in get_label_counts: {e}")
        finally:
            conn.close()
        return results

    @classmethod
    def get_label_metadata(cls, set_id, spl_id=None, force_local=False):
        if not cls.check_connectivity(): return None
        conn = cls.get_connection(force_local=force_local)
        if not conn: return None
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                if spl_id:
                    sql = "SELECT s.SET_ID, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES, s.AUTHOR_ORG_NORMD_NAME, s.MARKET_CATEGORIES, s.APPR_NUM, s.NDC_CODES, s.EFF_TIME, s.ACT_INGR_NAMES, s.DOCUMENT_TYPE as LABELING_TYPE, s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC, (SELECT COUNT(*) FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = s.SPL_ID) as IS_RLD, 0 as IS_LATEST FROM druglabel.DGV_SUM_SPL s WHERE s.SPL_GUID = :sid"
                    cursor.execute(sql, {"sid": spl_id})
                else:
                    sql = "SELECT s.SET_ID, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES, s.AUTHOR_ORG_NORMD_NAME, s.MARKET_CATEGORIES, s.APPR_NUM, s.NDC_CODES, s.EFF_TIME, s.ACT_INGR_NAMES, s.DOCUMENT_TYPE as LABELING_TYPE, s.DOSAGE_FORMS, s.ROUTES_OF_ADMINISTRATION as ROUTES, s.EPC, (SELECT COUNT(*) FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = s.SPL_ID) as IS_RLD, 1 as IS_LATEST FROM druglabel.DGV_SUM_SPL s WHERE s.SET_ID = :sid ORDER BY s.EFF_TIME DESC"
                    cursor.execute(sql, {"sid": set_id})
                r = cursor.fetchone()
                if r:
                    return {'set_id': r[0], 'brand_name': (r[1] or "").replace(';', ', '), 'generic_name': (r[2] or "").replace(';', ', '), 'manufacturer_name': r[3], 'effective_time': r[7], 'label_format': 'FDALabel', 'application_number': r[5], 'market_category': r[4], 'ndc': r[6], 'active_ingredients': r[8], 'labeling_type': r[9], 'dosage_forms': r[10], 'routes': r[11], 'epc': r[12], 'is_rld': bool(r[13]), 'is_rs': False, 'is_latest': bool(r[14])}
            else:
                schema = "labeling."
                if spl_id:
                    sql = f"SELECT * FROM {schema}sum_spl WHERE spl_id = %s LIMIT 1"
                    cursor.execute(sql, (spl_id,))
                else:
                    sql = f"SELECT * FROM {schema}sum_spl WHERE set_id = %s ORDER BY revised_date DESC LIMIT 1"
                    cursor.execute(sql, (set_id,))
                r = cursor.fetchone()
                if r:
                    return {'set_id': r['set_id'], 'brand_name': (r['product_names'] or "").replace(';', ', '), 'generic_name': (r['generic_names'] or "").replace(';', ', '), 'manufacturer_name': r['manufacturer'] or "", 'effective_time': r['revised_date'], 'label_format': 'FDALabel (Local)', 'application_number': r['appr_num'] or "", 'market_category': r['market_categories'] or "", 'ndc': r['ndc_codes'] or "", 'active_ingredients': r['active_ingredients'], 'labeling_type': r['doc_type'], 'dosage_forms': r['dosage_forms'], 'routes': r['routes'], 'epc': r['epc'], 'is_rld': bool(r['is_rld']), 'is_rs': bool(r['is_rs']), 'is_latest': bool(r['is_latest'])}
        except Exception as e: print(f"Metadata Error: {e}")
        finally: conn.close()
        return None

    @classmethod
    def get_metadata_by_spl_id(cls, spl_id):
        return cls.get_label_metadata(None, spl_id=spl_id)

    @classmethod
    def get_structured_sections_by_spl_id(cls, spl_id):
        """
        Returns stored sections for one SPL version in a structured form.
        Disabled for local PostgreSQL database mode.
        """
        if cls._db_type == 'postgres' or cls.is_local():
            return []
        if not cls.check_connectivity():
            return []
        conn = cls.get_connection()
        if not conn:
            return []

        try:
            cursor = conn.cursor()
            schema = "labeling"

            # Discover actual columns
            col_sql = """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = %s
                AND table_name = %s
                ORDER BY ordinal_position
            """
            cursor.execute(col_sql, (schema, "spl_sections"))
            cols = [row["column_name"] if isinstance(row, dict) else row[0] for row in cursor.fetchall()]
            colset = set(cols)

            # Pick best available columns
            id_col = next((c for c in ["id", "section_id"] if c in colset), None)
            title_col = next((c for c in ["section_title", "title", "sec_title", "name"] if c in colset), None)
            code_col = next((c for c in ["section_code", "code", "loinc_code"] if c in colset), None)
            content_col = next((c for c in ["content_xml", "content", "section_text", "text"] if c in colset), None)
            order_col = next((c for c in ["id", "section_id", "display_order", "sort_order"] if c in colset), None)

            if "spl_id" not in colset:
                raise Exception("labeling.spl_sections is missing required column: spl_id")

            if not content_col:
                raise Exception(f"Could not find a content column in labeling.spl_sections. Found columns: {sorted(colset)}")

            select_parts = ["spl_id"]
            if id_col:
                select_parts.append(id_col)
            if title_col:
                select_parts.append(title_col)
            if code_col:
                select_parts.append(code_col)
            if content_col not in select_parts:
                select_parts.append(content_col)

            sql = f"""
                SELECT {", ".join(select_parts)}
                FROM {schema}.spl_sections
                WHERE spl_id = %s
                ORDER BY {order_col if order_col else 'spl_id'}
            """
            cursor.execute(sql, (spl_id,))
            rows = cursor.fetchall()

            results = []
            for r in rows:
                if isinstance(r, dict):
                    results.append({
                        "id": r.get(id_col) if id_col else None,
                        "section_title": (r.get(title_col) or "") if title_col else "",
                        "section_code": (r.get(code_col) or "") if code_col else "",
                        "content_xml": r.get(content_col) or ""
                    })
                else:
                    # Fallback if not dict-like
                    row_map = dict(zip(select_parts, r))
                    results.append({
                        "id": row_map.get(id_col) if id_col else None,
                        "section_title": (row_map.get(title_col) or "") if title_col else "",
                        "section_code": (row_map.get(code_col) or "") if code_col else "",
                        "content_xml": row_map.get(content_col) or ""
                    })

            cursor.close()
            return results

        except Exception as e:
            print(f"Structured Sections Error: {e}")
            return []
        finally:
            conn.close()

    @classmethod
    def get_full_xml(cls, set_id, spl_id=None, force_local=False):
        if not cls.check_connectivity():
            return None
        conn = cls.get_connection(force_local=force_local)
        if not conn:
            return None
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                if spl_id:
                    sql = "SELECT s.spl_xml FROM druglabel.spl s JOIN druglabel.sum_spl l ON s.set_id = l.set_id WHERE l.spl_guid = :sid"
                    cursor.execute(sql, {"sid": spl_id})
                else:
                    sql = "SELECT s.spl_xml FROM druglabel.spl s JOIN druglabel.sum_spl l ON s.set_id = l.set_id WHERE l.set_id = :sid ORDER BY l.eff_time DESC"
                    cursor.execute(sql, {"sid": set_id})
                r = cursor.fetchone()
                if r:
                    xml_data = r[0]
                    if hasattr(xml_data, 'read'):
                        xml_content = xml_data.read()
                    else:
                        xml_content = xml_data
                    if isinstance(xml_content, bytes):
                        return xml_content.decode('utf-8', errors='replace')
                    return xml_content
                return None
            else:
                schema = "labeling."
                if spl_id:
                    sql = f"SELECT local_path FROM {schema}sum_spl WHERE spl_id = %s"
                    cursor.execute(sql, (spl_id,))
                else:
                    sql = f"SELECT local_path FROM {schema}sum_spl WHERE set_id = %s ORDER BY revised_date DESC LIMIT 1"
                    cursor.execute(sql, (set_id,))
                r = cursor.fetchone()
                if r and r['local_path']:
                    if r['local_path'].endswith('.zip'):
                        storage_dir = current_app.config.get('SPL_STORAGE_DIR')
                        zip_path = os.path.abspath(os.path.join(storage_dir, r['local_path']))
                        if os.path.exists(zip_path):
                            import zipfile
                            with zipfile.ZipFile(zip_path, 'r') as z:
                                xml_files = [f for f in z.namelist() if f.lower().endswith('.xml')]
                                if not xml_files:
                                    return None

                                # Prefer a top-level XML or one matching set_id
                                preferred = None

                                for f in xml_files:
                                    base = os.path.basename(f).lower()
                                    if set_id.lower() in base:
                                        preferred = f
                                        break

                                if not preferred:
                                    # Prefer shortest path / likely main file
                                    preferred = sorted(xml_files, key=lambda x: (x.count('/'), len(x)))[0]

                                xml_bytes = z.read(preferred)
                                return xml_bytes.decode('utf-8', errors='replace')
                    else:
                        storage_dir = current_app.config.get('SPL_STORAGE_DIR_ARCHIVED')
                        xml_path = os.path.abspath(os.path.join(storage_dir, r['local_path']))
                        if os.path.exists(xml_path):
                            try:
                                with open(xml_path, 'r', encoding='utf-8', errors='replace') as f:
                                    return f.read()
                            except Exception as e:
                                print(f"Error reading XML file {xml_path}: {e}")
                                return None
        finally:
            conn.close()
        return None

    @classmethod
    def local_search(cls, query_term, skip=0, limit=50, human_rx_only=False, rld_only=False, rs_only=False, force_local=False):
        if not cls.check_connectivity(): return []
        conn = cls.get_connection(force_local=force_local)
        if not conn: return []
        try:
            cursor = conn.cursor()
            q = f"%{query_term}%"
            if cls._db_type == 'oracle':
                # Priority 1: SPL GUID match
                spl_where = ["UPPER(SPL_GUID) = UPPER(:sid)"]
                if human_rx_only: spl_where.append("DOCUMENT_TYPE_LOINC_CODE IN ('34391-3', '48401-4', '48402-2')")
                if rld_only: spl_where.append("EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = druglabel.DGV_SUM_SPL.SPL_ID)")
                sql_spl = f"SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL WHERE {' AND '.join(spl_where)}"
                cursor.execute(sql_spl, {"sid": query_term})
                rows = cursor.fetchall()
                
                if not rows:
                    # Priority 2: Regular search
                    where = ["(UPPER(PRODUCT_NAMES) LIKE UPPER(:q) OR UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q) OR UPPER(ACT_INGR_NAMES) LIKE UPPER(:q) OR UPPER(SET_ID) = UPPER(:sid) OR UPPER(APPR_NUM) LIKE UPPER(:q))"]
                    params = {"q": q, "sid": query_term}
                    if human_rx_only: where.append("DOCUMENT_TYPE_LOINC_CODE IN ('34391-3', '48401-4', '48402-2')")
                    if rld_only: where.append("EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = druglabel.DGV_SUM_SPL.SPL_ID)")
                    sql = f"SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL WHERE {' AND '.join(where)} ORDER BY EFF_TIME DESC"
                    cursor.execute(sql, params)
                    rows = cursor.fetchall()
            else:
                schema = "labeling."
                params = {"q": q, "sid": query_term, "limit": limit, "offset": skip}
                
                # Priority 1: SPL ID match (relaxed is_latest constraint for specific SPL search)
                spl_where = ["spl_id = %(sid)s"]
                if human_rx_only: spl_where.append("(doc_type ILIKE '%%HUMAN PRESCRIPTION%%' OR doc_type IN ('34391-3', '48401-4', '48402-2'))")
                if rld_only and rs_only: spl_where.append("(is_rld = 1 OR is_rs = 1)")
                elif rld_only: spl_where.append("is_rld = 1")
                elif rs_only: spl_where.append("is_rs = 1")
                
                sql_spl = f"""
                    SELECT s.set_id, s.product_names, s.generic_names, s.manufacturer, s.appr_num, 
                           s.ndc_codes, s.revised_date, s.market_categories, s.doc_type, s.local_path, s.spl_id, s.is_latest,
                           (SELECT COUNT(*) > 1 FROM {schema}sum_spl h WHERE h.set_id = s.set_id) as has_history
                    FROM {schema}sum_spl s 
                    WHERE {' AND '.join(spl_where)}
                """
                cursor.execute(sql_spl, params)
                rows = cursor.fetchall()
                
                if not rows:
                    # Priority 2: Regular search (strict is_latest = TRUE)
                    where = ["(product_names ILIKE %(q)s OR generic_names ILIKE %(q)s OR active_ingredients ILIKE %(q)s OR set_id ILIKE %(sid)s OR appr_num ILIKE %(q)s)", "is_latest = TRUE"]
                    if human_rx_only: where.append("(doc_type ILIKE '%%HUMAN PRESCRIPTION%%' OR doc_type IN ('34391-3', '48401-4', '48402-2'))")
                    if rld_only and rs_only: where.append("(is_rld = 1 OR is_rs = 1)")
                    elif rld_only: where.append("is_rld = 1")
                    elif rs_only: where.append("is_rs = 1")
                    
                    sql = f"""
                        SELECT s.set_id, s.product_names, s.generic_names, s.manufacturer, s.appr_num, 
                               s.ndc_codes, s.revised_date, s.market_categories, s.doc_type, s.local_path, s.spl_id, s.is_latest,
                               (SELECT COUNT(*) > 1 FROM {schema}sum_spl h WHERE h.set_id = s.set_id) as has_history
                        FROM {schema}sum_spl s 
                        WHERE {' AND '.join(where)} 
                        ORDER BY s.revised_date DESC 
                        LIMIT %(limit)s OFFSET %(offset)s
                    """
                    cursor.execute(sql, params)
                    rows = cursor.fetchall()
            
            results = []
            for r in rows:
                if cls._db_type == 'oracle':
                    results.append({
                        'set_id': r[0], 
                        'brand_name': (r[1] or "").replace(';', ', '), 
                        'generic_name': (r[2] or "").replace(';', ', '), 
                        'manufacturer': r[3], 
                        'appr_num': (r[4] or "")[:50], 
                        'ndc': r[5], 
                        'revised_date': r[6], 
                        'market_category': r[7], 
                        'doc_type': r[8], 
                        'spl_id': r[9],
                        'source': 'Oracle'
                    })
                else:
                    results.append({
                        'set_id': r['set_id'], 
                        'brand_name': (r['product_names'] or "").replace(';', ', '), 
                        'generic_name': (r['generic_names'] or "").replace(';', ', '), 
                        'manufacturer': r['manufacturer'], 
                        'appr_num': (r['appr_num'] or "")[:50], 
                        'ndc': r['ndc_codes'], 
                        'revised_date': r['revised_date'], 
                        'market_category': r['market_categories'], 
                        'doc_type': r['doc_type'], 
                        'local_path': r['local_path'], 
                        'spl_id': r['spl_id'],
                        'is_archived': not r.get('is_latest', True),
                        'source': 'Local Postgres',
                        'has_history': r.get('has_history', False)
                    })
            return results
        finally: conn.close()

    @classmethod
    def get_autocomplete_suggestions(cls, query, limit=10, human_rx_only=False, rld_only=False, rs_only=False):
        if not cls.check_connectivity(): return []
        conn = cls.get_connection()
        if not conn: return []
        try:
            cursor = conn.cursor()
            q = f"%{query}%"
            if cls._db_type == 'oracle':
                where = ["(UPPER(PRODUCT_NAMES) LIKE UPPER(:q) OR UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q))"]
                if human_rx_only: where.append("DOCUMENT_TYPE_LOINC_CODE IN ('34391-3', '48401-4', '48402-2')")
                if rld_only: where.append("EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = druglabel.DGV_SUM_SPL.SPL_ID)")
                sql = f"SELECT DISTINCT PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES FROM druglabel.DGV_SUM_SPL WHERE {' AND '.join(where)} FETCH NEXT 50 ROWS ONLY"
                cursor.execute(sql, {"q": q})
            else:
                schema = "labeling."
                where = ["(product_names ILIKE %(q)s OR generic_names ILIKE %(q)s)", "is_latest = TRUE"]
                if human_rx_only: where.append("(doc_type ILIKE '%%HUMAN PRESCRIPTION%%' OR doc_type IN ('34391-3', '48401-4', '48402-2'))")
                if rld_only and rs_only: where.append("(is_rld = 1 OR is_rs = 1)")
                elif rld_only: where.append("is_rld = 1")
                elif rs_only: where.append("is_rs = 1")
                sql = f"SELECT DISTINCT product_names, generic_names FROM {schema}sum_spl WHERE {' AND '.join(where)} LIMIT 50"
                cursor.execute(sql, {"q": q})
            rows = cursor.fetchall()
            suggestions = set()
            qu = query.upper()
            for r in rows:
                p = (r[0] if cls._db_type == 'oracle' else r['product_names']) or ""
                g = (r[1] if cls._db_type == 'oracle' else r['generic_names']) or ""
                for n in (p.split(';') + g.split(';')):
                    n = n.strip()
                    if n and qu in n.upper():
                        suggestions.add(n)
                        if len(suggestions) >= limit: break
                if len(suggestions) >= limit: break
            return sorted(list(suggestions))
        finally: conn.close()

    @classmethod
    def _get_random_labels_oracle_via_id_sample(cls, cursor, limit, where_clauses, min_pool=30, max_attempts=3, pool_growth=6):
        """
        Cheap random sample for Oracle: pick random SPL_IDs from the indexed ID
        range (DGV_SUM_SPL_ID) and do a single indexed IN-list lookup, instead of
        sorting the *entire* filtered table by DBMS_RANDOM.VALUE on every call.
        DGV_SUM_SPL has no index we're allowed to add, but SPL_ID already is one
        (DGV_SUM_SPL_ID / PK-equivalent), so this stays index-only.

        Retries with a larger candidate pool if filters (human_rx_only/rld_only)
        leave too few matches; caller falls back to the exact old query if this
        still comes up short.
        """
        cursor.execute("SELECT MIN(SPL_ID), MAX(SPL_ID) FROM druglabel.DGV_SUM_SPL")
        lo, hi = cursor.fetchone()
        if lo is None or hi is None or hi <= lo:
            return []

        extra_where = f"AND {' AND '.join(where_clauses)}" if where_clauses else ""
        pool_size = max(min_pool, limit * pool_growth)
        rows = []
        for _ in range(max_attempts):
            pool_size = min(pool_size, hi - lo + 1)
            candidate_ids = random.sample(range(lo, hi + 1), pool_size)
            placeholders = ", ".join(f":id{i}" for i in range(len(candidate_ids)))
            params = {f"id{i}": v for i, v in enumerate(candidate_ids)}
            params["limit"] = limit
            sql = f"""
                SELECT * FROM (
                    SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME,
                           APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, SPL_GUID as SPL_ID
                    FROM druglabel.DGV_SUM_SPL
                    WHERE SPL_ID IN ({placeholders}) {extra_where}
                    ORDER BY DBMS_RANDOM.VALUE
                ) WHERE ROWNUM <= :limit
            """
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            if len(rows) >= limit or pool_size >= (hi - lo + 1):
                break
            pool_size *= pool_growth
        return rows

    @classmethod
    def _get_random_labels_postgres_via_tablesample(cls, cursor, limit, w_stmt, schema, min_pct=1, max_attempts=4, pct_growth=8):
        """
        Cheap random sample for Postgres: TABLESAMPLE SYSTEM grabs a random subset
        of table *blocks* instead of visiting every row, so ORDER BY RANDOM() only
        has to sort that small subset -- not the full labeling.sum_spl table on
        every call. spl_id is a text PK (not sequential), so the ID-range trick
        used for Oracle doesn't apply here; block sampling is the Postgres analog.

        Retries with a larger sample percentage if filters leave too few matches
        (SYSTEM sampling is block-level, so a restrictive WHERE can come up dry
        on a small sample); caller falls back to the exact old query if this
        still comes up short.
        """
        pct = min_pct
        rows = []
        for _ in range(max_attempts):
            sql = f"""
                SELECT s.set_id, s.product_names, s.generic_names, s.manufacturer, s.appr_num,
                       s.ndc_codes, s.revised_date, s.market_categories, s.doc_type, s.local_path, s.spl_id,
                       (SELECT COUNT(*) > 1 FROM {schema}sum_spl h WHERE h.set_id = s.set_id) as has_history
                FROM {schema}sum_spl TABLESAMPLE SYSTEM (%(pct)s) AS s
                {w_stmt}
                ORDER BY RANDOM()
                LIMIT %(limit)s
            """
            cursor.execute(sql, {"limit": limit, "pct": pct})
            rows = cursor.fetchall()
            if len(rows) >= limit or pct >= 100:
                break
            pct = min(100, pct * pct_growth)
        return rows

    @classmethod
    def get_random_labels(cls, limit=5, human_rx_only=False, rld_only=False, rs_only=False):
        if not cls.check_connectivity(): return []
        conn = cls.get_connection()
        if not conn: return []
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                where = []
                if human_rx_only: where.append("DOCUMENT_TYPE_LOINC_CODE IN ('34391-3', '48401-4', '48402-2')")
                if rld_only: where.append("EXISTS (SELECT 1 FROM druglabel.sum_spl_rld rld WHERE rld.SPL_ID = druglabel.DGV_SUM_SPL.SPL_ID)")

                rows = cls._get_random_labels_oracle_via_id_sample(cursor, limit, where)
                if len(rows) < limit:
                    # Filters left too few candidates in the sampled ID pool (or
                    # the pool ran dry) -- fall back to the exact, full-scan
                    # query so correctness never regresses versus the old code.
                    w_stmt = f"WHERE {' AND '.join(where)}" if where else ""
                    sql = f"SELECT * FROM (SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL {w_stmt} ORDER BY DBMS_RANDOM.VALUE) WHERE ROWNUM <= :limit"
                    cursor.execute(sql, {"limit": limit})
                    rows = cursor.fetchall()
            else:
                schema = "labeling."
                where = ["is_latest = TRUE"]
                if human_rx_only: where.append("(doc_type ILIKE '%%HUMAN PRESCRIPTION%%' OR doc_type IN ('34391-3', '48401-4', '48402-2'))")
                if rld_only and rs_only: where.append("(is_rld = 1 OR is_rs = 1)")
                elif rld_only: where.append("is_rld = 1")
                elif rs_only: where.append("is_rs = 1")
                w_stmt = f"WHERE {' AND '.join(where)}" if where else ""

                rows = cls._get_random_labels_postgres_via_tablesample(cursor, limit, w_stmt, schema)
                if len(rows) < limit:
                    # Filters left too few candidates in the sampled blocks (or
                    # the sample ran dry) -- fall back to the exact, full-scan
                    # query so correctness never regresses versus the old code.
                    sql = f"""
                        SELECT s.set_id, s.product_names, s.generic_names, s.manufacturer, s.appr_num,
                               s.ndc_codes, s.revised_date, s.market_categories, s.doc_type, s.local_path, s.spl_id,
                               (SELECT COUNT(*) > 1 FROM {schema}sum_spl h WHERE h.set_id = s.set_id) as has_history
                        FROM {schema}sum_spl s
                        {w_stmt}
                        ORDER BY RANDOM()
                        LIMIT %(limit)s
                    """
                    cursor.execute(sql, {"limit": limit})
                    rows = cursor.fetchall()
            results = []
            for r in rows:
                if cls._db_type == 'oracle':
                    results.append({
                        'set_id': r[0], 
                        'brand_name': (r[1] or "").replace(';', ', '), 
                        'generic_name': (r[2] or "").replace(';', ', '), 
                        'manufacturer': r[3], 
                        'appr_num': r[4], 
                        'ndc': r[5], 
                        'revised_date': r[6], 
                        'market_category': r[7], 
                        'doc_type': r[8], 
                        'spl_id': r[9],
                        'source': 'Oracle'
                    })
                else:
                    results.append({
                        'set_id': r['set_id'], 
                        'brand_name': (r['product_names'] or "").replace(';', ', '), 
                        'generic_name': (r['generic_names'] or "").replace(';', ', '), 
                        'manufacturer': r['manufacturer'], 
                        'appr_num': (r['appr_num'] or "")[:50], 
                        'ndc': r['ndc_codes'], 
                        'revised_date': r['revised_date'], 
                        'market_category': r['market_categories'], 
                        'doc_type': r['doc_type'], 
                        'local_path': r['local_path'], 
                        'spl_id': r['spl_id'],
                        'source': 'Local Postgres',
                        'has_history': r.get('has_history', False)
                    })
            return results
        finally: conn.close()

    @classmethod
    def _chunk(cls, items, n=900):
        for i in range(0, len(items), n):
            yield items[i:i+n]

    @classmethod
    def get_label_core_by_set_ids(cls, set_ids):
        if not set_ids or not cls.check_connectivity(): return {}
        conn = cls.get_connection()
        if not conn: return {}
        out = {}
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                for chunk in cls._chunk(list(set_ids), n=900):
                    binds = {f"sid{i}": v for i, v in enumerate(chunk)}
                    in_clause = ", ".join([f":sid{i}" for i in range(len(chunk))])
                    sql = f"SELECT SET_ID, SPL_GUID as SPL_ID, DOCUMENT_TYPE, DOCUMENT_TYPE_LOINC_CODE FROM druglabel.DGV_SUM_SPL WHERE SET_ID IN ({in_clause})"
                    cursor.execute(sql, binds)
                    for set_id, spl_id, doc_type, doc_loinc in cursor.fetchall():
                        out[str(set_id)] = {"spl_id": spl_id, "document_type": doc_type, "document_type_loinc_code": doc_loinc}
            else:
                schema = "labeling."
                for chunk in cls._chunk(list(set_ids), n=900):
                    sql = f"SELECT set_id, spl_id, doc_type FROM {schema}sum_spl WHERE set_id = ANY(%s) AND is_latest = TRUE"
                    cursor.execute(sql, (list(chunk),))
                    for row in cursor.fetchall():
                        out[str(row['set_id'])] = {"spl_id": row['spl_id'], "document_type": row['doc_type'], "document_type_loinc_code": None}
            cursor.close()
        except Exception as e: print(f"Error in get_label_core_by_set_ids ({cls._db_type}): {e}")
        finally: conn.close()
        return out

    @classmethod
    def effective_time_map_for_set_ids(cls, set_ids):
        if not set_ids or not cls.check_connectivity(): return {}
        conn = cls.get_connection()
        if not conn: return {}
        out = {}
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                for chunk in cls._chunk(list(set_ids), n=900):
                    binds = {f"sid{i}": v for i, v in enumerate(chunk)}
                    in_clause = ", ".join([f":sid{i}" for i in range(len(chunk))])
                    sql = f"SELECT SET_ID, EFF_TIME FROM druglabel.DGV_SUM_SPL WHERE SET_ID IN ({in_clause})"
                    cursor.execute(sql, binds)
                    for sid, eff in cursor.fetchall():
                        out[str(sid)] = eff
            else:
                schema = "labeling."
                for chunk in cls._chunk(list(set_ids), n=900):
                    sql = f"SELECT set_id, revised_date FROM {schema}sum_spl WHERE set_id = ANY(%s) AND is_latest = TRUE"
                    cursor.execute(sql, (list(chunk),))
                    for row in cursor.fetchall():
                        out[str(row['set_id'])] = row['revised_date']
            cursor.close()
        except Exception as e: print(f"Error in effective_time_map_for_set_ids ({cls._db_type}): {e}")
        finally: conn.close()
        return out

    @classmethod
    def ingredient_role_breakdown_for_set_ids(cls, set_ids, substance_name):
        if not set_ids or not substance_name or not cls.check_connectivity():
            return {
                "query": substance_name,
                "ingredients": [],
                "active_count": 0,
                "inactive_count": 0,
                "both_count": 0,
                "not_found_count": len(set_ids or []),
                "matches": {}
            }

        # Split "ACETAMINOPHEN, PHENYLEPHRINE..." into ["ACETAMINOPHEN", "PHENYLEPHRINE", ...]
        ingredients = [
            part.strip().upper()
            for part in substance_name.split(",")
            if part and part.strip()
        ]

        if not ingredients:
            return {
                "query": substance_name,
                "ingredients": [],
                "active_count": 0,
                "inactive_count": 0,
                "both_count": 0,
                "not_found_count": len(set_ids or []),
                "matches": {}
            }

        conn = cls.get_connection()
        if not conn:
            return {}

        matches = {}
        try:
            cursor = conn.cursor()

            if cls._db_type == "oracle":
                for chunk in cls._chunk(list(set_ids), n=900):
                    binds = {f"sid{i}": v for i, v in enumerate(chunk)}
                    sid_in_clause = ", ".join([f":sid{i}" for i in range(len(chunk))])

                    # bind ingredient list as :q0,:q1,... for IN (...)
                    q_binds = {}
                    q_placeholders = []
                    for i, ing in enumerate(ingredients):
                        key = f"q{i}"
                        q_binds[key] = ing
                        q_placeholders.append(f":{key}")
                    binds.update(q_binds)
                    q_in_clause = ", ".join(q_placeholders)

                    sql = f"""
                        SELECT DISTINCT
                            s.SET_ID,
                            m.IS_ACTIVE,
                            UPPER(m.SUBSTANCE_NAME) AS SUBSTANCE_NAME
                        FROM druglabel.PROD_INGR m
                        JOIN druglabel.DGV_SUM_SPL s
                        ON s.SPL_ID = m.SPL_ID
                        WHERE s.SET_ID IN ({sid_in_clause})
                        AND UPPER(m.SUBSTANCE_NAME) IN ({q_in_clause})
                    """
                    cursor.execute(sql, binds)

                    for sid, is_act, matched_name in cursor.fetchall():
                        sid_str = str(sid)
                        if sid_str not in matches:
                            matches[sid_str] = {"active": False, "inactive": False, "matched_ingredients": set()}

                        matches[sid_str]["matched_ingredients"].add(matched_name)

                        if is_act == "Y" or is_act == 1:
                            matches[sid_str]["active"] = True
                        else:
                            matches[sid_str]["inactive"] = True

            else:
                schema = "labeling."
                for chunk in cls._chunk(list(set_ids), n=900):
                    sql = f"""
                        SELECT
                            s.set_id,
                            m.is_active,
                            UPPER(m.substance_name) AS substance_name
                        FROM {schema}active_ingredients_map m
                        JOIN {schema}sum_spl s
                        ON s.spl_id = m.spl_id
                        WHERE s.set_id = ANY(%s)
                        AND UPPER(m.substance_name) = ANY(%s)
                        AND s.is_latest = TRUE
                    """
                    cursor.execute(sql, (list(chunk), ingredients))

                    for row in cursor.fetchall():
                        sid_str = str(row["set_id"])
                        if sid_str not in matches:
                            matches[sid_str] = {"active": False, "inactive": False, "matched_ingredients": set()}

                        matches[sid_str]["matched_ingredients"].add(row["substance_name"])

                        if row["is_active"] == 1:
                            matches[sid_str]["active"] = True
                        else:
                            matches[sid_str]["inactive"] = True

            cursor.close()

        except Exception as e:
            print(f"Error in ingredient_role_breakdown ({cls._db_type}): {e}")
        finally:
            conn.close()

        # Convert sets to lists for JSON serialization + compute counts
        active_c = inactive_c = both_c = 0
        for sid, roles in matches.items():
            # JSON friendly
            if isinstance(roles.get("matched_ingredients"), set):
                roles["matched_ingredients"] = sorted(list(roles["matched_ingredients"]))

            if roles["active"] and roles["inactive"]:
                both_c += 1
            elif roles["active"]:
                active_c += 1
            else:
                inactive_c += 1

        found_set_ids = set(matches.keys())
        return {
            "query": substance_name,
            "ingredients": ingredients,
            "active_count": active_c,
            "inactive_count": inactive_c,
            "both_count": both_c,
            "not_found_count": len(set_ids) - len(found_set_ids),
            "matches": matches
        }

    @classmethod
    def document_type_breakdown_for_set_ids(cls, set_ids):
        if not set_ids or not cls.check_connectivity():
            return {"raw": {}, "buckets": {"human_rx": 0, "human_otc": 0, "vaccine": 0, "animal_rx": 0, "animal_otc": 0, "other": 0, "unknown": 0}}
        conn = cls.get_connection()
        if not conn: return {"raw": {}, "buckets": {"human_rx": 0, "human_otc": 0, "vaccine": 0, "animal_rx": 0, "animal_otc": 0, "other": 0, "unknown": 0}}

        LOINC_MAP = {'34391-3': 'human_rx', '48401-4': 'human_rx', '48402-2': 'human_rx', '34390-5': 'human_otc', '48405-5': 'human_otc', '48406-3': 'human_otc', '34392-1': 'vaccine', '50516-4': 'vaccine', '50517-2': 'animal_rx', '50518-0': 'animal_otc'}
        STR_MAP = {'HUMAN PRESCRIPTION DRUG LABEL': 'human_rx', 'HUMAN OTC DRUG LABEL': 'human_otc', 'VACCINE LABEL': 'vaccine', 'ANIMAL PRESCRIPTION DRUG LABEL': 'animal_rx', 'ANIMAL OTC DRUG LABEL': 'animal_otc'}
        raw, buckets, seen = {}, {"human_rx": 0, "human_otc": 0, "vaccine": 0, "animal_rx": 0, "animal_otc": 0, "other": 0, "unknown": 0}, set()

        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                for chunk in cls._chunk(list(set_ids), n=900):
                    binds = {f"sid{i}": v for i, v in enumerate(chunk)}
                    in_clause = ", ".join([f":sid{i}" for i in range(len(chunk))])
                    sql = f"SELECT s.SET_ID, s.DOCUMENT_TYPE_LOINC_CODE, s.DOCUMENT_TYPE FROM druglabel.DGV_SUM_SPL s WHERE s.SET_ID IN ({in_clause})"
                    cursor.execute(sql, binds)
                    for set_id, loinc_code, doc_type in cursor.fetchall():
                        seen.add(str(set_id))
                        code = loinc_code or doc_type or "UNKNOWN"
                        raw[str(code)] = raw.get(str(code), 0) + 1
            else:
                schema = "labeling."
                for chunk in cls._chunk(list(set_ids), n=900):
                    sql = f"SELECT s.set_id, s.doc_type FROM {schema}sum_spl s WHERE s.set_id = ANY(%s) AND s.is_latest = TRUE"
                    cursor.execute(sql, (list(chunk),))
                    for row in cursor.fetchall():
                        seen.add(str(row["set_id"]))
                        code = row["doc_type"] or "UNKNOWN"
                        raw[str(code)] = raw.get(str(code), 0) + 1
            cursor.close()
        except Exception as e: print(f"Error in document_type_breakdown ({cls._db_type}): {e}")
        finally: conn.close()

        missing = len(set_ids) - len(seen)
        if missing > 0: raw["UNKNOWN"] = raw.get("UNKNOWN", 0) + missing
        for code, count in raw.items():
            mapped = False
            if str(code) in LOINC_MAP:
                buckets[LOINC_MAP[str(code)]] += count
                mapped = True
            else:
                for key, bucket in STR_MAP.items():
                    if key in str(code).upper():
                        buckets[bucket] += count
                        mapped = True
                        break
            if not mapped:
                if str(code) == "UNKNOWN": buckets["unknown"] += count
                else: buckets["other"] += count
        return {"raw": raw, "buckets": buckets}

    @classmethod
    def get_drug_info(cls, drug_name):
        if not cls.check_connectivity(): return None
        conn = cls.get_connection()
        if not conn: return None
        try:
            cursor = conn.cursor()
            if cls._db_type == 'oracle':
                query = "SELECT s.SET_ID, s.APPR_NUM, s.PRODUCT_NAMES, s.PRODUCT_NORMD_GENERIC_NAMES, s.ACT_INGR_NAMES, rld.RLD, s.EFF_TIME FROM druglabel.DGV_SUM_SPL s LEFT JOIN druglabel.sum_spl_rld rld on rld.spl_id = s.spl_id WHERE (UPPER(s.PRODUCT_NAMES) LIKE UPPER(:dn) OR UPPER(s.PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:dn) OR UPPER(s.ACT_INGR_NAMES) LIKE UPPER(:dn)) ORDER BY rld.RLD DESC, s.EFF_TIME DESC FETCH FIRST 1 ROWS ONLY"
                cursor.execute(query, {"dn": drug_name})
                row = cursor.fetchone()
                if not row: cursor.execute(query, {"dn": f"%{drug_name}%"}); row = cursor.fetchone()
                if row: return {"set_id": row[0], "appr_num": row[1], "product_name": row[2], "generic_name": row[3], "active_ingredients": row[4], "is_RLD": row[5], "effective_date": row[6]}
            else:
                schema = "labeling."
                query = f"SELECT set_id, appr_num, product_names, generic_names, active_ingredients, is_rld, is_rs, revised_date FROM {schema}sum_spl WHERE (product_names ILIKE %(dn)s OR generic_names ILIKE %(dn)s OR active_ingredients ILIKE %(dn)s) AND is_latest = TRUE ORDER BY is_rld DESC, is_rs DESC, revised_date DESC LIMIT 1"
                cursor.execute(query, {"dn": drug_name})
                row = cursor.fetchone()
                if not row: cursor.execute(query, {"dn": f"%{drug_name}%"}); row = cursor.fetchone()
                if row: return {"set_id": row['set_id'], "appr_num": row['appr_num'], "product_name": row['product_names'], "generic_name": row['generic_names'], "active_ingredients": row['active_ingredients'], "is_RLD": "Yes" if row['is_rld'] else "No", "is_RS": "Yes" if row['is_rs'] else "No", "effective_date": row['revised_date']}
            cursor.close()
        except Exception as e: print(f"Error in get_drug_info ({cls._db_type}): {e}")
        finally: conn.close()
        return None

    @classmethod
    def get_labels_by_spl_ids_for_export(cls, spl_ids):
        if not spl_ids or not cls.check_connectivity(): return []
        conn = cls.get_connection()
        if not conn: return []
        try:
            cursor = conn.cursor()
            results = []
            if cls._db_type == 'oracle':
                for chunk in cls._chunk(list(spl_ids), n=900):
                    binds = {f"sid{i}": v for i, v in enumerate(chunk)}
                    in_clause = ", ".join([f":sid{i}" for i in range(len(chunk))])
                    sql = f"SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, ROUTES_OF_ADMINISTRATION as ROUTES, DOSAGE_FORMS, EPC, ACT_INGR_NAMES, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL WHERE SPL_GUID IN ({in_clause})"
                    cursor.execute(sql, binds)
                    for row in cursor.fetchall():
                        results.append({'SET ID': row[0], 'Trade Name': (row[1] or "").replace(';', ', '), 'Generic/Proper Name(s)': (row[2] or "").replace(';', ', '), 'Company': row[3], 'Application Number(s)': (row[4] or "")[:50], 'NDC(s)': row[5], 'SPL Effective Date (YYYY/MM/DD)': row[6], 'Marketing Category': row[7], 'Labeling Type': row[8], 'Route(s) of Administration': row[9], 'Dosage Form(s)': row[10], 'Established Pharmacologic Class(es)': row[11], 'Active Ingredient(s)': (row[12] or "").replace(';', ', '), 'FDALabel Link': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{row[0]}", 'DailyMed SPL Link': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={row[0]}", 'DailyMed PDF Link': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={row[0]}", 'SPL ID': row[13]})
            else:
                schema = "labeling."
                for chunk in cls._chunk(list(spl_ids), n=900):
                    sql = f"SELECT set_id, product_names, generic_names, manufacturer, appr_num, ndc_codes, revised_date, market_categories, doc_type, routes, dosage_forms, epc, active_ingredients, spl_id FROM {schema}sum_spl WHERE spl_id = ANY(%s)"
                    cursor.execute(sql, (list(chunk),))
                    for row in cursor.fetchall():
                        rev_date = row['revised_date'] or ""
                        if len(rev_date) == 8 and rev_date.isdigit(): rev_date = f"{rev_date[0:4]}/{rev_date[4:6]}/{rev_date[6:8]}"
                        results.append({'SET ID': row['set_id'], 'Trade Name': (row['product_names'] or "").replace(';', ', '), 'Generic/Proper Name(s)': (row['generic_names'] or "").replace(';', ', '), 'Company': row['manufacturer'], 'Application Number(s)': (row['appr_num'] or "")[:50], 'NDC(s)': row['ndc_codes'], 'SPL Effective Date (YYYY/MM/DD)': rev_date, 'Marketing Category': row['market_categories'], 'Labeling Type': row['doc_type'], 'Route(s) of Administration': row['routes'], 'Dosage Form(s)': row['dosage_forms'], 'Established Pharmacologic Class(es)': row['epc'], 'Active Ingredient(s)': (row['active_ingredients'] or "").replace(';', ', '), 'FDALabel Link': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{row['set_id']}", 'DailyMed SPL Link': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={row['set_id']}", 'DailyMed PDF Link': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={row['set_id']}", 'SPL ID': row['spl_id']})
            return results
        except Exception as e: print(f"Error in export: {e}"); return []
        finally: conn.close()

    @classmethod
    def get_labels_for_export(cls, query_term):
        if not cls.check_connectivity(): return []
        conn = cls.get_connection()
        if not conn: return []
        try:
            cursor = conn.cursor()
            q = f"%{query_term}%"
            if cls._db_type == 'oracle':
                # Priority 1: SPL ID match
                spl_sql = "SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, ROUTES_OF_ADMINISTRATION as ROUTES, DOSAGE_FORMS, EPC, ACT_INGR_NAMES, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL WHERE UPPER(SPL_GUID) = UPPER(:sid)"
                cursor.execute(spl_sql, {"sid": query_term})
                rows = cursor.fetchall()
                
                if not rows:
                    # Priority 2: Regular search
                    sql = "SELECT SET_ID, PRODUCT_NAMES, PRODUCT_NORMD_GENERIC_NAMES, AUTHOR_ORG_NORMD_NAME, APPR_NUM, NDC_CODES, EFF_TIME, MARKET_CATEGORIES, DOCUMENT_TYPE, ROUTES_OF_ADMINISTRATION as ROUTES, DOSAGE_FORMS, EPC, ACT_INGR_NAMES, SPL_GUID as SPL_ID FROM druglabel.DGV_SUM_SPL WHERE UPPER(PRODUCT_NAMES) LIKE UPPER(:q) OR UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:q) OR UPPER(SET_ID) = UPPER(:sid) OR UPPER(APPR_NUM) LIKE UPPER(:q) ORDER BY EFF_TIME DESC"
                    cursor.execute(sql, {"q": q, "sid": query_term})
                    rows = cursor.fetchall()
                
                results = []
                for row in rows:
                    results.append({'SET ID': row[0], 'Trade Name': (row[1] or "").replace(';', ', '), 'Generic/Proper Name(s)': (row[2] or "").replace(';', ', '), 'Company': row[3], 'Application Number(s)': (row[4] or "")[:50], 'NDC(s)': row[5], 'SPL Effective Date (YYYY/MM/DD)': row[6], 'Marketing Category': row[7], 'Labeling Type': row[8], 'Route(s) of Administration': row[9], 'Dosage Form(s)': row[10], 'Established Pharmacologic Class(es)': row[11], 'Active Ingredient(s)': (row[12] or "").replace(';', ', '), 'FDALabel Link': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{row[0]}", 'DailyMed SPL Link': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={row[0]}", 'DailyMed PDF Link': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={row[0]}", 'SPL ID': row[13]})
            else:
                schema = "labeling."
                # Priority 1: SPL ID match
                spl_sql = f"SELECT set_id, product_names, generic_names, manufacturer, appr_num, ndc_codes, revised_date, market_categories, doc_type, routes, dosage_forms, epc, active_ingredients, spl_id FROM {schema}sum_spl WHERE spl_id = %(sid)s"
                cursor.execute(spl_sql, {"sid": query_term})
                rows = cursor.fetchall()
                
                if not rows:
                    # Priority 2: Regular search
                    sql = f"SELECT set_id, product_names, generic_names, manufacturer, appr_num, ndc_codes, revised_date, market_categories, doc_type, routes, dosage_forms, epc, active_ingredients, spl_id FROM {schema}sum_spl WHERE (product_names ILIKE %(q)s OR generic_names ILIKE %(q)s OR set_id = %(sid)s OR appr_num ILIKE %(q)s) AND is_latest = TRUE ORDER BY revised_date DESC"
                    cursor.execute(sql, {"q": q, "sid": query_term})
                    rows = cursor.fetchall()
                
                results = []
                for row in rows:
                    rev_date = row['revised_date'] or ""
                    if len(rev_date) == 8 and rev_date.isdigit(): rev_date = f"{rev_date[0:4]}/{rev_date[4:6]}/{rev_date[6:8]}"
                    results.append({'SET ID': row['set_id'], 'Trade Name': (row['product_names'] or "").replace(';', ', '), 'Generic/Proper Name(s)': (row['generic_names'] or "").replace(';', ', '), 'Company': row['manufacturer'], 'Application Number(s)': (row['appr_num'] or "")[:50], 'NDC(s)': row['ndc_codes'], 'SPL Effective Date (YYYY/MM/DD)': rev_date, 'Marketing Category': row['market_categories'], 'Labeling Type': row['doc_type'], 'Route(s) of Administration': row['routes'], 'Dosage Form(s)': row['dosage_forms'], 'Established Pharmacologic Class(es)': row['epc'], 'Active Ingredient(s)': (row['active_ingredients'] or "").replace(';', ', '), 'FDALabel Link': f"https://nctr-crs.fda.gov/fdalabel/ui/search/spl/{row['set_id']}", 'DailyMed SPL Link': f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={row['set_id']}", 'DailyMed PDF Link': f"https://dailymed.nlm.nih.gov/dailymed/getpdf.cfm?setid={row['set_id']}", 'SPL ID': row['spl_id']})
            return results
        except Exception as e: print(f"Error in export: {e}"); return []
        finally: conn.close()

    @classmethod
    def get_stats(cls):
        """Returns statistics about the local labeling database."""
        if not cls.check_connectivity(): return {"total_labels": 0, "last_updated": None}
        conn = cls.get_connection()
        if not conn: return {"total_labels": 0, "last_updated": None}
        try:
            cursor = conn.cursor()
            stats = {"total_labels": 0, "last_updated": None}
            if cls._db_type == 'oracle':
                cursor.execute("SELECT COUNT(*) FROM druglabel.DGV_SUM_SPL")
                stats["total_labels"] = cls._get_count(cursor.fetchone())
            else:
                schema = "labeling."
                cursor.execute(f"SELECT COUNT(DISTINCT spl_id) FROM {schema}sum_spl")
                stats["total_labels"] = cls._get_count(cursor.fetchone())
                try:
                    cursor.execute(f"SELECT MAX(processed_at) FROM {schema}processed_zips")
                    res = cursor.fetchone()
                    if res:
                        val = res['max'] if isinstance(res, dict) else res[0]
                        if val:
                            stats["last_updated"] = val.strftime("%Y-%m-%d %H:%M") if hasattr(val, 'strftime') else str(val)
                except: pass
            return stats
        except Exception as e:
            print(f"Error in get_stats: {e}")
            return {"total_labels": 0, "last_updated": None}
        finally: conn.close()
