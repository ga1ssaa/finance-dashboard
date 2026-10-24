"""Explicit read-only inventory and development preservation inspection.

This entry point never reserves manifests or creates/migrates databases.
Importing performs no IO. Run only when read-only inspection is authorized.
"""

import json
from pathlib import Path
import sys


def main():
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "backend"))
    from app.config import Settings
    from verification.db_safety import read_only_inspection
    try:
        settings = Settings()
        result = read_only_inspection(settings.database_url.get_secret_value())
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception:
        print("READ_ONLY_INSPECTION_FAILED: details suppressed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
