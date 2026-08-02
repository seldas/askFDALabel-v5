"""
drugtox/routes.py  (drop-in replacement)

Goal:
- Keep Postgres-safe quoted identifiers (mixed-case columns)
- Return JSON keys that MATCH the existing frontend expectations:
  SETID, Trade_Name, Generic_Proper_Names, Toxicity_Class, Author_Organization,
  Tox_Type, SPL_Effective_Time, Changed, is_historical, etc.
- Avoid closing Flask-SQLAlchemy sessions manually.
"""

from flask import Blueprint, request, jsonify, current_app
from sqlalchemy import text
from collections import defaultdict
from database.extensions import db
from openpyxl import Workbook
import tempfile
from flask import send_file
from datetime import datetime

drugtox_bp = Blueprint("drugtox", __name__)

# If your drug_toxicity table is in schema "public"
PG_SCHEMA = "public"


def qname(name: str) -> str:
    """Quote identifiers safely for mixed-case columns and reserved words."""
    return '"' + name.replace('"', '""') + '"'


def fq_table(table: str, schema: str = PG_SCHEMA) -> str:
    """Fully-qualified table name with schema."""
    return f"{qname(schema)}.{qname(table)}"


def get_db_session():
    # Flask-SQLAlchemy scoped session
    return db.session


# -----------------------
# Helpers (consistency)
# -----------------------

# Canonical columns your frontend expects for DrugSummary/Detail/History/Market
DRUG_COLS = [
    "SETID",
    "Trade_Name",
    "Generic_Proper_Names",
    "Toxicity_Class",
    "Author_Organization",
    "Tox_Type",
    "SPL_Effective_Time",
    "is_historical",
    "endpoint",
]

# In some tables you might have additional fields (detail view)
DETAIL_EXTRA_COLS = [
    "Update_Notes",
    "Explanations",
    "AI_Summary",
]


def select_cols(cols):
    """
    Build a SELECT list that preserves exact mixed-case keys in result mapping.
    Example: "Toxicity_Class" AS "Toxicity_Class"
    """
    return ",\n               ".join([f"{qname(c)} AS {qname(c)}" for c in cols])


def rowdicts(rows):
    out = []
    for r in rows:
        d = dict(r._mapping)
        if "Explanations" in d:
            d["Evidence"] = d["Explanations"]
        out.append(d)
    return out


# -----------------------
# Routes
# -----------------------

@drugtox_bp.route("/stats")
def get_stats():
    tox_type = request.args.get("tox_type", "DILI")
    sess = get_db_session()

    # IMPORTANT: return Toxicity_Class key (frontend expects it)
    dist_query = text(f"""
        SELECT {qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
               COUNT(*) AS count
        FROM {fq_table("drug_toxicity")}
        WHERE {qname("Tox_Type")} = :tox
          AND {qname("is_historical")} = 0
        GROUP BY {qname("Toxicity_Class")}
    """)
    dist = sess.execute(dist_query, {"tox": tox_type}).fetchall()

    changes_query = text(f"""
        SELECT COUNT(*) AS count
        FROM {fq_table("drug_toxicity")}
        WHERE {qname("Tox_Type")} = :tox
          AND {qname("is_historical")} = 0
    """)
    total_changes = sess.execute(changes_query, {"tox": tox_type}).scalar()

    return jsonify({
        "distribution": rowdicts(dist),
        "total_changes": int(total_changes or 0),
    })


