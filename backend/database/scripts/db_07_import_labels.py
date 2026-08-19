import os
import glob
import re
import zipfile
import argparse
import sys
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
import xml.etree.ElementTree as ET

# Dynamic path resolution to support both host execution and container environments
current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

# Add backend directory to sys.path
if (repo_root / 'backend').exists():
    sys.path.append(str(repo_root / 'backend'))
else:
    sys.path.append(str(repo_root))

# Add current scripts directory for local module imports
sys.path.append(str(current_dir))

if os.path.exists('/data'):
    data_dir = Path('/data')
else:
    data_dir = repo_root / 'data'

from pg_utils import PGUtils
from psycopg2 import sql
from psycopg2.extras import execute_values

NS = {'ns': 'urn:hl7-org:v3'}

# FDA's Unique Ingredient Identifier code system. An <ingredientSubstance> can
# carry several <code> elements; only the one on this OID is the UNII.
UNII_CODE_SYSTEM = '2.16.840.1.113883.4.9'

# HL7 ingredient classCodes that mean "active". All three are active — they only
# differ in what the strength is expressed against (basis of strength, moiety,
# reference substance). ACTIR was previously filed as inactive.
ACTIVE_INGREDIENT_CLASS_CODES = ('ACTIB', 'ACTIM', 'ACTIR')


def extract_unii(substance_el):
    """UNII for an <ingredientSubstance>, or '' when it declares none."""
    if substance_el is None:
        return ""
    for code_el in substance_el.findall('ns:code', NS):
        if code_el.get('codeSystem') == UNII_CODE_SYSTEM and code_el.get('code'):
            return code_el.get('code').strip()
    return ""


_ob_dict = {}

# ---------------------------------------------------------------------------
# Marketing category normalization
#
# SPL carries the marketing category twice: a stable NCI Thesaurus concept code
# and a free-text displayName whose CASING VARIES BETWEEN PUBLISHERS. The same
# concept arrives as "NDA authorized generic", "NDA AUTHORIZED GENERIC", and so
# on, which would otherwise fragment any GROUP BY on this column.
#
# Normalizing on the code rather than the text means future imports collapse to
# the same canonical values no matter how a publisher cased them.
# ---------------------------------------------------------------------------
MARKETING_CATEGORY_BY_CODE = {
    'C73584':  'ANDA',
    'C73594':  'NDA',
    'C73585':  'BLA',
    'C73605':  'NDA authorized generic',
    'C200263': 'OTC monograph drug',
    'C73621':  'OTC monograph final',      # superseded by C200263
    'C73620':  'OTC monograph not final',  # superseded by C200263
    'C73614':  'unapproved homeopathic',
    'C73627':  'unapproved drug other',
    'C73613':  'unapproved medical gas',
    'C101533': 'unapproved drug for use in drug shortage',
    'C73626':  'bulk ingredient',
    'C98252':  'bulk ingredient for animal drug compounding',
    'C86952':  'dietary supplement',
    'C86964':  'medical food',
    'C86965':  'cosmetic',
    'C73590':  'export only',
    'C80438':  'exempt device',
    'C96966':  'Emergency Use Authorization',
}

# Uppercased in the fallback below so acronyms survive lowercasing.
_CATEGORY_ACRONYMS = {'OTC', 'NDA', 'ANDA', 'BLA', 'EUA', 'NADA', 'ANADA', 'US'}


def normalize_market_category(code, display_name):
    """
    Canonical marketing category for one <approval><code> element.

    Known concept codes map to a fixed label. Anything unrecognized falls back
    to an acronym-aware lowercasing of the displayName — that cannot know FDA's
    preferred casing for a concept we have never seen, but it does guarantee
    that every casing variant of the SAME concept collapses to one value.
    """
    code = (code or "").strip().upper()
    if code in MARKETING_CATEGORY_BY_CODE:
        return MARKETING_CATEGORY_BY_CODE[code]

    display = " ".join((display_name or "").split())
    if not display:
        return ""
    return " ".join(
        tok.upper() if tok.upper() in _CATEGORY_ACRONYMS else tok.lower()
        for tok in display.split()
    )


