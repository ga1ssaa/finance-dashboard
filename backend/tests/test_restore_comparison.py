"""Pure restore-comparison regressions; no database, processes or artifacts."""
from copy import deepcopy
import hashlib
import json
from unittest.mock import MagicMock

import pytest

from verification.restore_comparison import restored_fingerprint_matches


KNOWN = (
    ("preferences", "ck_preferences_display_currency", "display_currency", ("USD", "KZT", "EUR", "RUB")),
    ("subscriptions", "ck_subscriptions_status", "status", ("active", "paused")),
    ("transactions", "ck_transactions_type", "type", ("income", "expense")),
)
SOURCE_DEFINITIONS = (
    "CHECK (((display_currency)::text = ANY ((ARRAY['USD'::character varying, 'KZT'::character varying, 'EUR'::character varying, 'RUB'::character varying])::text[])))",
    "CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'paused'::character varying])::text[])))",
    "CHECK (((type)::text = ANY ((ARRAY['income'::character varying, 'expense'::character varying])::text[])))",
)
TARGET_DEFINITIONS = (
    "CHECK (((display_currency)::text = ANY (ARRAY[('USD'::character varying)::text, ('KZT'::character varying)::text, ('EUR'::character varying)::text, ('RUB'::character varying)::text])))",
    "CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('paused'::character varying)::text])))",
    "CHECK (((type)::text = ANY (ARRAY[('income'::character varying)::text, ('expense'::character varying)::text])))",
)
FINANCIAL_TABLES = ("owners", "transactions", "subscriptions", "budget_profiles", "preferences")


@pytest.fixture(autouse=True)
def no_external_io(monkeypatch):
    import subprocess
    import psycopg
    import sqlalchemy
    forbidden = MagicMock(side_effect=AssertionError("Restore comparison must remain pure"))
    monkeypatch.setattr(subprocess, "run", forbidden)
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    monkeypatch.setattr(psycopg, "connect", forbidden)
    monkeypatch.setattr(sqlalchemy, "create_engine", forbidden)
    yield forbidden
    forbidden.assert_not_called()