@drugtox_bp.route("/drugs")
def get_drugs():
    q = request.args.get("q", "")
    tox_type = request.args.get("tox_type", "DILI")
    is_oral = request.args.get("oral") == "true"
    is_plr = request.args.get("plr") == "true"
    page = int(request.args.get("page", 1))
    limit = int(request.args.get("limit", 20))
    offset = (page - 1) * limit

    sess = get_db_session()

    where_clauses = ["s.is_latest = TRUE"]
    params = {"tox": tox_type, "limit": limit, "offset": offset}

    if q:
        where_clauses.append(
            "(s.set_id = :q_exact OR "
            " s.appr_num ILIKE :q OR "
            " s.product_names ILIKE :q OR "
            " s.generic_names ILIKE :q OR "
            " s.manufacturer ILIKE :q)"
        )
        params["q"] = f"%{q}%"
        params["q_exact"] = q
    else:
        where_clauses.append(f"dt.{qname('SETID')} IS NOT NULL")

    where_clauses.append(f"(dt.{qname('is_historical')} = 0 OR dt.{qname('is_historical')} IS NULL)")
    if is_oral:
        where_clauses.append(
            "(s.routes ILIKE '%ORAL%' OR "
            "s.dosage_forms ILIKE '%TABLET%' OR "
            "s.dosage_forms ILIKE '%CAPSULE%' OR "
            "s.dosage_forms ILIKE '%PILL%' OR "
            "s.dosage_forms ILIKE '%SOLUTION%' OR "
            "s.dosage_forms ILIKE '%SUSPENSION%' OR "
            "s.dosage_forms ILIKE '%SYRUP%')"
        )
        
    if is_plr:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM labeling.spl_sections sec WHERE sec.spl_id = s.spl_id AND sec.loinc_code = '43685-7')"
        )

    where_clause = " AND ".join(where_clauses)

    query = text(f"""
        SELECT 
            s.set_id AS {qname("SETID")},
            s.product_names AS {qname("Trade_Name")},
            s.generic_names AS {qname("Generic_Proper_Names")},
            COALESCE(dt.{qname("Toxicity_Class")}, 'Not Assessed') AS {qname("Toxicity_Class")},
            s.manufacturer AS {qname("Author_Organization")},
            COALESCE(dt.{qname("Tox_Type")}, :tox) AS {qname("Tox_Type")},
            REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
            COALESCE(dt.{qname("is_historical")}, 0) AS {qname("is_historical")},
            dt.{qname("endpoint")} AS {qname("endpoint")}
        FROM labeling.sum_spl s
        LEFT JOIN {fq_table("drug_toxicity")} dt ON s.set_id = dt.{qname("SETID")} AND dt.{qname("Tox_Type")} = :tox
        WHERE {where_clause}
        ORDER BY s.product_names ASC, s.set_id ASC
        LIMIT :limit OFFSET :offset
    """)
    rows = sess.execute(query, params).fetchall()

    count_query = text(f"""
        SELECT COUNT(*) AS count
        FROM labeling.sum_spl s
        LEFT JOIN {fq_table("drug_toxicity")} dt ON s.set_id = dt.{qname("SETID")} AND dt.{qname("Tox_Type")} = :tox
        WHERE {where_clause}
    """)
    total = sess.execute(count_query, params).scalar()

    return jsonify({
        "items": rowdicts(rows),
        "total": int(total or 0),
    })


@drugtox_bp.route("/drugs/update_notes_stats")
def get_update_notes_stats():
    tox_type = request.args.get("tox_type", "DILI")
    sess = get_db_session()

    query = text(f"""
        SELECT {qname("Update_Notes")} AS "Update_Notes", {qname("Toxicity_Class")} AS "Toxicity_Class"
        FROM {fq_table("drug_toxicity")}
        WHERE {qname("Tox_Type")} = :tox
          AND {qname("Update_Notes")} IS NOT NULL
          AND {qname("Update_Notes")} != ''
    """)
    rows = sess.execute(query, {"tox": tox_type}).fetchall()

    stats = defaultdict(lambda: {"initialized": 0, "updated": 0, "classes": defaultdict(int)})
    for r in rows:
        note = r[0] or ""
        tox_class = r[1] or "Unknown"
        parts = note.split("->")
        prefix = parts[0].strip()
        words = prefix.split()
        if len(words) >= 2:
            action = words[0]  # Initialized or Updated
            date_str = words[1]  # MM/DD/YYYY
            try:
                dt_obj = datetime.strptime(date_str, "%m/%d/%Y")
                date_key = dt_obj.strftime("%Y-%m-%d")
            except:
                date_key = date_str
            
            act_key = "initialized" if action.lower() == "initialized" else "updated"
            stats[date_key][act_key] += 1
            stats[date_key]["classes"][tox_class] += 1
        elif len(words) == 1:
            act_key = "initialized" if words[0].lower() == "initialized" else "updated"
            stats["Unknown Date"][act_key] += 1
            stats["Unknown Date"]["classes"][tox_class] += 1

    timeline = []
    total_initialized = 0
    total_updated = 0

    for date_key, info in stats.items():
        init_count = info["initialized"]
        upd_count = info["updated"]
        total_initialized += init_count
        total_updated += upd_count
        timeline.append({
            "date": date_key,
            "initialized": init_count,
            "updated": upd_count,
            "total": init_count + upd_count,
            "classes": dict(info["classes"])
        })

    timeline.sort(key=lambda x: x["date"], reverse=True)

    return jsonify({
        "timeline": timeline,
        "total_initialized": total_initialized,
        "total_updated": total_updated,
        "total_records": len(rows)
    })