# Application-number prefixes accepted from <approval><id extension>. Ordered
# longest-first so alternation cannot match a prefix of a longer type.
# Deliberately excludes the non-application identifiers that share this slot:
# OTC monograph orders ("M020"), statutory citations ("505G(a)(3)"), and CFR
# part references ("part348").
_APP_ID_RE = re.compile(r'^(ANADA|ANDA|NADA|NDA|BLA)\s*[-#]?\s*0*(\d[\d-]*)$', re.IGNORECASE)


def get_el_text(el):
    return "".join(el.itertext()).strip() if el is not None else ""


def _init_worker(ob_dict):
    global _ob_dict
    _ob_dict = ob_dict


def normalize_doc_type(doc_type_raw):
    """
    Normalizes SPL document type (doc_type) string into a clean, canonical uppercase representation.
    Collapses casing variants, removes trailing '.PLR' or ' PLR', and standardizes 'LABELING' -> 'LABEL'.
    """
    if not doc_type_raw:
        return ""
    dt = " ".join((doc_type_raw or "").strip().split()).upper()
    dt = re.sub(r'\.?\s*PLR\b', '', dt, flags=re.IGNORECASE).strip()
    dt = dt.replace('LABELING', 'LABEL')
    return dt


def normalize_effective_date(eff_val):
    """
    Returns:
        revised_date_str: 'YYYY-MM-DD' or None
        effective_time_raw: original value or ''
    """
    eff_val = (eff_val or "").strip()
    if len(eff_val) >= 8 and eff_val[:8].isdigit():
        return f"{eff_val[:4]}-{eff_val[4:6]}-{eff_val[6:8]}", eff_val
    return None, eff_val


def extract_approvals(root, doc_title=""):
    """
    Pull application numbers and marketing categories out of the SPL approval
    block. Both live in ATTRIBUTES, not element text:

        <subjectOf><approval>
          <id extension="ANDA212571" root="2.16.840.1.113883.3.150"/>
          <code code="C73584" displayName="ANDA"/>

    Application numbers are normalized to the Orange Book key format built by
    load_orange_book(): type, single space, number zero-padded to six digits
    ("ANDA 212571"). Without that padding a five-digit number would never match.

    Returns (appr_nums, market_categories) — a de-duplicated list preserving
    document order, and a "; "-joined category string.
    """
    appr_nums = []
    categories = []

    def add_appr(kind, number):
        # Orange Book keys pad the human-drug number to six digits, so an
        # unpadded five-digit number would never match without this. Animal
        # drug numbers use a NNN-NNN form and are left alone.
        number = number.zfill(6) if number.isdigit() else number
        normalized = f"{kind.upper()} {number}"
        if normalized not in appr_nums:
            appr_nums.append(normalized)
        kind_upper = kind.upper()
        if kind_upper in ('NDA', 'ANDA', 'BLA', 'NADA', 'ANADA') and kind_upper not in categories:
            categories.append(kind_upper)

    for approval in root.findall('.//ns:subjectOf/ns:approval', NS):
        code_el = approval.find('ns:code', NS)
        if code_el is not None:
            category = normalize_market_category(
                code_el.get('code'), code_el.get('displayName')
            )
            if category and category not in categories:
                categories.append(category)

        id_el = approval.find('ns:id', NS)
        extension = (id_el.get('extension') or "").strip() if id_el is not None else ""
        if not extension:
            continue
        # e.g. "ANDA212571", occasionally "NDA 020500"
        m = _APP_ID_RE.match(extension)
        if m:
            add_appr(m.group(1), m.group(2))

    # Fall back to prose for labels that state the number in the title or body
    # rather than the approval block.
    if not appr_nums:
        m = re.search(r'(NDA|ANDA|BLA)\s*(\d{5,6})', doc_title, re.IGNORECASE)
        if not m:
            for text in root.itertext():
                m = re.search(r'(NDA|ANDA|BLA)\s*(\d{5,6})', text or "", re.IGNORECASE)
                if m:
                    break
        if m:
            add_appr(m.group(1), m.group(2))

    # Sorted, not document order: a label covering several products yields
    # several categories, and two labels with the same set must produce the
    # same string or they fragment a GROUP BY exactly like casing variants do.
    return appr_nums, "; ".join(sorted(categories, key=str.casefold))


