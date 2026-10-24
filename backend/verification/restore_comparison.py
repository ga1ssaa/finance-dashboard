"""Pure, directed comparison of one reviewed PostgreSQL 17 restore variation.

Raw fingerprints remain untouched. Only the three exact enum CHECK spellings
below may differ, after each input's original catalog hash is verified.
"""

import hashlib
import json


_TABLES = {"owners", "transactions", "subscriptions", "budget_profiles", "preferences", "alembic_version"}
_FINANCIAL = _TABLES - {"alembic_version"}
_FP_KEYS = {"revision", "schema_sha256", "catalog", "database_metadata", "server_major", "financial"}
_CATALOG_KEYS = {"relations", "columns", "constraints", "indexes"}
_FLAGS = ["c", False, False, True, False]

# Literal values and complete column metadata are fixed to the reviewed schema.
_SPECS = (
    ("preferences", "ck_preferences_display_currency", "display_currency", ("USD", "KZT", "EUR", "RUB"),
     ("preferences", 5, "display_currency", "character varying(3)", True, "'USD'::character varying", "", "", "default")),
    ("subscriptions", "ck_subscriptions_status", "status", ("active", "paused"),
     ("subscriptions", 9, "status", "character varying(6)", True, "'active'::character varying", "", "", "default")),
    ("transactions", "ck_transactions_type", "type", ("income", "expense"),
     ("transactions", 7, "type", "character varying(7)", True, None, "", "", "default")),
)
_PAIRS = {}
for _table, _name, _column, _values, _column_row in _SPECS:
    _wide = ", ".join("'" + value + "'::character varying" for value in _values)
    _elements = ", ".join("('" + value + "'::character varying)::text" for value in _values)
    _PAIRS[(_table, _name)] = (
        "CHECK (((" + _column + ")::text = ANY ((ARRAY[" + _wide + "])::text[])))",
        "CHECK (((" + _column + ")::text = ANY (ARRAY[" + _elements + "])))",
        _column_row,
    )


def _encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(value):
    return type(value) is str and len(value) == 64 and all(char in "0123456789abcdef" for char in value)


def _text(value):
    return type(value) is str and bool(value)


def _nullable_text(value):
    return value is None or type(value) is str


def _valid_rows(section, rows):
    widths = {"relations": 7, "columns": 9, "constraints": 8, "indexes": 7}
    if type(rows) is not list or not rows:
        return False
    keys = []
    names = set()
    for row in rows:
        if type(row) is not list or len(row) != widths[section] or row[0] not in _TABLES:
            return False
        if section == "relations":
            if (not all(_text(row[i]) for i in (0, 1, 2, 5))
                    or any(type(row[i]) is not bool for i in (3, 4))
                    or not (row[6] is None or type(row[6]) is list and all(type(item) is str for item in row[6]))):
                return False
            key = (row[0],)
        elif section == "columns":
            if (type(row[1]) is not int or row[1] < 1 or not all(_text(row[i]) for i in (0, 2, 3))
                    or type(row[4]) is not bool or not _nullable_text(row[5])
                    or any(type(row[i]) is not str for i in (6, 7)) or not _nullable_text(row[8])):
                return False
            key = (row[0], row[1])
            name = (row[0], row[2])
            if name in names:
                return False
            names.add(name)
        else:
            flags = (3, 4, 5, 6) if section == "constraints" else (2, 3, 4, 5)
            if (not _text(row[1]) or not _text(row[-1])
                    or any(type(row[i]) is not bool for i in flags)):
                return False
            if section == "constraints" and (type(row[2]) is not str or row[2] not in {"p", "u", "c", "f"}):
                return False
            key = (row[0], row[1])
        if key in keys:
            return False
        keys.append(key)
    if keys != sorted(keys):
        return False
    if section == "relations" and {row[0] for row in rows} != _TABLES:
        return False
    return section != "constraints" or len(rows) == 25


def _valid_fingerprint(value):
    if type(value) is not dict or set(value) != _FP_KEYS:
        return False
    if value["revision"] != ["0002_models"] or type(value["revision"]) is not list:
        return False
    if type(value["server_major"]) is not int or value["server_major"] != 17 or not _sha(value["schema_sha256"]):
        return False
    metadata = value["database_metadata"]
    if (type(metadata) is not list or len(metadata) != 6 or not all(_text(item) for item in metadata[:4])
            or not all(_nullable_text(item) for item in metadata[4:])):
        return False
    financial = value["financial"]
    if type(financial) is not dict or set(financial) != _FINANCIAL:
        return False
    for row in financial.values():
        if (type(row) is not dict or set(row) != {"count", "sha256"}
                or type(row["count"]) is not int or row["count"] < 0 or not _sha(row["sha256"])):
            return False
    catalog = value["catalog"]
    if type(catalog) is not dict or set(catalog) != _CATALOG_KEYS:
        return False
    if not all(_valid_rows(section, rows) for section, rows in catalog.items()):
        return False
    # Verify the untouched raw catalog, before any allowed spelling substitution.
    return hashlib.sha256(_encoded(catalog)).hexdigest() == value["schema_sha256"]


def restored_fingerprint_matches(backup_fp, target_fp):
    """Return False on every unknown/malformed variant; never mutate callers."""
    try:
        if not _valid_fingerprint(backup_fp) or not _valid_fingerprint(target_fp):
            return False
        for field in _FP_KEYS - {"catalog", "schema_sha256"}:
            if _encoded(backup_fp[field]) != _encoded(target_fp[field]):
                return False
        source = backup_fp["catalog"]
        target = target_fp["catalog"]
        source_rows = {(row[0], row[1]): row for row in source["constraints"]}
        compared_rows = [list(row) for row in target["constraints"]]
        target_rows = {(row[0], row[1]): row for row in compared_rows}
        source_columns = {(row[0], row[2]): row for row in source["columns"]}
        target_columns = {(row[0], row[2]): row for row in target["columns"]}
        for key, (wide, elements, column_row) in _PAIRS.items():
            expected = list(key) + _FLAGS
            source_row, target_row = source_rows.get(key), target_rows.get(key)
            if (source_row is None or target_row is None or source_row[:7] != expected
                    or target_row[:7] != expected or source_row[7] != wide or target_row[7] not in (wide, elements)):
                return False
            column_key = (column_row[0], column_row[2])
            if source_columns.get(column_key) != list(column_row) or target_columns.get(column_key) != list(column_row):
                return False
            target_row[7] = wide  # Only our new comparison row is changed.
        compared_catalog = {**target, "constraints": compared_rows}
        return _encoded(source) == _encoded(compared_catalog)
    except (TypeError, ValueError, KeyError, IndexError, RecursionError):
        return False
