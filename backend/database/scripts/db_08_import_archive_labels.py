import os
import sys
from pathlib import Path

# Dynamic path resolution to support both host execution and container environments
current_dir = Path(__file__).resolve().parent
repo_root = current_dir
for parent in [current_dir] + list(current_dir.parents):
    if (parent / '.env').exists() or (parent / '.env.template.txt').exists():
        repo_root = parent
        break

# Add current scripts directory for local module imports
sys.path.append(str(current_dir))

import import_archive_labels

if __name__ == "__main__":
    import_archive_labels.main()