def parse_spl_zip(zip_path):
    """
    Worker function to parse a single SPL ZIP file.
    Uses global _rld_appl_nos / _rs_appl_nos for speed.
    """
    try:
        with zipfile.ZipFile(zip_path, 'r') as z:
            xml_files = [f for f in z.namelist() if f.endswith('.xml')]
            if not xml_files:
                return None
            with z.open(xml_files[0]) as xml_file:
                tree = ET.parse(xml_file)
                root = tree.getroot()

        # Extract spl_id (UUID)
        spl_id_el = root.find('ns:id', NS)
        spl_id = (spl_id_el.get('root') if spl_id_el is not None else "").strip().lower()
        if not spl_id:
            return None

        # Extract set_id
        set_id_el = root.find('ns:setId', NS)
        set_id = (set_id_el.get('root') if set_id_el is not None else "").strip().lower()

        # Extract version number
        ver_el = root.find('ns:versionNumber', NS)
        version_number = int(ver_el.get('value')) if ver_el is not None and ver_el.get('value').isdigit() else 1

        # Extract doc_type (document code / displayName)
        code_el = root.find('ns:code', NS)
        doc_type_raw = code_el.get('displayName') if code_el is not None else ""
        doc_type = normalize_doc_type(doc_type_raw)

        # revised_date / effectiveTime
        eff_el = root.find('ns:effectiveTime', NS)
        revised_date = None
        effective_time_raw = ""
        if eff_el is not None:
            revised_date, effective_time_raw = normalize_effective_date(eff_el.get('value'))

        # Extract title (product / document title)
        title_el = root.find('ns:title', NS)
        doc_title = get_el_text(title_el) if title_el is not None else ""

        # Extract manufacturer / applicant names
        manuf_name = ""
        manuf_el = root.find('.//ns:representedOrganization/ns:name', NS)
        if manuf_el is not None:
            manuf_name = get_el_text(manuf_el)
        else:
            cust_el = root.find('.//ns:assignedOrganization/ns:name', NS)
            if cust_el is not None:
                manuf_name = get_el_text(cust_el)

        # Parse products, ingredients, dosage forms, routes, NDC codes
        product_names = set()
        dosage_forms = set()
        routes = set()
        ndc_codes = set()
        active_ingredients = set()
        ingr_map = []

        # Find all manufacturedProduct sections
        manuf_products = root.findall('.//ns:manufacturedProduct/ns:manufacturedProduct', NS)
        for mp in manuf_products:
            # Name
            name_el = mp.find('ns:name', NS)
            if name_el is not None:
                product_names.add(get_el_text(name_el))

            # Dosage Form
            df_el = mp.find('ns:formCode', NS)
            if df_el is not None:
                dosage_forms.add(df_el.get('displayName') or "")

            # NDC codes (from code element)
            code_el = mp.find('ns:code', NS)
            if code_el is not None:
                ndc = code_el.get('code')
                if ndc:
                    ndc_codes.add(ndc)

            # Ingredients, active and inactive.
            #
            # The substance is always a direct <ingredientSubstance> child, and
            # its UNII is the <code> whose codeSystem is the FDA UNII OID —
            # never an <id extension>. Reading <id extension> is why every UNII
            # in active_ingredients_map was blank, and matching <activeMoiety>
            # instead of <ingredientSubstance> is why inactive ingredients (which
            # have no moiety) were dropped and active ones were recorded under
            # their moiety name ("DOXORUBICIN" rather than the labeled
            # "DOXORUBICIN HYDROCHLORIDE").
            #
            # This now matches admin/tasks/import_labels.py and
            # import_archive_labels.py, which always parsed it this way.
            for ing in mp.findall('ns:ingredient', NS):
                class_code = ing.get('classCode') or ""
                is_active = 1 if class_code in ACTIVE_INGREDIENT_CLASS_CODES else 0

                substance = ing.find('ns:ingredientSubstance', NS)
                if substance is None:
                    continue

                name_sub = get_el_text(substance.find('ns:name', NS))
                if not name_sub:
                    continue

                unii = extract_unii(substance)
                if is_active:
                    active_ingredients.add(name_sub)
                ingr_map.append({
                    'substance_name': name_sub,
                    'unii': unii,
                    'is_active': is_active
                })

                # The active moiety is a distinct substance with its own UNII
                # ("METFORMIN" under "METFORMIN HYDROCHLORIDE"), and a UNII
                # search is expected to find a label by either. Recording it
                # also keeps active_ingredients a superset of what the previous
                # moiety-only parsing produced, so no existing name search
                # narrows because of this fix.
                if is_active:
                    for moiety in substance.findall('.//ns:activeMoiety/ns:activeMoiety', NS):
                        moiety_name = get_el_text(moiety.find('ns:name', NS))
                        if not moiety_name or moiety_name == name_sub:
                            continue
                        active_ingredients.add(moiety_name)
                        ingr_map.append({
                            'substance_name': moiety_name,
                            'unii': extract_unii(moiety),
                            'is_active': is_active
                        })

        # Routes of administration
        consumed_products = root.findall('.//ns:consumedIn/ns:substanceAdministration', NS)
        for ca in consumed_products:
            route_el = ca.find('ns:routeCode', NS)
            if route_el is not None:
                routes.add(route_el.get('displayName') or "")

        # Application number(s) and marketing category from the approval block
        appr_nums, market_categories = extract_approvals(root, doc_title)
        appr_num = appr_nums[0] if appr_nums else ""

        # Check if RLD / RS based on Orange Book dictionary. A label can cover
        # several products, so check every application number it declares and
        # remember which one matched for the approval-year lookup below.
        is_rld = 0
        is_rs = 0
        ob_key = ""
        for candidate in appr_nums:
            ob_data = _ob_dict.get(candidate)
            if not ob_data:
                continue
            if not ob_key:
                ob_key = candidate
            if ob_data.get('rld') == 'YES':
                is_rld = 1
            if ob_data.get('rs') == 'YES':
                is_rs = 1

        # Section bodies are deliberately not extracted. They used to be stored
        # in labeling.spl_sections to back full-text search; that search is gone,
        # and the label viewer reads the SPL XML straight off disk via
        # sum_spl.local_path, so keeping a second copy in Postgres bought
        # nothing but size.

        # Pack results
        metadata = {
            'spl_id': spl_id,
            'set_id': set_id,
            'product_names': "; ".join(product_names),
            'generic_names': "; ".join(active_ingredients),
            'manufacturer': manuf_name,
            'appr_num': appr_num,
            'active_ingredients': "; ".join(active_ingredients),
            'market_categories': market_categories,
            'doc_type': doc_type,
            'routes': "; ".join(routes),
            'dosage_forms': "; ".join(dosage_forms),
            'epc': "",  # Populated in post-processing mapping phase
            'ndc_codes': "; ".join(ndc_codes),
            'revised_date': revised_date,
            'initial_approval_year': None,
            'is_rld': is_rld,
            'is_rs': is_rs,
            'local_path': os.path.basename(zip_path),
            'effective_time_raw': effective_time_raw,
            'version_number': version_number
        }

        # Resolve initial approval year from the Orange Book entry that matched
        if ob_key and _ob_dict[ob_key].get('approval_date'):
            appr_date = _ob_dict[ob_key]['approval_date']
            year_match = re.search(r'\d{4}', appr_date)
            if year_match:
                metadata['initial_approval_year'] = int(year_match.group(0))

        # A label repeats the same substance once per manufacturedProduct (and
        # now once more per active moiety), so de-duplicate before insert. The
        # table has no unique constraint, and the rows carry no per-product
        # information, so duplicates are pure bloat.
        seen_ingr = set()
        unique_ingr = []
        for i in ingr_map:
            key = (i['substance_name'], i['unii'], i['is_active'])
            if key in seen_ingr:
                continue
            seen_ingr.add(key)
            unique_ingr.append(i)

        return {
            'spl_id': spl_id,
            'metadata': metadata,
            'ingr_map': [{'spl_id': spl_id, **i} for i in unique_ingr],
        }

    except Exception:
        return None