@drugtox_bp.route("/discrepancies")
def get_discrepancies():
    tox_type = request.args.get("tox_type", "DILI")
    tox_map = {"Most": 3, "Less": 2, "No": 1, "Precaution": 0, "Unknown": 0}

    sess = get_db_session()

    query = text(f"""
        SELECT
            s.generic_names AS {qname("Generic_Proper_Names")},
            s.manufacturer AS {qname("Author_Organization")},
            dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
            s.product_names AS {qname("Trade_Name")},
            dt.{qname("SETID")} AS {qname("SETID")},
            dt.{qname("endpoint")} AS {qname("endpoint")}
        FROM {fq_table("drug_toxicity")} dt
        LEFT JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE dt.{qname("Tox_Type")} = :tox
          AND dt.{qname("is_historical")} = 0
    """)
    rows = sess.execute(query, {"tox": tox_type}).fetchall()

    groups = defaultdict(list)
    for r in rows:
        d = dict(r._mapping)
        groups[d["Generic_Proper_Names"]].append(d)

    discrepancies_raw = []
    generic_names_to_check = []

    for generic_name, items in groups.items():
        unique_classes = set(
            item["Toxicity_Class"] for item in items 
            if item.get("endpoint") not in ["Fuzzy", "Disagree"]
        )
        if len(unique_classes) > 1:
            generic_names_to_check.append(generic_name)
            discrepancies_raw.append({
                "generic_name": generic_name,
                "items": items,
                "unique_classes": unique_classes,
            })

    # Batch fetch RLD/RS status from label DB service
    from dashboard.services.fdalabel_db import FDALabelDBService

    rld_map = {}  # generic_name -> set_id
    rs_map = {}   # generic_name -> set_id

    if generic_names_to_check and FDALabelDBService.is_available():
        conn_lbl = FDALabelDBService.get_connection()
        if conn_lbl:
            try:
                cursor = conn_lbl.cursor()
                if FDALabelDBService._db_type == "oracle":
                    # Oracle: sample approach (kept close to your original)
                    for gn in generic_names_to_check[:50]:
                        sql = """
                            SELECT s.SET_ID
                            FROM druglabel.DGV_SUM_SPL s
                            JOIN druglabel.sum_spl_rld rld ON s.SPL_ID = rld.SPL_ID
                            WHERE UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:gn)
                              AND ROWNUM = 1
                        """
                        cursor.execute(sql, {"gn": f"%{gn}%"})
                        r_row = cursor.fetchone()
                        if r_row:
                            rld_map[gn] = r_row[0]
                else:
                    # Postgres label DB: use %s placeholders; labeling.sum_spl
                    schema = "labeling."
                    for gn in generic_names_to_check:
                        sql = f"""
                            SELECT set_id, is_rld, is_rs
                            FROM {schema}sum_spl
                            WHERE generic_names ILIKE %s
                              AND (is_rld = 1 OR is_rs = 1)
                            ORDER BY is_rld DESC, is_rs DESC, revised_date DESC
                            LIMIT 1
                        """
                        cursor.execute(sql, (f"%{gn}%",))
                        r_row = cursor.fetchone()
                        if r_row:
                            if isinstance(r_row, dict):
                                sid = r_row.get("set_id")
                                is_rld = r_row.get("is_rld")
                                is_rs = r_row.get("is_rs")
                            else:
                                sid, is_rld, is_rs = r_row[0], r_row[1], r_row[2]

                            if sid:
                                if is_rld:
                                    rld_map[gn] = sid
                                elif is_rs:
                                    rs_map[gn] = sid
            finally:
                conn_lbl.close()

    # Fetch toxicity class for found RLD/RS setids from THIS drug_toxicity table
    ref_tox_map = {}
    ref_set_ids = list(set(list(rld_map.values()) + list(rs_map.values())))
    if ref_set_ids:
        tox_query = text(f"""
            SELECT {qname("SETID")} AS {qname("SETID")},
                   {qname("Toxicity_Class")} AS {qname("Toxicity_Class")}
            FROM {fq_table("drug_toxicity")}
            WHERE {qname("SETID")} = ANY(:setids)
              AND {qname("Tox_Type")} = :tox
              AND {qname("is_historical")} = 0
        """)
        t_rows = sess.execute(tox_query, {"setids": ref_set_ids, "tox": tox_type}).fetchall()
        for tr in t_rows:
            m = dict(tr._mapping)
            ref_tox_map[m["SETID"]] = m["Toxicity_Class"]

    discrepancies = []
    for raw in discrepancies_raw:
        generic_name = raw["generic_name"]
        items = raw["items"]
        unique_classes = raw["unique_classes"]

        scores = [tox_map.get(c, 0) for c in unique_classes]
        gap = (max(scores) - min(scores)) if scores else 0
        sorted_classes = sorted(list(unique_classes), key=lambda x: tox_map.get(x, 0))

        found_rld_sid = rld_map.get(generic_name)
        found_rs_sid = rs_map.get(generic_name)

        ref_sid = found_rld_sid or found_rs_sid
        rld_info = {
            "status": "Unknown",
            "setid": ref_sid,
            "is_rld": bool(found_rld_sid),
            "is_rs": bool(found_rs_sid),
        }
        if ref_sid:
            rld_info["status"] = ref_tox_map.get(ref_sid, "Not evaluated")

        discrepancies.append({
            "generic_name": generic_name,
            "tox_range": f"{sorted_classes[0]} to {sorted_classes[-1]}" if sorted_classes else "Unknown",
            "severity_gap": gap,
            "manufacturer_count": len(items),
            "classes_found": sorted_classes,
            # Frontend expects these keys inside each detail:
            # Trade_Name, Author_Organization, Toxicity_Class, SETID
            "details": items,
            "rld_info": rld_info,
        })

    discrepancies.sort(key=lambda x: (-x["severity_gap"], x["generic_name"]))
    return jsonify(discrepancies)


