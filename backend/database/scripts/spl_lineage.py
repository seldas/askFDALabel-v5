"""Order SPL history by revision date; XML versions break same-day ties."""


def xml_version(root):
    element = root.find('{urn:hl7-org:v3}versionNumber')
    value = element.get('value', '') if element is not None else ''
    return int(value) if value.isascii() and value.isdigit() and 0 < int(value) <= 2147483647 else None


def lineage_plan_sql(scoped=False):
    scope = 'WHERE s.set_id = ANY(%s)' if scoped else ''
    return f"""
WITH source AS (
    SELECT s.spl_id, s.set_id, s.revised_date, s.version_number, s.parent_spl_id, s.is_latest, s.local_path FROM labeling.sum_spl s {scope}
), counts AS (
    SELECT set_id, revised_date, COUNT(*) AS n,
           COUNT(version_number) AS known, MIN(version_number) AS minimum,
           COUNT(DISTINCT version_number) AS distinct_versions
    FROM source GROUP BY set_id, revised_date
), classified AS (
    SELECT s.*,
           (s.revised_date IS NULL OR s.revised_date = '' OR
            (c.n > 1 AND (c.known <> c.n OR c.minimum <= 0 OR c.distinct_versions <> c.n))) AS uncertain
    FROM source s JOIN counts c ON c.set_id = s.set_id
      AND c.revised_date IS NOT DISTINCT FROM s.revised_date
), ranked AS (
    SELECT *,
           LAG(spl_id) OVER w AS preceding_id,
           LAG(uncertain) OVER w AS preceding_uncertain,
           MAX(revised_date) OVER (PARTITION BY set_id) AS latest_date,
           BOOL_OR(revised_date IS NULL OR revised_date = '') OVER (PARTITION BY set_id) AS missing_date,
           ROW_NUMBER() OVER (PARTITION BY set_id ORDER BY revised_date DESC NULLS LAST,
                              version_number DESC NULLS LAST, spl_id) AS descending_rank
    FROM classified
    WINDOW w AS (PARTITION BY set_id ORDER BY revised_date ASC NULLS FIRST,
                  version_number ASC NULLS FIRST, spl_id)
), plan AS (
    SELECT spl_id, set_id, version_number, local_path, parent_spl_id, is_latest,
           CASE WHEN NOT uncertain AND NOT COALESCE(preceding_uncertain, FALSE)
                THEN preceding_id ELSE NULL END AS new_parent,
           (NOT uncertain AND NOT missing_date AND revised_date = latest_date
            AND descending_rank = 1) AS new_latest
    FROM ranked
)
"""


def lineage_sql(scoped=False):
    return lineage_plan_sql(scoped) + """
UPDATE labeling.sum_spl s
SET parent_spl_id = p.new_parent, is_latest = p.new_latest
FROM plan p WHERE p.spl_id = s.spl_id
AND (s.parent_spl_id IS DISTINCT FROM p.new_parent OR s.is_latest IS DISTINCT FROM p.new_latest);
"""


LINEAGE_SQL = lineage_sql()