def unpack_bulk_zips(downloads_dir, storage_dir, filter_type='human'):
    """
    Phase 1: Unpack giant ZIP files from downloads_dir into storage_dir.
    """
    d_dir = downloads_dir
    if downloads_dir.startswith('data/'):
        d_dir = downloads_dir[5:]
    elif downloads_dir.startswith('data\\'):
        d_dir = downloads_dir[5:]
        
    s_dir = storage_dir
    if storage_dir.startswith('data/'):
        s_dir = storage_dir[5:]
    elif storage_dir.startswith('data\\'):
        s_dir = storage_dir[5:]

    downloads_path = data_dir / d_dir
    storage_path = data_dir / s_dir
    storage_path.mkdir(parents=True, exist_ok=True)

    bulk_zips = glob.glob(str(downloads_path / "*.zip"))
    if not bulk_zips:
        print(f"No bulk ZIP files found in {downloads_path}")
        return

    processed = set()
    try:
        rows = PGUtils.execute_query("SELECT zip_name FROM labeling.processed_zips", fetch=True)
        processed = {r['zip_name'] for r in rows}
    except Exception:
        pass

    filter_map = {
        'prescription': ['prescription/'],
        'human': ['prescription/', 'otc/', 'homeopathic/', 'other/'],
        'all': ['']
    }
    prefixes = filter_map.get(filter_type, [''])

    for zip_path in bulk_zips:
        zip_name = os.path.basename(zip_path)
        if zip_name in processed:
            print(f"Skipping already processed bulk ZIP: {zip_name}")
            continue

        print(f"Unpacking bulk ZIP: {zip_name}...")
        try:
            with zipfile.ZipFile(zip_path, 'r') as main_z:
                all_members = main_z.namelist()
                nested_zips = [
                    f for f in all_members
                    if f.endswith('.zip') and any(f.startswith(p) for p in prefixes)
                ]

                for nz_name in nested_zips:
                    inner_name = os.path.basename(nz_name)
                    out_path = storage_path / inner_name
                    if not out_path.exists():
                        with main_z.open(nz_name) as source, open(out_path, 'wb') as target:
                            target.write(source.read())

            PGUtils.execute_query(
                "INSERT INTO labeling.processed_zips (zip_name) VALUES (%s) ON CONFLICT DO NOTHING",
                (zip_name,)
            )
        except Exception as e:
            print(f"Error unpacking {zip_name}: {e}")


