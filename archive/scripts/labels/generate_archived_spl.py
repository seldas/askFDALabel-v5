import os
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
import oracledb

DB_HOST = "ncsvmscidevl03.fda.gov"
DB_PORT = 1521
DB_SERVICE = "scidevl3.fda.gov"
DB_USER = "druglabel"
DB_PASSWORD = "druglabel"

TABLE_NAME = "SPL"
OUTPUT_DIR = Path("data/spl_storage_archived")
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

WORKERS = 4
BATCH_SIZE = 500

dsn = oracledb.makedsn(DB_HOST, DB_PORT, service_name=DB_SERVICE)

query = f"""
SELECT
    FILENAME,
    XMLSERIALIZE(CONTENT SPL_XML AS CLOB) AS SPL_XML_CLOB
FROM {TABLE_NAME}
WHERE FILENAME IS NOT NULL
  AND SPL_XML IS NOT NULL
"""

def safe_filename(filename):
    return os.path.basename(filename)

def clob_to_string(value):
    if value is None:
        return None
    if hasattr(value, "read"):
        return value.read()
    return str(value)

def write_xml_file(row):
    filename, spl_xml = row

    filename = safe_filename(filename)

    if not filename.lower().endswith(".xml"):
        filename += ".xml"

    output_path = OUTPUT_DIR / filename

    if output_path.exists():
        return "skipped"

    xml_content = clob_to_string(spl_xml)
    if not xml_content:
        return "empty"

    # Atomic-ish write to avoid partial files
    temp_path = output_path.with_suffix(output_path.suffix + ".tmp")

    with open(temp_path, "w", encoding="utf-8") as f:
        f.write(xml_content)

    os.replace(temp_path, output_path)

    return "exported"

exported = 0
skipped = 0
empty = 0
processed = 0

with oracledb.connect(
    user=DB_USER,
    password=DB_PASSWORD,
    dsn=dsn
) as connection:

    with connection.cursor() as cursor:
        cursor.arraysize = BATCH_SIZE
        cursor.execute(query)

        with ThreadPoolExecutor(max_workers=WORKERS) as executor:
            futures = set()

            while True:
                rows = cursor.fetchmany(BATCH_SIZE)
                if not rows:
                    break

                for row in rows:
                    futures.add(executor.submit(write_xml_file, row))

                for future in as_completed(futures):
                    result = future.result()
                    processed += 1

                    if result == "exported":
                        exported += 1
                    elif result == "skipped":
                        skipped += 1
                    elif result == "empty":
                        empty += 1

                    if processed % 1000 == 0:
                        print(
                            f"Processed: {processed:,} | "
                            f"Exported: {exported:,} | "
                            f"Skipped: {skipped:,} | "
                            f"Empty: {empty:,}"
                        )

                futures.clear()

print(
    f"Done. Processed: {processed:,} | "
    f"Exported: {exported:,} | "
    f"Skipped: {skipped:,} | "
    f"Empty: {empty:,}"
)