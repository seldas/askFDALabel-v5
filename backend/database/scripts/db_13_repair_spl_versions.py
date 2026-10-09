"""Audit same-day SPL versions and repair date-first lineage in bounded batches."""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
import xml.etree.ElementTree as ET

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from pg_utils import PGUtils
from spl_lineage import xml_version, lineage_sql, lineage_plan_sql
from dashboard.services.fdalabel_db import FDALabelDBService
from flask import Flask
from dashboard.config import Config


class Progress:
    def __init__(self, title, total):
        self.title, self.total, self.started = title, total, time.monotonic()
        self.last = 0
        self.shown = -1
        self.show(0, force=True)

    def show(self, done, force=False):
        if self.shown == done:
            return
        now = time.monotonic()
        if not force and now - self.last < 1 and done < self.total:
            return
        self.last = now
        self.shown = done
        ratio = done / self.total if self.total else 1
        elapsed = now - self.started
        eta = elapsed * (self.total - done) / done if done else 0
        bar = '#' * int(ratio * 30) + '-' * (30 - int(ratio * 30))
        line = f'{self.title} [{bar}] {done:,}/{self.total:,} {ratio:6.1%} elapsed {elapsed:.0f}s ETA {eta:.0f}s'
        print(('\r' if sys.stdout.isatty() else '') + line,
              end='' if sys.stdout.isatty() and done < self.total else '\n', flush=True)


def read_version(row):
    xml = FDALabelDBService._read_local_file(row['local_path'], row['set_id']) if row['local_path'] else None
    if not xml:
        xml, _ = FDALabelDBService._read_cache_file(row['spl_id'])
    if xml:
        try:
            root = ET.fromstring(xml)
            if root.find('{urn:hl7-org:v3}id').get('root') == row['spl_id'] and root.find('{urn:hl7-org:v3}setId').get('root') == row['set_id']:
                return xml_version(root)
        except (ET.ParseError, AttributeError):
            pass
    return None


def save_rows(backup, rows, phase):
    for row in rows:
        backup.write(json.dumps({'phase': phase, **dict(row)}, default=str) + '\n')
    backup.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--set-id', help='Restrict both phases to this Set ID')
    parser.add_argument('--batch-size', type=int, default=100, help='Maximum XML records / Set IDs per batch')
    args = parser.parse_args()
    if args.batch_size < 1:
        parser.error('--batch-size must be positive')
    conn = PGUtils.get_connection()
    backup = None
    try:
        print('Planning same-day groups in PostgreSQL; no label XML is read during planning.', flush=True)
        scope = 'WHERE set_id = %s' if args.set_id else ''
        params = (args.set_id,) if args.set_id else ()
        with conn.cursor() as cur:
            cur.execute(f"""CREATE TEMP TABLE repair_candidates ON COMMIT PRESERVE ROWS AS
                WITH ties AS (
                    SELECT set_id, revised_date FROM labeling.sum_spl {scope}
                    GROUP BY set_id, revised_date HAVING COUNT(*) > 1 AND revised_date IS NOT NULL AND revised_date <> ''
                )
                SELECT s.spl_id, s.set_id, s.revised_date, s.version_number, s.local_path
                FROM labeling.sum_spl s JOIN ties t ON s.set_id = t.set_id AND s.revised_date = t.revised_date""", params)
            cur.execute('CREATE UNIQUE INDEX ON repair_candidates(spl_id)')
            cur.execute('SELECT COUNT(*) AS n FROM repair_candidates')
            total_xml = cur.fetchone()['n']
            cur.execute(f'SELECT COUNT(DISTINCT set_id) AS n FROM labeling.sum_spl {scope}', params)
            total_sets = cur.fetchone()['n']
        conn.commit()
        print(f'Only {total_xml:,} same-day SPL records need XML checks; {total_sets:,} Set IDs need metadata-only lineage checks.', flush=True)
        if args.apply:
            directory = Path(Config.DATA_DIR) / 'version_repair'
            directory.mkdir(parents=True, exist_ok=True)
            path = directory / ('before-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f') + '.jsonl')
            backup = path.open('x', encoding='utf-8')
            print(f'Backup: {path}', flush=True)
        progress = Progress('Same-day XML', total_xml)
        last = ''
        done = changed = missing = conflicts = 0
        while True:
            with conn.cursor() as cur:
                cur.execute('SELECT * FROM repair_candidates WHERE spl_id > %s ORDER BY spl_id LIMIT %s', (last, args.batch_size))
                rows = cur.fetchall()
            conn.commit()
            if not rows:
                break
            changes = []
            for row in rows:
                version = read_version(row)
                missing += version is None
                if version != row['version_number']:
                    changes.append((row, version))
                done += 1
                progress.show(done)
            if args.apply and changes:
                save_rows(backup, [row for row, _ in changes], 'version')
                with conn.cursor() as cur:
                    for row, version in changes:
                        cur.execute("""UPDATE labeling.sum_spl SET version_number = %s
                            WHERE spl_id = %s AND set_id = %s
                            AND revised_date IS NOT DISTINCT FROM %s
                            AND version_number IS NOT DISTINCT FROM %s
                            AND local_path IS NOT DISTINCT FROM %s""",
                            (version, row['spl_id'], row['set_id'], row['revised_date'], row['version_number'], row['local_path']))
                        conflicts += cur.rowcount != 1
                conn.commit()
            changed += len(changes)
            last = rows[-1]['spl_id']
        progress.show(done, force=True)
        progress = Progress('Lineage Set IDs', total_sets)
        last = ''
        done_sets = flag_changes = 0
        while True:
            with conn.cursor() as cur:
                extra = ' AND set_id = %s' if args.set_id else ''
                cur.execute('SELECT DISTINCT set_id FROM labeling.sum_spl WHERE set_id > %s' + extra + ' ORDER BY set_id LIMIT %s',
                            (last, args.set_id, args.batch_size) if args.set_id else (last, args.batch_size))
                ids = [row['set_id'] for row in cur.fetchall()]
                if not ids:
                    break
                if args.apply:
                    cur.execute('SELECT spl_id FROM labeling.sum_spl WHERE set_id = ANY(%s) FOR UPDATE', (ids,))
                # Only affected flags are backed up; no XML is loaded in this phase.
                cur.execute(lineage_plan_sql(True) + 'SELECT * FROM plan WHERE parent_spl_id IS DISTINCT FROM new_parent OR is_latest IS DISTINCT FROM new_latest', (ids,))
                while True:
                    batch = cur.fetchmany(args.batch_size)
                    if not batch:
                        break
                    flag_changes += len(batch)
                    if backup:
                        save_rows(backup, batch, 'lineage')
                if args.apply:
                    cur.execute(lineage_sql(True), (ids,))
            conn.commit()
            done_sets += len(ids)
            progress.show(done_sets)
            last = ids[-1]
        progress.show(done_sets, force=True)
        print(f'{"Applied" if args.apply else "Audit"}: {changed:,} version corrections, {missing:,} unverifiable same-day versions, {flag_changes:,} lineage changes, {conflicts:,} concurrent version conflicts.', flush=True)
        if conflicts:
            print('Rerun to re-audit records modified by another importer. Conflicting version updates were skipped.', flush=True)
        if not args.apply:
            print('Read-only audit. Lineage estimates use stored versions; --apply rechecks lineage after XML corrections.')
    finally:
        if backup:
            backup.close()
        conn.close()


if __name__ == '__main__':
    app = Flask(__name__)
    app.config.from_object(Config)
    with app.app_context():
        main()