def load_orange_book():
    ob_dict = {}
    ob_path = data_dir / 'downloads' / 'OrangeBook' / 'EOB_Latest' / 'products.txt'

    if ob_path.exists():
        try:
            with open(ob_path, 'r', encoding='latin-1') as f:
                f.readline()
                for line in f:
                    parts = line.split('~')
                    if len(parts) > 11:
                        raw_type = parts[5].strip().upper()
                        appl_type = 'NDA' if raw_type == 'N' else 'ANDA' if raw_type == 'A' else raw_type
                        
                        appl_no = parts[6].strip()
                        if len(appl_no) < 6:
                            appl_no = appl_no.zfill(6)
                            
                        ob_dict[f"{appl_type} {appl_no}"] = {
                            'rld': parts[10].strip().upper(),
                            'rs': parts[11].strip().upper(),
                            'approval_date': parts[9].strip()
                        }
        except Exception as e:
            print(f"Error loading Orange Book details: {e}")
    return ob_dict


def ensure_schema():
    """Initializes schemas and tables if they do not exist."""
    PGUtils.execute_query("CREATE SCHEMA IF NOT EXISTS labeling;")
    PGUtils.execute_query("""
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
            local_path TEXT,
            effective_time_raw TEXT,
            version_number INTEGER,
            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            is_latest BOOLEAN DEFAULT FALSE,
            parent_spl_id TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sum_spl_set_id ON labeling.sum_spl(set_id);

        CREATE TABLE IF NOT EXISTS labeling.active_ingredients_map (
            id INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
            spl_id TEXT,
            substance_name TEXT,
            unii TEXT,
            is_active INTEGER,
            FOREIGN KEY(spl_id) REFERENCES labeling.sum_spl(spl_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_active_ingr_spl_id ON labeling.active_ingredients_map(spl_id);

        CREATE TABLE IF NOT EXISTS labeling.epc_map (
            id INTEGER PRIMARY KEY GENERATED BY DEFAULT AS IDENTITY,
            spl_id TEXT,
            epc_term TEXT,
            FOREIGN KEY(spl_id) REFERENCES labeling.sum_spl(spl_id) ON DELETE CASCADE,
            UNIQUE (spl_id, epc_term)
        );
        CREATE INDEX IF NOT EXISTS idx_epc_map_spl_id ON labeling.epc_map(spl_id);
    """)