@drugtox_bp.route("/latest_rld")
def get_latest_rld():
    generic_name = request.args.get("generic_name")
    if not generic_name:
        return jsonify({"error": "Missing generic_name"}), 400

    from dashboard.services.fdalabel_db import FDALabelDBService
    if not FDALabelDBService.is_available():
        return jsonify({"error": "Label database not available"}), 503

    conn = None
    try:
        conn = FDALabelDBService.get_connection()
        cursor = conn.cursor()

        # 1) latest RLD
        if FDALabelDBService._db_type == "oracle":
            sql = """
                SELECT s.SET_ID, s.PRODUCT_NAMES
                FROM druglabel.DGV_SUM_SPL s
                JOIN druglabel.sum_spl_rld rld ON s.SPL_ID = rld.SPL_ID
                WHERE UPPER(s.PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:gn)
                ORDER BY s.EFF_TIME DESC
            """
            cursor.execute(sql, {"gn": f"%{generic_name}%"})
        else:
            schema = "labeling."
            sql = f"""
                SELECT set_id, product_names
                FROM {schema}sum_spl
                WHERE generic_names ILIKE %s AND is_rld = 1
                ORDER BY revised_date DESC
                LIMIT 1
            """
            cursor.execute(sql, (f"%{generic_name}%",))

        row = cursor.fetchone()
        if row:
            sid = row[0] if not isinstance(row, dict) else row.get("set_id")
            return jsonify({"set_id": sid, "is_rld": True})

        # 2) fallback: latest labeling
        if FDALabelDBService._db_type == "oracle":
            sql = """
                SELECT SET_ID
                FROM druglabel.DGV_SUM_SPL
                WHERE UPPER(PRODUCT_NORMD_GENERIC_NAMES) LIKE UPPER(:gn)
                ORDER BY EFF_TIME DESC
            """
            cursor.execute(sql, {"gn": f"%{generic_name}%"})
        else:
            schema = "labeling."
            sql = f"""
                SELECT set_id
                FROM {schema}sum_spl
                WHERE generic_names ILIKE %s
                ORDER BY revised_date DESC
                LIMIT 1
            """
            cursor.execute(sql, (f"%{generic_name}%",))

        row = cursor.fetchone()
        if row:
            sid = row[0] if not isinstance(row, dict) else row.get("set_id")
            return jsonify({"set_id": sid, "is_rld": False})

        return jsonify({"error": "No labeling found"}), 404

    except Exception as e:
        return jsonify({"error": str(e)}), 500
    finally:
        if conn:
            conn.close()


@drugtox_bp.route("/autocomplete")
def autocomplete():
    q = request.args.get("q", "").strip()
    limit = int(request.args.get("limit", 10))
    if not q or len(q) < 2:
        return jsonify([])

    sess = get_db_session()

    is_oral = request.args.get("oral") == "true"
    is_plr = request.args.get("plr") == "true"

    # Suggestions are restricted to drugs that already have a drugtox record
    # (any tox_type, any historical state) — so the dropdown only surfaces
    # drugs the system has assessed. The full /drugs search still uses a
    # LEFT JOIN and returns all drugs regardless of assessment status.
    where_clauses = [
        "(s.product_names ILIKE :q OR s.generic_names ILIKE :q)",
        "s.is_latest = TRUE",
        f"dt.{qname('SETID')} IS NOT NULL",
    ]

    if is_oral:
        where_clauses.append(
            "(s.routes ILIKE '%ORAL%' OR "
            "s.dosage_forms ILIKE '%TABLET%' OR "
            "s.dosage_forms ILIKE '%CAPSULE%' OR "
            "s.dosage_forms ILIKE '%PILL%' OR "
            "s.dosage_forms ILIKE '%SOLUTION%' OR "
            "s.dosage_forms ILIKE '%SUSPENSION%' OR "
            "s.dosage_forms ILIKE '%SYRUP%')"
        )

    if is_plr:
        where_clauses.append(
            "EXISTS (SELECT 1 FROM labeling.spl_sections sec WHERE sec.spl_id = s.spl_id AND sec.loinc_code = '43685-7')"
        )

    where_clause = " AND ".join(where_clauses)

    query = text(f"""
        SELECT DISTINCT s.product_names, s.generic_names
        FROM labeling.sum_spl s
        INNER JOIN {fq_table("drug_toxicity")} dt ON s.set_id = dt.{qname("SETID")}
        WHERE {where_clause}
        LIMIT 50
    """)
    result = sess.execute(query, {"q": f"%{q}%"}).fetchall()

    suggestions = set()
    qu = q.upper()
    for row in result:
        p_names = row[0] or ""
        g_names = row[1] or ""
        for n in (p_names.split(';') + g_names.split(';')):
            n = n.strip()
            if n and qu in n.upper():
                suggestions.add(n)
                if len(suggestions) >= limit:
                    break
        if len(suggestions) >= limit:
            break

    return jsonify(sorted(list(suggestions)))


