# WebTest: Query Monitoring (`/webtest`)

WebTest runs configured FDALabel queries against their target servers and records
response counts, timing and status. The WebTest page shows the latest results
and historical trends. Availability is controlled by the `webtest` feature gate;
RAPID deployments disable the tool.

## Data and execution

- `WebtestTask` and `WebtestHistory` in PostgreSQL store query definitions and
  run history. The runner replaces a task's existing result for the same date.
- `backend/webtest/blueprint.py` exposes tasks, history and report endpoints.
- `backend/admin/tasks/run_webtest.py` executes the interactive run as a
  subprocess; its operational log is written under `data/logs/tasks/`.
- `backend/cron_webtest.py` provides a scheduled runner.
- Excel history and report downloads are generated in memory from database
  records when requested. They are not persisted to WebTest folders.

The application and deployment no longer depend on the legacy
`backend/webtest/history/` or `backend/webtest/results/` directories. Existing
files are not removed by this change. `backend/migrate_webtest_to_pg.py` is a
one-time utility for importing legacy spreadsheets; it reads the old location
and **deletes existing WebTest tasks and history before import**. Do not run it
on a populated database without a backup and a deliberate migration plan.