def _flush_batches(meta_batch, ingr_batch, reload_spl_ids):
    """Upsert bulk data into the database."""
    conn = PGUtils.get_connection()
    try:
        conn.autocommit = False
        with conn.cursor() as cur:
            # Delete old mappings for modified/updated spl_ids
            if reload_spl_ids:
                cur.execute(
                    sql.SQL("DELETE FROM labeling.sum_spl WHERE spl_id IN ({})").format(
                        sql.SQL(', ').join([sql.Literal(x) for x in reload_spl_ids])
                    )
                )

            # 1. Insert Metadata
            meta_cols = [
                'spl_id', 'set_id', 'product_names', 'generic_names', 'manufacturer', 'appr_num',
                'active_ingredients', 'market_categories', 'doc_type', 'routes', 'dosage_forms',
                'epc', 'ndc_codes', 'revised_date', 'initial_approval_year', 'is_rld', 'is_rs',
                'local_path', 'effective_time_raw', 'version_number'
            ]
            meta_sql = f"""
                INSERT INTO labeling.sum_spl ({', '.join(meta_cols)}) 
                VALUES %s
                ON CONFLICT (spl_id) DO UPDATE SET
                    set_id = EXCLUDED.set_id,
                    product_names = EXCLUDED.product_names,
                    generic_names = EXCLUDED.generic_names,
                    manufacturer = EXCLUDED.manufacturer,
                    appr_num = EXCLUDED.appr_num,
                    active_ingredients = EXCLUDED.active_ingredients,
                    market_categories = EXCLUDED.market_categories,
                    doc_type = EXCLUDED.doc_type,
                    routes = EXCLUDED.routes,
                    dosage_forms = EXCLUDED.dosage_forms,
                    ndc_codes = EXCLUDED.ndc_codes,
                    revised_date = EXCLUDED.revised_date,
                    initial_approval_year = EXCLUDED.initial_approval_year,
                    is_rld = EXCLUDED.is_rld,
                    is_rs = EXCLUDED.is_rs,
                    local_path = EXCLUDED.local_path,
                    effective_time_raw = EXCLUDED.effective_time_raw,
                    version_number = EXCLUDED.version_number
            """
            meta_rows = [[d[c] for c in meta_cols] for d in meta_batch]
            execute_values(cur, meta_sql, meta_rows, page_size=300)

            # 2. Insert Active Ingredients Mapping
            if ingr_batch:
                ingr_cols = ['spl_id', 'substance_name', 'unii', 'is_active']
                ingr_rows = [[d[c] for c in ingr_cols] for d in ingr_batch]
                ingr_sql = f"INSERT INTO labeling.active_ingredients_map ({', '.join(ingr_cols)}) VALUES %s"
                execute_values(cur, ingr_sql, ingr_rows, page_size=500)

        conn.commit()

    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def sync_from_storage(storage_dir, num_workers=4, force=False, refresh_existing=False):
    """
    Main sync behavior:
    - default: import only SPLs whose spl_id is not already in DB
    - --refresh-existing: reparse and upsert even if spl_id already exists
    - --force: synonym for reparsing everything
    """
    s_dir = storage_dir
    if storage_dir.startswith('data/'):
        s_dir = storage_dir[5:]
    elif storage_dir.startswith('data\\'):
        s_dir = storage_dir[5:]

    storage_path = data_dir / s_dir
    zip_files = sorted(glob.glob(str(storage_path / "*.zip")))

    if not zip_files:
        print(f"No ZIP files found in {storage_path}")
        return

    print(f"Found {len(zip_files)} ZIP files in {storage_dir}")
    ob_dict = load_orange_book()
    ensure_schema()

    existing_spl_ids = set()
    if not force and not refresh_existing:
        try:
            results = PGUtils.execute_query("SELECT spl_id FROM labeling.sum_spl", fetch=True)
            existing_spl_ids = {r['spl_id'] for r in results}
            print(f"Skipping {len(existing_spl_ids)} SPLs already in database.")
        except Exception:
            pass
    else:
        print("Refresh mode enabled: existing SPLs will be reparsed and upserted.")

    batch_size = 300
    meta_batch = []
    ingr_batch = []
    reload_spl_ids = []

    processed = 0
    skipped = 0
    failed = 0

    print(f"Starting multi-process parsing (workers={num_workers})...")

    with ProcessPoolExecutor(
        max_workers=num_workers,
        initializer=_init_worker,
        initargs=(ob_dict,)
    ) as executor:
        future_to_zip = {executor.submit(parse_spl_zip, zp): zp for zp in zip_files}

        for i, future in enumerate(as_completed(future_to_zip), start=1):
            try:
                data = future.result()
            except Exception:
                failed += 1
                continue

            if not data:
                failed += 1
                continue

            spl_id = data['spl_id']

            if not force and not refresh_existing and spl_id in existing_spl_ids:
                skipped += 1
            else:
                meta_batch.append(data['metadata'])
                ingr_batch.extend(data['ingr_map'])
                reload_spl_ids.append(spl_id)
                processed += 1

            if len(meta_batch) >= batch_size or i == len(zip_files):
                if meta_batch:
                    try:
                        _flush_batches(meta_batch, ingr_batch, reload_spl_ids)
                    except Exception as e:
                        print(f"\n[ERROR] Batch insertion failed: {e}")

                meta_batch = []
                ingr_batch = []
                reload_spl_ids = []

            if i % 100 == 0 or i == len(zip_files):
                sys.stdout.write(
                    f"\rProgress: {i}/{len(zip_files)} | Imported: {processed} | Skipped: {skipped} | Failed: {failed}"
                )
                sys.stdout.flush()

    print(f"\nFinished Sync. Imported: {processed}, Skipped: {skipped}, Failed: {failed}")
    refresh_version_lineage()
    refresh_epc_mappings()
    refresh_query_options_cache()
    try:
        try:
            from db_02_init_labeling_schema import ensure_search_indexes
        except ImportError:
            from database.scripts.db_02_init_labeling_schema import ensure_search_indexes
        ensure_search_indexes()
    except Exception as e:
        print(f"[WARN] Failed to ensure search indexes post-sync: {e}")