@drugtox_bp.route("/drugs/<setid>/history")
def get_drug_history(setid):
    tox_type = request.args.get("tox_type")
    sess = get_db_session()

    # Pull reference to lock company and generic name
    res = sess.execute(text(f"""
        SELECT s.generic_names AS {qname("Generic_Proper_Names")},
               dt.{qname("Tox_Type")} AS {qname("Tox_Type")},
               s.manufacturer AS {qname("Author_Organization")}
        FROM {fq_table("drug_toxicity")} dt
        LEFT JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE dt.{qname("SETID")} = :setid
        LIMIT 1
    """), {"setid": setid})
    row = res.fetchone()
    if not row:
        return jsonify([])

    m = dict(row._mapping)
    generic_name = m["Generic_Proper_Names"]
    current_tox_type = tox_type or m["Tox_Type"]
    company = m["Author_Organization"]

    history_res = sess.execute(
        text(f"""
            SELECT
                dt.{qname("SETID")} AS {qname("SETID")},
                dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
                REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
                dt.{qname("is_historical")} AS {qname("is_historical")},
                dt.{qname("Update_Notes")} AS {qname("Update_Notes")},
                dt.{qname("AI_Model")} AS {qname("AI_Model")},
                s.product_names AS {qname("Trade_Name")},
                s.manufacturer AS {qname("Author_Organization")},
                dt.{qname("Tox_Type")} AS {qname("Tox_Type")},
                dt.{qname("Evidence")} AS {qname("Evidence")},
                dt.{qname("AI_Summary")} AS {qname("AI_Summary")},
                dt.{qname("Assessment_Date")} AS {qname("Assessment_Date")}
            FROM {fq_table("drug_toxicity")} dt
            LEFT JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
            WHERE dt.{qname("SETID")} = :setid
            ORDER BY dt.{qname("id")} DESC
        """),
        {"setid": setid}
    ).fetchall()

    seen = set()
    deduped_rows = []
    for r in history_res:
        d = dict(r._mapping)
        if "Explanations" in d:
            d["Evidence"] = d["Explanations"]
            
        key = (d.get("Tox_Type"), d.get("Assessment_Date"), d.get("AI_Model"))
        if key in seen:
            continue
            
        seen.add(key)
        deduped_rows.append(d)

    return jsonify(deduped_rows)


@drugtox_bp.route("/drugs/<setid>")
def get_drug_detail(setid):
    tox_type = request.args.get("tox_type")
    sess = get_db_session()

    query = f"""
        SELECT 
            dt.{qname("SETID")} AS {qname("SETID")},
            s.product_names AS {qname("Trade_Name")},
            s.generic_names AS {qname("Generic_Proper_Names")},
            COALESCE(dt.{qname("Toxicity_Class")}, 'Not Assessed') AS {qname("Toxicity_Class")},
            s.manufacturer AS {qname("Author_Organization")},
            dt.{qname("Tox_Type")} AS {qname("Tox_Type")},
            REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
            dt.{qname("is_historical")} AS {qname("is_historical")},
            dt.{qname("endpoint")} AS {qname("endpoint")},
            dt.{qname("Update_Notes")} AS {qname("Update_Notes")},
            dt.{qname("AI_Summary")} AS {qname("AI_Summary")},
            dt.{qname("Evidence")} AS {qname("Evidence")},
            dt.{qname("AI_Model")} AS {qname("AI_Model")},
            dt.{qname("Assessment_Date")} AS {qname("Assessment_Date")},
            s.{qname("routes")} AS {qname("Routes")},
            s.{qname("dosage_forms")} AS {qname("Dosage_Form")},
            s.{qname("appr_num")} AS {qname("Application_Number")},
            s.{qname("is_rld")} AS {qname("Is_RLD")},
            s.{qname("is_rs")} AS {qname("Is_RS")},
            s.{qname("doc_type")} AS {qname("Doc_Type")}
        FROM {fq_table("drug_toxicity")} dt
        LEFT JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE dt.{qname("SETID")} = :setid
    """
    
    if tox_type:
        query += f" AND dt.{qname('Tox_Type')} = :tox_type AND dt.{qname('is_historical')} = 0 ORDER BY dt.{qname('id')} DESC LIMIT 1"
        result = sess.execute(text(query), {"setid": setid, "tox_type": tox_type})
    else:
        query += f" AND dt.{qname('is_historical')} = 0 ORDER BY dt.{qname('id')} DESC LIMIT 1"
        result = sess.execute(text(query), {"setid": setid})

    row = result.fetchone()
    if row:
        row_dict = dict(row._mapping)
        return jsonify(row_dict)

    # Drug exists in sum_spl but not in drug_toxicity (not assessed yet)
    # Return basic label metadata so the expand panel can still show something
    spl_row = sess.execute(text(f"""
        SELECT
            s.set_id AS {qname("SETID")},
            s.product_names AS {qname("Trade_Name")},
            s.generic_names AS {qname("Generic_Proper_Names")},
            s.manufacturer AS {qname("Author_Organization")},
            REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
            s.{qname("routes")} AS {qname("Routes")},
            s.{qname("dosage_forms")} AS {qname("Dosage_Form")},
            s.{qname("appr_num")} AS {qname("Application_Number")},
            s.{qname("is_rld")} AS {qname("Is_RLD")},
            s.{qname("is_rs")} AS {qname("Is_RS")},
            s.{qname("doc_type")} AS {qname("Doc_Type")}
        FROM labeling.sum_spl s
        WHERE s.set_id = :setid AND s.is_latest = TRUE
        LIMIT 1
    """), {"setid": setid}).fetchone()

    if spl_row:
        d = dict(spl_row._mapping)
        d["Toxicity_Class"] = "Not Assessed"
        d["AI_Summary"] = None
        return jsonify(d)

    return jsonify({"error": "Not found"}), 404