def rehash(fingerprint):
    payload = json.dumps(fingerprint["catalog"], sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    fingerprint["schema_sha256"] = hashlib.sha256(payload).hexdigest()
    return fingerprint


def constraint(table, name, kind, definition):
    return [table, name, kind, False, False, True, False, definition]


def fingerprint():
    constraints = [constraint(table, name, "c", definition) for (table, name, _, _), definition in zip(KNOWN, SOURCE_DEFINITIONS)]
    constraints += [constraint(table, "pk_" + table, "p", "PRIMARY KEY (id)") for table in FINANCIAL_TABLES]
    constraints.append(constraint("alembic_version", "alembic_version_pkc", "p", "PRIMARY KEY (version_num)"))
    for table in ("transactions", "subscriptions", "budget_profiles", "preferences"):
        constraints.append(constraint(table, f"fk_{table}_owner_id_owners", "f", "FOREIGN KEY (owner_id) REFERENCES owners(id) ON DELETE RESTRICT"))
    for table in ("budget_profiles", "preferences"):
        constraints.append(constraint(table, f"uq_{table}_owner_id", "u", "UNIQUE (owner_id)"))
    for table, name, expression in (
        ("transactions", "title_nonblank", "title ~ '[^[:space:]]'::text"),
        ("transactions", "category_nonblank", "category ~ '[^[:space:]]'::text"),
        ("transactions", "amount_usd_positive_finite", "amount_usd > 0::numeric"),
        ("subscriptions", "service_name_nonblank", "service_name ~ '[^[:space:]]'::text"),
        ("subscriptions", "icon_nonblank", "icon ~ '[^[:space:]]'::text"),
        ("subscriptions", "amount_usd_nonnegative_finite", "amount_usd >= 0::numeric"),
        ("budget_profiles", "monthly_income_usd_nonnegative_finite", "monthly_income_usd >= 0::numeric"),
        ("budget_profiles", "needs_spent_usd_nonnegative_finite", "needs_spent_usd >= 0::numeric"),
        ("budget_profiles", "wants_spent_usd_nonnegative_finite", "wants_spent_usd >= 0::numeric"),
        ("budget_profiles", "savings_usd_nonnegative_finite", "savings_usd >= 0::numeric"),
    ):
        constraints.append(constraint(table, f"ck_{table}_{name}", "c", "CHECK ((" + expression + "))"))
    assert len(constraints) == 25
    catalog = {
        "relations": [[name, "r", "p", False, False, "d", None] for name in sorted((*FINANCIAL_TABLES, "alembic_version"))],
        "columns": [
            ["owners", 1, "id", "uuid", True, None, "", "", None],
            ["preferences", 5, "display_currency", "character varying(3)", True, "'USD'::character varying", "", "", "default"],
            ["subscriptions", 9, "status", "character varying(6)", True, "'active'::character varying", "", "", "default"],
            ["transactions", 7, "type", "character varying(7)", True, None, "", "", "default"],
        ],
        "constraints": sorted(constraints, key=lambda row: (row[0], row[1])),
        "indexes": [["owners", "pk_owners", True, True, True, True, "CREATE UNIQUE INDEX pk_owners ON public.owners USING btree (id)"]],
    }
    return rehash({"revision": ["0002_models"], "server_major": 17, "database_metadata": ["UTF8", "en_US.utf8", "en_US.utf8", "c", None, "2.41"],
                   "catalog": catalog, "financial": {table: {"count": 0, "sha256": hashlib.sha256(b"").hexdigest()} for table in FINANCIAL_TABLES}})


def known_row(value, number):
    table, name, _, _ = KNOWN[number]
    return next(row for row in value["catalog"]["constraints"] if row[:2] == [table, name])


def target_with_forms(numbers):
    target = fingerprint()
    for number in numbers:
        known_row(target, number)[7] = TARGET_DEFINITIONS[number]
    return rehash(target)


@pytest.mark.parametrize("numbers", [(), (0,), (1,), (2,), (0, 1), (0, 2), (1, 2), (0, 1, 2)])
def test_exact_reviewed_backup_accepts_only_identical_or_observed_restored_forms(numbers):
    assert restored_fingerprint_matches(fingerprint(), target_with_forms(numbers)) is True


@pytest.mark.parametrize("number", range(3))
def test_changed_backup_form_is_not_reinterpreted_as_the_approved_archive(number):
    changed_backup = target_with_forms((number,))
    assert restored_fingerprint_matches(changed_backup, fingerprint()) is False
    assert restored_fingerprint_matches(changed_backup, deepcopy(changed_backup)) is False


@pytest.mark.parametrize("number", range(3))
@pytest.mark.parametrize("mutation", ["changed", "added", "missing", "reordered", "null", "wrong_column", "operator", "all", "cast", "collation", "whitespace", "unknown"])
def test_membership_definition_changes_are_rejected_even_with_valid_raw_hashes(number, mutation):
    target = target_with_forms((number,))
    row = known_row(target, number)
    values = KNOWN[number][3]
    first, second = values[:2]
    expression = row[7]
    if mutation == "changed":
        expression = expression.replace("'" + first + "'", "'not-approved'")
    elif mutation == "added":
        expression = expression.replace("ARRAY[", "ARRAY[('extra'::character varying)::text, ", 1)
    elif mutation == "missing":
        expression = expression.replace("('" + first + "'::character varying)::text, ", "", 1)
    elif mutation == "reordered":
        expression = expression.replace("'" + first + "'", "'__swap__'").replace("'" + second + "'", "'" + first + "'").replace("'__swap__'", "'" + second + "'")
    elif mutation == "null":
        expression = expression.replace("'" + first + "'::character varying", "NULL::character varying", 1)
    elif mutation == "wrong_column":
        expression = expression.replace("((" + KNOWN[number][2] + ")", "((other_column)", 1)
    elif mutation == "operator":
        expression = expression.replace(" = ANY ", " <> ANY ")
    elif mutation == "all":
        expression = expression.replace("ANY", "ALL")
    elif mutation == "cast":
        expression = expression.replace("character varying", "character", 1)
    elif mutation == "collation":
        expression = expression.replace("::text =", '::text COLLATE "C" =', 1)
    elif mutation == "whitespace":
        expression = expression.replace("CHECK (", "CHECK  (", 1)
    else:
        expression = "CHECK (true)"
    row[7] = expression
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("number", range(3))
def test_unchanged_unknown_expression_under_a_known_name_is_not_auto_accepted(number):
    source = fingerprint()
    known_row(source, number)[7] = "CHECK (true)"
    rehash(source)
    assert restored_fingerprint_matches(source, deepcopy(source)) is False


@pytest.mark.parametrize("position,value", [(2, "f"), (3, True), (4, True), (5, False), (6, True), (3, 0), (5, 1)])
def test_known_check_type_and_all_flags_remain_strict(position, value):
    target = target_with_forms((0, 1, 2))
    known_row(target, 0)[position] = value
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("kind,mutation", [("f", "action"), ("u", "definition"), ("c", "other_check"), ("p", "definition"), ("f", "deferral"), ("f", "validation"), ("c", "noinherit")])
def test_unrelated_constraints_never_receive_a_semantic_exception(kind, mutation):
    target = target_with_forms((0, 1, 2))
    row = next(row for row in target["catalog"]["constraints"] if row[2] == kind and row[:2] not in [list(value[:2]) for value in KNOWN])
    if mutation == "action":
        row[7] = row[7].replace("RESTRICT", "CASCADE")
    elif mutation == "definition":
        row[7] += " changed"
    elif mutation == "other_check":
        row[7] = "CHECK (true)"
    elif mutation == "deferral":
        row[3] = True
    elif mutation == "validation":
        row[5] = False
    else:
        row[6] = not row[6]
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("change", ["missing", "extra", "duplicate", "malformed"])
def test_constraint_inventory_cannot_be_missing_extended_duplicated_or_malformed(change):
    target = target_with_forms((0, 1, 2))
    rows = target["catalog"]["constraints"]
    if change == "missing":
        rows.pop()
    elif change == "extra":
        rows.append(constraint("owners", "extra_check", "c", "CHECK (true)"))
    elif change == "duplicate":
        rows[-1] = deepcopy(rows[0])
    else:
        rows[0].pop()
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("section", ["relations", "columns", "indexes"])
def test_other_catalog_differences_are_rejected(section):
    target = target_with_forms((0, 1, 2))
    target["catalog"][section][0][-1] = "changed"
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("section", ["relations", "columns", "indexes"])
def test_duplicate_catalog_identities_are_rejected_even_when_both_inputs_match(section):
    source = fingerprint()
    source["catalog"][section].append(deepcopy(source["catalog"][section][0]))
    rehash(source)
    assert restored_fingerprint_matches(source, deepcopy(source)) is False


@pytest.mark.parametrize("field,value", [(1, 4), (3, "character(3)"), (4, False), (4, 1), (5, "'EUR'::character varying"), (6, "a"), (7, "s"), (8, "C")])
def test_reviewed_column_specifications_are_required_even_with_matching_inputs(field, value):
    source = fingerprint()
    row = next(row for row in source["catalog"]["columns"] if row[:3] == ["preferences", 5, "display_currency"])
    row[field] = value
    rehash(source)
    assert restored_fingerprint_matches(source, deepcopy(source)) is False


@pytest.mark.parametrize("where", ["source", "target", "both"])
def test_raw_catalog_sha_integrity_is_checked_before_any_exception(where):
    source, target = fingerprint(), target_with_forms((0, 1, 2))
    if where in {"source", "both"}:
        source["schema_sha256"] = "0" * 64
    if where in {"target", "both"}:
        target["schema_sha256"] = "0" * 64
    assert restored_fingerprint_matches(source, target) is False


def test_recomputed_target_hash_cannot_hide_a_different_unrelated_catalog():
    target = target_with_forms((0, 1, 2))
    target["catalog"]["constraints"][0][7] += " changed"
    rehash(target)
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("change", ["count", "count_bool", "hash", "missing", "extra", "revision", "server_float", "locale"])
def test_data_revision_server_and_locale_remain_type_sensitive_and_strict(change):
    target = target_with_forms((0, 1, 2))
    if change == "count":
        target["financial"]["owners"]["count"] = 1
    elif change == "count_bool":
        target["financial"]["owners"]["count"] = False
    elif change == "hash":
        target["financial"]["owners"]["sha256"] = "a" * 64
    elif change == "missing":
        del target["financial"]["owners"]
    elif change == "extra":
        target["financial"]["extra"] = {"count": 0, "sha256": "a" * 64}
    elif change == "revision":
        target["revision"] = ["0003_auth"]
    elif change == "server_float":
        target["server_major"] = 17.0
    else:
        target["database_metadata"][1] = "C"
    assert restored_fingerprint_matches(fingerprint(), target) is False


@pytest.mark.parametrize("change", ["unknown_top", "unknown_catalog", "unknown_financial", "bad_catalog_type", "bad_constraint_type", "revision_both"])
def test_matching_malformed_or_unknown_input_is_not_accepted(change):
    source = fingerprint()
    if change == "unknown_top":
        source["unreviewed"] = True
    elif change == "unknown_catalog":
        source["catalog"]["unreviewed"] = []
        rehash(source)
    elif change == "unknown_financial":
        source["financial"]["owners"]["unreviewed"] = True
    elif change == "bad_catalog_type":
        source["catalog"]["constraints"] = tuple(source["catalog"]["constraints"])
        rehash(source)
    elif change == "bad_constraint_type":
        source["catalog"]["constraints"][0][3] = 0
        rehash(source)
    else:
        source["revision"] = ["0003_auth"]
    assert restored_fingerprint_matches(source, deepcopy(source)) is False


@pytest.mark.parametrize("successful", [False, True])
def test_comparison_never_mutates_caller_catalogs_or_raw_hashes(successful):
    source, target = fingerprint(), target_with_forms((0, 1, 2))
    if not successful:
        known_row(target, 0)[7] = "CHECK (false)"
        rehash(target)
    original_source, original_target = deepcopy(source), deepcopy(target)
    assert restored_fingerprint_matches(source, target) is successful
    assert source == original_source and target == original_target