def refresh_query_options_cache():
    print("Refreshing query options statistics cache in labeling.query_options_cache...")
    columns = [
        ('labelingTypes', 'doc_type'),
        ('routes', 'routes'),
        ('dosageForms', 'dosage_forms'),
    ]
    
    # Clean stale cache
    try:
        PGUtils.execute_query("DELETE FROM labeling.query_options_cache;")
    except Exception:
        pass

    queries = []
    
    # 1. Column counts (doc_type, routes, dosage_forms)
    for category, col in columns:
        queries.append(f"""
            INSERT INTO labeling.query_options_cache (category, key_name, item_count, updated_at)
            SELECT '{category}' AS category, value AS key_name, COUNT(*) AS item_count, CURRENT_TIMESTAMP
            FROM (
                SELECT TRIM(unnest(string_to_array(s.{col}, ';'))) AS value
                FROM labeling.sum_spl s
                WHERE s.is_latest = TRUE AND s.{col} IS NOT NULL AND s.{col} <> ''
            ) t
            WHERE value <> ''
            GROUP BY value
            ON CONFLICT (category, key_name) 
            DO UPDATE SET item_count = EXCLUDED.item_count, updated_at = CURRENT_TIMESTAMP;
        """)

    # 1b. Application Types (combining market_categories and appr_num prefixes)
    queries.append("""
        INSERT INTO labeling.query_options_cache (category, key_name, item_count, updated_at)
        SELECT 'applicationTypes' AS category, value AS key_name, COUNT(DISTINCT set_id) AS item_count, CURRENT_TIMESTAMP
        FROM (
            SELECT set_id, TRIM(unnest(string_to_array(s.market_categories, ';'))) AS value
            FROM labeling.sum_spl s
            WHERE s.is_latest = TRUE AND s.market_categories IS NOT NULL AND s.market_categories <> ''
            UNION ALL
            SELECT set_id, UPPER(TRIM(split_part(unnest(string_to_array(s.appr_num, ';')), ' ', 1))) AS value
            FROM labeling.sum_spl s
            WHERE s.is_latest = TRUE AND s.appr_num IS NOT NULL AND s.appr_num <> ''
        ) t
        WHERE value <> ''
        GROUP BY value
        ON CONFLICT (category, key_name) 
        DO UPDATE SET item_count = EXCLUDED.item_count, updated_at = CURRENT_TIMESTAMP;
    """)

    # 2. Total labels count ('SPLTITLE')
    queries.append("""
        INSERT INTO labeling.query_options_cache (category, key_name, item_count, updated_at)
        SELECT 'db_counts', 'SPLTITLE', COUNT(DISTINCT set_id), CURRENT_TIMESTAMP
        FROM labeling.sum_spl WHERE is_latest = TRUE
        ON CONFLICT (category, key_name) 
        DO UPDATE SET item_count = EXCLUDED.item_count, updated_at = CURRENT_TIMESTAMP;
    """)

    # 3. Approved labels count ('43683-2')
    queries.append("""
        INSERT INTO labeling.query_options_cache (category, key_name, item_count, updated_at)
        SELECT 'db_counts', '43683-2', COUNT(DISTINCT set_id), CURRENT_TIMESTAMP
        FROM labeling.sum_spl WHERE is_latest = TRUE AND initial_approval_year IS NOT NULL
        ON CONFLICT (category, key_name) 
        DO UPDATE SET item_count = EXCLUDED.item_count, updated_at = CURRENT_TIMESTAMP;
    """)

    for q in queries:
        try:
            PGUtils.execute_query(q)
        except Exception as e:
            print(f"[WARN] Failed options cache query: {e}")


