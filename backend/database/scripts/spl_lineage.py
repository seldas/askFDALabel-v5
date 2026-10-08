"""SPL versions come from XML, never from archive arrival order."""


def xml_version(root):
    element = root.find('{urn:hl7-org:v3}versionNumber')
    value = element.get('value', '') if element is not None else ''
    return int(value) if value.isascii() and value.isdigit() and 0 < int(value) <= 2147483647 else None


LINEAGE_SQL = """
WITH counts AS (
    SELECT set_id, version_number, COUNT(*) AS n
    FROM labeling.sum_spl GROUP BY set_id, version_number
), uncertain AS (
    SELECT set_id FROM counts
    GROUP BY set_id
    HAVING BOOL_OR(version_number IS NULL OR version_number <= 0 OR n > 1)
), ranked AS (
    SELECT s.spl_id,
           LAG(s.spl_id) OVER (PARTITION BY s.set_id ORDER BY s.version_number) AS parent,
           MAX(s.version_number) OVER (PARTITION BY s.set_id) AS maximum
    FROM labeling.sum_spl s
    WHERE NOT EXISTS (SELECT 1 FROM uncertain u WHERE u.set_id = s.set_id)
)
UPDATE labeling.sum_spl s
SET parent_spl_id = r.parent, is_latest = (s.version_number = r.maximum)
FROM ranked r WHERE r.spl_id = s.spl_id;
UPDATE labeling.sum_spl s SET parent_spl_id = NULL, is_latest = FALSE
WHERE EXISTS (
    SELECT 1 FROM labeling.sum_spl x WHERE x.set_id = s.set_id
    AND (x.version_number IS NULL OR x.version_number <= 0
         OR EXISTS (SELECT 1 FROM labeling.sum_spl y WHERE y.set_id = x.set_id
                    AND y.version_number = x.version_number AND y.spl_id <> x.spl_id))
);
"""
