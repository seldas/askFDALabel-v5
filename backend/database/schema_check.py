"""Read-only startup check comparing SQLAlchemy model columns against the live database."""

import logging
from typing import Any, Dict, List

from sqlalchemy import inspect

logger = logging.getLogger(__name__)


def check_schema_drift(db: Any) -> Dict[str, Any]:
    """Logs warnings if any model table or column is missing from the connected database."""
    missing_tables: List[str] = []
    missing_columns: List[str] = []

    try:
        insp = inspect(db.engine)
        for table in db.metadata.sorted_tables:
            schema = table.schema
            label = f"{schema or 'public'}.{table.name}"
            if not insp.has_table(table.name, schema=schema):
                missing_tables.append(label)
                continue
            actual_cols = {col["name"] for col in insp.get_columns(table.name, schema=schema)}
            expected_cols = {col.name for col in table.columns}
            diff = sorted(expected_cols - actual_cols)
            if diff:
                missing_columns.append(f"{label} ({', '.join(diff)})")
    except Exception as exc:
        logger.warning("[Schema Check] Skipped due to inspection error: %s", exc)
        return {"ok": False, "error": str(exc), "missing_tables": [], "missing_columns": []}

    if missing_tables or missing_columns:
        if missing_tables:
            msg = f"[Schema Check] WARNING - Missing tables: {', '.join(missing_tables)}"
            logger.warning(msg)
            print(msg)
        if missing_columns:
            msg = f"[Schema Check] WARNING - Missing columns: {'; '.join(missing_columns)}"
            logger.warning(msg)
            print(msg)
    else:
        logger.info("[Schema Check] OK: all model tables and columns match the database.")

    return {
        "ok": not (missing_tables or missing_columns),
        "missing_tables": missing_tables,
        "missing_columns": missing_columns,
    }
