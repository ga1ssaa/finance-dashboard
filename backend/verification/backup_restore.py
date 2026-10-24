"""Explicit backup/restore CLI. Importing performs no IO; every write is opt-in.

Review all files and exact commands before execution. No command drops, cleans,
resets, migrates or automatically retries any database or artifact.
"""

import argparse
import json
from pathlib import Path
import sys


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    actions = parser.add_subparsers(dest="action", required=True)
    actions.add_parser("plan")
    for name in ("backup", "list", "create-target", "restore"):
        action = actions.add_parser(name)
        action.add_argument("--archive", required=True)
        if name == "backup":
            action.add_argument("--approve-backup-output")
        elif name in {"create-target", "restore"}:
            action.add_argument("--database", required=True)
            action.add_argument("--approve-" + ("create" if name == "create-target" else "restore") + "-target")
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(root / "backend"))
    from verification.backup_safety import (
        PROPOSED_BACKUP_PATH, PROPOSED_RESTORE_DATABASE, create_backup,
        create_restore_target, list_archive, restore_archive,
        operation_summary,
        BackupSafetyError,
    )
    if args.action == "plan":
        print(json.dumps({"source": "finance_dashboard@127.0.0.1:5434", "source_revision": "0002_models",
                          "archive": str(PROPOSED_BACKUP_PATH), "proposed_restore_database": PROPOSED_RESTORE_DATABASE,
                          "executed": False, "approval_required": "backup output, fresh target creation and restore separately"}, sort_keys=True))
        return 0
    try:
        from app.config import Settings
        source = Settings().database_url.get_secret_value()
        if args.action == "backup":
            approved = args.approve_backup_output == args.archive == str(PROPOSED_BACKUP_PATH)
            result = create_backup(source, args.archive, approved=approved)
        elif args.action == "list":
            result = list_archive(source, args.archive)
        elif args.action == "create-target":
            approved = args.approve_create_target == args.database == PROPOSED_RESTORE_DATABASE
            result = create_restore_target(source, args.archive, args.database, approved=approved)
        else:
            approved = args.approve_restore_target == args.database == PROPOSED_RESTORE_DATABASE
            result = restore_archive(source, args.archive, args.database, approved=approved)
        # Manifests contain only schema, counts, hashes, versions and approved paths.
        print(json.dumps(operation_summary(result), sort_keys=True))
        return 0
    except BackupSafetyError as error:
        print("OPERATION_FAILED code=" + error.code + ": stop; retain artifacts and targets")
        return 1
    except Exception:
        print("OPERATION_FAILED code=UNEXPECTED_FAILURE: stop; retain artifacts and targets")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