import re
from bs4 import BeautifulSoup

def extract_conclusion(html_content):
    if not html_content or '<div class="label-section">' not in html_content:
        raise ValueError("Invalid LLM output format. Generation failed.")

    soup = BeautifulSoup(html_content, "html.parser")
    text = soup.get_text(" ", strip=True).lower()

    # DILI checks
    if "most dili concern" in text:
        return "Most"
    if "less dili concern" in text:
        return "Less"
    if "no dili concern" in text:
        return "No"

    # DICT checks
    if "most dict concern" in text:
        return "Most"
    if "less dict concern" in text:
        return "Less"
    if "no dict concern" in text:
        return "No"

    # DIRI checks
    if "most diri concern" in text:
        return "Most"
    if "less diri concern" in text:
        return "Less"
    if "no diri concern" in text:
        return "No"

    # Precaution checks
    if "precaution" in text:
        return "Precaution"

    # General / partial matches
    if "most" in text and "concern" in text:
        return "Most"
    if "less" in text and "concern" in text:
        return "Less"
    if "no" in text and "concern" in text:
        return "No"

    # Fallback from DILI score badges
    scores = [int(s) for s in re.findall(r'badge-score-(\d+)|score:\s*(\d+)', html_content, re.I) for s in s if s]
    if scores and max(scores) > 3:
        return "Most"
    if scores:
        return "Less"

    # Fallback from DICT level badges
    if "badge-score-severe" in html_content.lower():
        return "Most"
    if "badge-score-moderate" in html_content.lower() or "badge-score-mild" in html_content.lower():
        return "Less"

    # Fallback from DIRI level badges
    if "badge-score-certain" in html_content.lower():
        return "Most"
    if "badge-score-possible" in html_content.lower():
        return "Less"

    # Last resort fallback if we see the words in conclusion text
    if "severe" in text:
        return "Most"
    if "certain" in text:
        return "Most"
    if "moderate" in text or "mild" in text or "possible" in text:
        return "Less"

    raise ValueError("Could not parse toxicity conclusion from LLM output.")


@drugtox_bp.route("/migrate-tables-now")
def migrate_tables_now():
    sess = get_db_session()
    from database.models import ToxAgent, DrugToxicity
    
    agents = ToxAgent.query.all()
    inserted = 0
    for agent in agents:
        reports = [('DILI', agent.dili_report), ('DICT', agent.dict_report), ('DIRI', agent.diri_report)]
        for tox_type, report in reports:
            if report and report.strip():
                conc = extract_conclusion(report)
                new_rec = DrugToxicity(
                    SETID=agent.set_id,
                    Trade_Name=agent.brand_name,
                    Generic_Proper_Names=agent.generic_name,
                    Author_Organization=agent.manufacturer,
                    Tox_Type=tox_type,
                    SPL_Effective_Time=agent.spl_effective_time,
                    is_historical=0,
                    Toxicity_Class=conc,
                    AI_Summary=report,
                    endpoint="migrated",
                    Update_Notes="Migrated from ToxAgent"
                )
                sess.add(new_rec)
                inserted += 1
    sess.commit()
    
    # drop tables
    try:
        sess.execute(text('ALTER TABLE drug_toxicity DROP COLUMN IF EXISTS "Changed";'))
        sess.execute(text('DROP TABLE IF EXISTS tox_agent CASCADE;'))
        sess.execute(text('DROP TABLE IF EXISTS dili_assessment CASCADE;'))
        sess.execute(text('DROP TABLE IF EXISTS dict_assessment CASCADE;'))
        sess.execute(text('DROP TABLE IF EXISTS diri_assessment CASCADE;'))
        sess.commit()
    except Exception as e:
        sess.rollback()
        return jsonify({"status": "error", "message": str(e)})
        
    return jsonify({"status": "success", "migrated": inserted})



