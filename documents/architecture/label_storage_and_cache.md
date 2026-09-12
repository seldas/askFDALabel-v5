# SPL XML Storage Cascade & Runtime Cache Architecture

## 1. Overview

FDA Structured Product Labeling (SPL) XML documents can range from hundreds of kilobytes to over 20 megabytes. Rather than storing large XML blobs inside PostgreSQL rows, AskFDALabel utilizes a **hybrid filesystem storage and read-through caching cascade**.

All XML retrieval funnels through a single authoritative method:
```python
FDALabelDBService.resolve_spl_xml(set_id, spl_id=None, force_local=False)
```

It returns a tuple `(xml_content, source_metadata)` where `source_metadata` explicitly identifies the origin (`local-file`, `cache`, or `oracle`), the actual `spl_id` served, and whether version substitution occurred.

---

## 2. The Retrieval Cascade

When a user or analytical module requests a label by `set_id` and optional `spl_id`, the system traverses the following resolution stages in strict order:

```
                  Client Request: (set_id, optional spl_id)
                                      │
                                      ▼
             1. Query local PostgreSQL: `labeling.sum_spl`
             Find candidate rows matching set_id or spl_id
                                      │
                 ┌────────────────────┴────────────────────┐
                 ▼                                         ▼
         [Candidate Rows Found]                   [No Local Row Found]
                 │                                         │
        Check local disk via local_path:                   │
        • .zip -> data/spl_storage/                        │
        • .xml -> data/spl_storage_archived/               │
                 │                                         │
                 ├─► [File Exists on Disk]                 │
                 │   Return XML (origin: 'local-file')     │
                 │                                         │
                 └─► [File Missing from Storage]           │
                     Check cache by candidate_spl_id       │
                     data/spl_cache/{spl_id}.xml           │
                     │                                     │
                     ├─► [Cache Hit]                       │
                     │   Return XML (origin: 'cache')      │
                     │                                     │
                     └─► [Cache Miss] ────────┐            │
                                              │            │
                                              ▼            ▼
                                2. If spl_id provided: check local cache
                                   data/spl_cache/{spl_id}.xml
                                              │
                                              ├─► [Cache Hit]
                                              │   Return XML (origin: 'cache')
                                              │
                                              └─► [Cache Miss]
                                                      │
                                                      ▼
                                           Check force_local flag
                                           (If True, stop and return None)
                                                      │
                                                      ▼
                                       3. Fallback to Oracle Database
                                          Query druglabel.spl & sum_spl
                                                      │
                                                      ├─► [Found in Oracle]
                                                      │   • Decode LOB / UTF-8
                                                      │   • Atomic write to cache:
                                                      │     data/spl_cache/{spl_id}.xml
                                                      │   • Return XML (origin: 'oracle')
                                                      │
                                                      └─► [Not Found]
                                                          Return (None, None)
```

---

## 3. Storage Directory Breakdown

| Directory Path | File Type | Population Source | Immutability |
|---|---|---|---|
| `data/spl_storage/` | `.zip` archives (containing SPL XML and images) | Bulk DailyMed import (`db_07_import_labels.py`) | Static offline bulk corpus |
| `data/spl_storage_archived/` | Bare `.xml` files | Archive SPL import (`import_archive_labels.py`) | Static historical archive |
| `data/spl_cache/` | Bare `{spl_id}.xml` files | Dynamic read-through cache from Oracle | **Immutable** per `spl_id` revision |

---

## 4. Design Decisions & Safety Guarantees

### Why Cache by `spl_id` instead of `set_id`?
- **Immutability of `spl_id`**: In FDA SPL architecture, a `spl_id` (document GUID) is an immutable snapshot. Once published, the XML for a given `spl_id` never changes. Therefore, caching `{spl_id}.xml` is 100% safe, strongly consistent, and never becomes stale.
- **Volatility of `set_id`**: A `set_id` represents the entire product lifecycle across years. When a manufacturer publishes an update, the `set_id` remains the same while a new `spl_id` is minted. Caching by `set_id` would risk serving outdated labeling after revisions occur.

### Atomic Cache Writes
To prevent race conditions where one process reads an XML file while another process is writing it, `_write_cache_file()` writes to a temporary file first and commits it via `os.replace`:
```python
temp_file = os.path.join(cache_dir, f"{spl_id}.xml.tmp.{os.getpid()}_{random.randint(1000, 9999)}")
with open(temp_file, 'w', encoding='utf-8') as f:
    f.write(xml)
os.replace(temp_file, cache_file)
```

### Self-Healing Directory Creation
Both on Flask startup (`create_app`) and before every cache write (`_write_cache_file`), `os.makedirs(cache_dir, exist_ok=True)` is called. If the cache directory is manually deleted or wiped while the server is running, the system self-heals without throwing `FileNotFoundError`.

### No DailyMed Web Fallback
Legacy versions attempted to scrape DailyMed dynamically via HTTP when a label was missing. This was intentionally removed because DailyMed's public endpoint only accepts `set_id`, silently returning today's latest revision when a user requested a historical version. Under the current architecture, missing labels cleanly return HTTP 404 with public navigation links (`label_not_found_payload()`).