def refresh_version_lineage():
    print("Refreshing SPL version lineage tracking...")
    PGUtils.execute_query("""
        -- Reset latest status
        UPDATE labeling.sum_spl SET is_latest = FALSE;

        -- Identify and mark latest version per set_id
        WITH latest_version AS (
            SELECT spl_id, ROW_NUMBER() OVER(PARTITION BY set_id ORDER BY version_number DESC, revised_date DESC) as rn
            FROM labeling.sum_spl
        )
        UPDATE labeling.sum_spl s
        SET is_latest = TRUE
        FROM latest_version l
        WHERE s.spl_id = l.spl_id AND l.rn = 1;
    """)


def refresh_epc_mappings():
    print("Triggering EPC relationship mappings post-sync...")
    # Matches substance UNII/name mapping to EPC class structures
    PGUtils.execute_query("""
        INSERT INTO labeling.epc_map (spl_id, epc_term)
        SELECT DISTINCT m.spl_id, i.indexing_name
        FROM labeling.active_ingredients_map m
        JOIN labeling.substance_indexing i ON (
            (m.unii != '' AND m.unii = i.substance_unii) OR 
            (m.unii = '' AND UPPER(m.substance_name) = UPPER(i.substance_name))
        )
        WHERE i.indexing_type = 'EPC' AND m.is_active = 1
        ON CONFLICT DO NOTHING;

        WITH agg_epc AS (
            SELECT spl_id, string_agg(DISTINCT epc_term, '; ') as epcs
            FROM labeling.epc_map
            GROUP BY spl_id
        )
        UPDATE labeling.sum_spl s
        SET epc = a.epcs
        FROM agg_epc a
        WHERE s.spl_id = a.spl_id;
    """)


def main():
    parser = argparse.ArgumentParser(description="DailyMed to PostgreSQL Sync Pipeline (version-aware).")
    parser.add_argument("--downloads-dir", default="data/downloads/dailymed", help="Source for bulk ZIPs")
    parser.add_argument("--storage-dir", default="data/spl_storage", help="Target for extracted labeling ZIPs")
    parser.add_argument("--filter", choices=['prescription', 'human', 'all'], default='human', help="Unpacking filter")
    parser.add_argument("--skip-unpack", action="store_true", help="Skip the unpacking phase")
    parser.add_argument("--workers", type=int, default=4, help="Number of worker processes")
    parser.add_argument("--force", action="store_true", help="Reparse and upsert all labels")
    parser.add_argument("--refresh-existing", action="store_true", help="Reparse and upsert existing spl_id values too")

    args = parser.parse_args()

    print("=== Phase 1: Unpacking Bulk ZIPs ===")
    if not args.skip_unpack:
        unpack_bulk_zips(args.downloads_dir, args.storage_dir, args.filter)
    else:
        print("Unpacking phase skipped.")

    print("\n=== Phase 2: Syncing to PostgreSQL ===")
    sync_from_storage(
        args.storage_dir,
        num_workers=args.workers,
        force=args.force,
        refresh_existing=args.refresh_existing
    )


if __name__ == "__main__":
    main()
