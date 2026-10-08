"""Restore XML SPL versions. Default is a read-only audit; --apply writes a backup first."""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pg_utils import PGUtils
from spl_lineage import xml_version, LINEAGE_SQL
from dashboard.services.fdalabel_db import FDALabelDBService
from psycopg2.extras import execute_batch
from flask import Flask
from dashboard.config import Config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--set-id', help='Audit or repair only this Set ID')
    args = parser.parse_args()
    conn = PGUtils.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute('SELECT spl_id, set_id, version_number, parent_spl_id, is_latest, local_path FROM labeling.sum_spl' + (' WHERE set_id = %s' if args.set_id else ''), (args.set_id,) if args.set_id else ())
            rows = cur.fetchall()
        updates = []
        missing = 0
        for row in rows:
            xml = FDALabelDBService._read_local_file(row['local_path'], row['set_id']) if row['local_path'] else None
            if not xml:
                xml, _ = FDALabelDBService._read_cache_file(row['spl_id'])
            version = None
            if xml:
                try:
                    root = ET.fromstring(xml)
                    if root.find('{urn:hl7-org:v3}id').get('root') == row['spl_id'] and root.find('{urn:hl7-org:v3}setId').get('root') == row['set_id']:
                        version = xml_version(root)
                except (ET.ParseError, AttributeError):
                    pass
            if version is None:
                missing += 1
            updates.append((version, row['spl_id'], row['version_number']))
        changed = sum(new != old for new, _, old in updates)
        print(f'Audited {len(rows)} records; {changed} version corrections; {missing} unavailable or invalid XML versions.')
        if not args.apply:
            print('Read-only audit. --apply sets unverifiable versions to NULL and clears uncertain lineage. A backup is written before changes.')
            return
        backup_dir = Path(__file__).resolve().parents[3] / 'data' / 'version_repair'
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / ('before-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.json')
        backup.write_text(json.dumps(rows, default=str, indent=2), encoding='utf-8')
        with conn.cursor() as cur:
            cur.execute('LOCK TABLE labeling.sum_spl IN SHARE ROW EXCLUSIVE MODE')
            # Abort if an importer changed the audited records in the meantime.
            cur.execute('SELECT spl_id, set_id, version_number, parent_spl_id, is_latest, local_path FROM labeling.sum_spl' + (' WHERE set_id = %s' if args.set_id else ''), (args.set_id,) if args.set_id else ())
            if {r['spl_id']: dict(r) for r in cur.fetchall()} != {r['spl_id']: dict(r) for r in rows}:
                raise RuntimeError('Records changed during audit; rerun the repair.')
            execute_batch(cur, 'UPDATE labeling.sum_spl SET version_number = %s WHERE spl_id = %s AND version_number IS NOT DISTINCT FROM %s', updates)
            if args.set_id:
                scoped = LINEAGE_SQL.replace('WHERE r.spl_id = s.spl_id;', 'WHERE r.spl_id = s.spl_id AND s.set_id = %s;').replace('WHERE EXISTS (', 'WHERE s.set_id = %s AND EXISTS (', 1)
                cur.execute(scoped, (args.set_id, args.set_id))
            else:
                cur.execute(LINEAGE_SQL)
        conn.commit()
        print(f'Repair committed. Backup: {backup}')
    finally:
        conn.close()


if __name__ == '__main__':
    app = Flask(__name__)
    app.config.from_object(Config)
    with app.app_context():
        main()