@drugtox_bp.route("/drugs/<setid>/market")
def get_drug_market(setid):
    tox_type = request.args.get("tox_type")
    sess = get_db_session()

    res = sess.execute(text(f"""
        SELECT {qname("Generic_Proper_Names")} AS {qname("Generic_Proper_Names")},
               {qname("Tox_Type")} AS {qname("Tox_Type")}
        FROM {fq_table("drug_toxicity")}
        WHERE {qname("SETID")} = :setid
        LIMIT 1
    """), {"setid": setid})
    row = res.fetchone()
    if not row:
        return jsonify([])

    m = dict(row._mapping)
    generic_name = m["Generic_Proper_Names"]
    current_tox_type = tox_type or m["Tox_Type"]

    market_res = sess.execute(
        text(f"""
            SELECT
                dt.{qname("SETID")} AS {qname("SETID")},
                s.product_names AS {qname("Trade_Name")},
                s.manufacturer AS {qname("Author_Organization")},
                dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
                REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
                dt.{qname("Assessment_Date")} AS {qname("Assessment_Date")}
            FROM {fq_table("drug_toxicity")} dt
            JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
            WHERE s.generic_names = :name
              AND dt.{qname("Tox_Type")} = :tox
              AND dt.{qname("is_historical")} = 0
              AND dt.{qname("SETID")} != :setid
        """),
        {"name": generic_name, "tox": current_tox_type, "setid": setid},
    )
    return jsonify(rowdicts(market_res))


@drugtox_bp.route("/companies/<path:company_name>/stats")
def get_company_stats(company_name):
    tox_type = request.args.get("tox_type", "DILI")
    sess = get_db_session()

    dist_query = text(f"""
        SELECT dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
               COUNT(*) AS count
        FROM {fq_table("drug_toxicity")} dt
        JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE s.manufacturer = :company
          AND dt.{qname("Tox_Type")} = :tox
          AND dt.{qname("is_historical")} = 0
        GROUP BY dt.{qname("Toxicity_Class")}
    """)
    dist = sess.execute(dist_query, {"company": company_name, "tox": tox_type}).fetchall()

    count_query = text(f"""
        SELECT COUNT(*) AS count
        FROM {fq_table("drug_toxicity")} dt
        JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE s.manufacturer = :company
          AND dt.{qname("Tox_Type")} = :tox
          AND dt.{qname("is_historical")} = 0
    """)
    total_drugs = sess.execute(count_query, {"company": company_name, "tox": tox_type}).scalar()

    return jsonify({
        "distribution": rowdicts(dist),
        "total_drugs": int(total_drugs or 0),
    })


@drugtox_bp.route("/companies/<path:company_name>/portfolio")
def get_company_portfolio(company_name):
    tox_type = request.args.get("tox_type", "DILI")
    sess = get_db_session()

    query = text(f"""
        SELECT 
            dt.{qname("SETID")} AS {qname("SETID")},
            s.product_names AS {qname("Trade_Name")},
            s.generic_names AS {qname("Generic_Proper_Names")},
            dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
            s.manufacturer AS {qname("Author_Organization")},
            dt.{qname("Tox_Type")} AS {qname("Tox_Type")},
            REPLACE(s.revised_date, '-', '') AS {qname("SPL_Effective_Time")},
            dt.{qname("is_historical")} AS {qname("is_historical")},
            dt.{qname("endpoint")} AS {qname("endpoint")},
            dt.{qname("Assessment_Date")} AS {qname("Assessment_Date")}
        FROM {fq_table("drug_toxicity")} dt
        JOIN labeling.sum_spl s ON s.set_id = dt.{qname("SETID")}
        WHERE s.manufacturer = :company
          AND dt.{qname("Tox_Type")} = :tox
          AND dt.{qname("is_historical")} = 0
        ORDER BY s.product_names ASC
    """)
    rows = sess.execute(query, {"company": company_name, "tox": tox_type}).fetchall()
    return jsonify(rowdicts(rows))

