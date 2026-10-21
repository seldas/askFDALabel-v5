# External service availability

The server independently probes OpenFDA and DailyMed through
`GET /api/external-services`. This is a server network check, not a browser
network check or an account permission. It applies to RAPID and other deployments.

Probes run concurrently with short connection/read timeouts. Network failures
and blocked/non-JSON responses are confirmed twice. Successful checks are cached
for five minutes per process; failed or degraded checks for one minute. The UI
refreshes every minute. HTTP rate limits and temporary server errors are marked
degraded, rather than permanently disabling the service. Check failures in the UI
are shown as unknown, not assumed to mean that external services are unreachable.

When OpenFDA is unavailable, live FAERS and device API requests return HTTP 503.
FAERS tool entries remain visible but disabled; a directly opened FAERS page can
still display saved semantic analysis with its generation timestamp. Local Database
Search disables only the device mode. Label searching and local drug/RLD modes
remain available. AE report generation continues scanning labels, skips unreachable
OpenFDA retrieval, and stores missing FAERS counts as SQL NULL. Report pages and
exports preserve missing values rather than reporting them as zero; incomplete
aggregate counts are unavailable. Existing zero values from older reports cannot
be distinguished retroactively from real zero counts.

Image Analysis and Labeling Visual Review show a warning but remain usable with
local and uploaded images. DailyMed is checked only after local artwork lookup
fails; an unavailable DailyMed fallback returns a service error immediately from
the cached check. Browser-side DailyMed images and external links are unchanged.

Tool dependencies are declared in `frontend/app/platform/registry.ts`. Account
feature gates remain independent and are still resolved per request.