@drugtox_bp.route("/export")
def export_data():
    TOX_ORDER = {
        "Most": 5,
        "Less": 4,
        "Precaution": 3,
        "No": 2,
        "Unknown": 1,
    }

    tox_type = request.args.get("tox_type", "DILI")
    oral_only = request.args.get("oral_only", "true").lower() == "true"

    sess = get_db_session()

    where_clauses = [
        f'dt.{qname("Tox_Type")} = :tox',
        f'dt.{qname("is_historical")} = 0',
    ]



    if oral_only:
        where_clauses.append(f"""
            (
                s.{qname("routes")} ILIKE '%ORAL%'
                OR s.{qname("dosage_forms")} ILIKE '%Tablet%'
                OR s.{qname("dosage_forms")} ILIKE '%Capsule%'
                OR s.{qname("dosage_forms")} ILIKE '%Solution%'
            )
        """)

    where_clause = " AND ".join(where_clauses)

    query = text(f"""
        SELECT
            dt.{qname("SETID")} AS {qname("SETID")},
            s.generic_names AS {qname("Generic_Proper_Names")},
            s.product_names AS {qname("Trade_Name")},
            s.manufacturer AS {qname("Author_Organization")},
            dt.{qname("Toxicity_Class")} AS {qname("Toxicity_Class")},
            s.{qname("appr_num")} AS {qname("Application_Number")},
            s.{qname("routes")} AS {qname("Route")},
            s.{qname("dosage_forms")} AS {qname("Dosage_Form")},
            s.{qname("active_ingredients")} AS {qname("Active_Ingredient")}
        FROM {fq_table("drug_toxicity")} dt
        LEFT JOIN {fq_table("sum_spl", schema="labeling")} s
          ON s.{qname("set_id")} = dt.{qname("SETID")}
        WHERE {where_clause}
    """)

    rows = sess.execute(query, {"tox": tox_type}).fetchall()

    grouped = {}

    for row in rows:
        m = dict(row._mapping)

        application_number = str(m.get("Application_Number") or "").strip()
        active_ingredient = str(m.get("Active_Ingredient") or "").strip()
        dosage_form = str(m.get("Dosage_Form") or "").strip()
        generic_name = str(m.get("Generic_Proper_Names") or "").strip()

        if application_number:
            group_key = f"APP::{application_number.lower()}"
            display_group = application_number
            group_basis = "Application Number"
        elif active_ingredient or dosage_form:
            group_key = f"ING_DF::{active_ingredient.lower()}::{dosage_form.lower()}"
            display_group = f"{active_ingredient} | {dosage_form}".strip(" |")
            group_basis = "Active Ingredient + Dosage Form"
        elif generic_name:
            group_key = f"GENERIC::{generic_name.lower()}"
            display_group = generic_name
            group_basis = "Generic Name"
        else:
            group_key = "UNKNOWN"
            display_group = "Unknown"
            group_basis = "Unknown"

        if group_key not in grouped:
            grouped[group_key] = {
                "display_group": display_group,
                "group_basis": group_basis,
                "total_count": 0,
                "class_counts": defaultdict(int),
                "setids": set(),
                "generic_names": set(),
                "trade_names": set(),
                "author_organizations": set(),
                "routes": set(),
                "dosage_forms": set(),
                "active_ingredients": set(),
                "majority_vote": None,
                "severity_vote": None,
            }

        g = grouped[group_key]

        toxicity_class = str(m.get("Toxicity_Class") or "Unknown").strip() or "Unknown"

        g["total_count"] += 1
        g["class_counts"][toxicity_class] += 1

        if m.get("SETID"):
            g["setids"].add(str(m["SETID"]).strip())
        if m.get("Generic_Proper_Names"):
            g["generic_names"].add(str(m["Generic_Proper_Names"]).strip())
        if m.get("Trade_Name"):
            g["trade_names"].add(str(m["Trade_Name"]).strip())
        if m.get("Author_Organization"):
            g["author_organizations"].add(str(m["Author_Organization"]).strip())
        if m.get("Route"):
            g["routes"].add(str(m["Route"]).strip())
        if m.get("Dosage_Form"):
            g["dosage_forms"].add(str(m["Dosage_Form"]).strip())
        if m.get("Active_Ingredient"):
            g["active_ingredients"].add(str(m["Active_Ingredient"]).strip())

    for group_key, data in grouped.items():
        class_counts = data["class_counts"]
        if class_counts:
            data["majority_vote"] = max(class_counts, key=class_counts.get)
            data["severity_vote"] = max(class_counts, key=lambda x: TOX_ORDER.get(x, 0))

    wb = Workbook()
    ws = wb.active
    ws.title = f"{tox_type} Toxicity Data"[:31]

    headers = [
        "Application / Fallback Group",
        "Group Basis",
        "Total Count",
        "Generic Name",
        "Trade Name",
        "Author Organization",
        "SETID",
        "Route",
        "Dosage Form",
        "Active Ingredient",
        "Most",
        "Less",
        "No",
        "Precaution",
        "Unknown",
        "Majority Vote",
        "Severity Vote",
    ]
    ws.append(headers)

    for group_key, data in sorted(grouped.items(), key=lambda x: x[1]["display_group"]):
        ws.append([
            data["display_group"],
            data["group_basis"],
            data["total_count"],
            ", ".join(sorted(data["generic_names"])),
            ", ".join(sorted(data["trade_names"])),
            ", ".join(sorted(data["author_organizations"])),
            ", ".join(sorted(data["setids"])),
            ", ".join(sorted(data["routes"])),
            ", ".join(sorted(data["dosage_forms"])),
            ", ".join(sorted(data["active_ingredients"])),
            data["class_counts"]["Most"],
            data["class_counts"]["Less"],
            data["class_counts"]["No"],
            data["class_counts"]["Precaution"],
            data["class_counts"]["Unknown"],
            data["majority_vote"],
            data["severity_vote"],
        ])

    temp_file = tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False)
    wb.save(temp_file.name)
    temp_file.close()

    return send_file(
        temp_file.name,
        as_attachment=True,
        download_name=f"{tox_type}_toxicity_data_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx",
    )