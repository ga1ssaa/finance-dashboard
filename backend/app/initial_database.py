"""Catalog-only policy for the separately authorized initial production migration.

This is not a provider-provenance or view-definition attestation. Never read the
views or grant an exemption to arbitrary extension members. No database writes.
"""

from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint


RELATIONS_SQL = """
SELECT count(*), count(*) FILTER (WHERE EXISTS (
    SELECT 1 FROM pg_catalog.pg_depend d
    WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
      AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_extension'::regclass
      AND d.refobjsubid = 0 AND d.deptype = 'e'))
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_%'
  AND c.relkind IN ('r','p','v','m','S','f')
"""

SCHEMAS_SQL = """
SELECT nspname FROM pg_catalog.pg_namespace
WHERE nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND nspname !~ '^pg_(toast_)?temp_[0-9]+$'
"""  # Unlike the legacy LIKE pattern, do not hide a user schema such as pgXtest.

EXTENSION_VERSION_SQL = """
SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'pg_stat_statements'
"""

EXTENSION_RELATIONS_SQL = """
SELECT n.nspname, c.relname, c.relkind, e.extname, e.extversion,
       (d.objid IS NOT NULL)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_depend d
  ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
 AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_extension'::regclass
 AND d.refobjsubid = 0 AND d.deptype = 'e'
LEFT JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_%'
  AND c.relkind IN ('r','p','v','m','S','f')
"""

APPROVED_VIEWS = frozenset({
    ('public', 'pg_stat_statements', 'v', 'pg_stat_statements', '1.12', True),
    ('public', 'pg_stat_statements_info', 'v', 'pg_stat_statements', '1.12', True),
})
FAILURE = 'Refusing migration: target is not a new empty or approved initial database'


def application_relation_names():
    """Names reserved by the complete reviewed DDL, including backing indexes.

    The current UUID models have no sequences; include explicit metadata
    sequences defensively if a future, separately reviewed revision adds one.
    """
    import app.models  # noqa: F401 -- register all tables without connecting.
    from app.db import Base
    from app.rate_limits import rate_table

    names = {'alembic_version', 'alembic_version_pkc'}
    for metadata in (Base.metadata, rate_table.metadata):
        names.update(sequence.name for sequence in metadata._sequences.values())
        for table in metadata.tables.values():
            names.add(table.name)
            names.update(index.name for index in table.indexes if index.name)
            for constraint in table.constraints:
                if isinstance(constraint, (PrimaryKeyConstraint, UniqueConstraint)):
                    names.add(constraint.name or table.name + '_pkey')
    return names


def _rows(connection, sql, maximum):
    # Fixed SQL, no bind values: preserve literal '%' through psycopg. Bound
    # replies and explicitly close results even when metadata is malformed.
    result = connection.exec_driver_sql(sql, execution_options={'no_parameters': True})
    try:
        rows = result.fetchmany(maximum + 1)
        if len(rows) > maximum:
            raise RuntimeError(FAILURE)
        return [tuple(row) for row in rows]
    finally:
        result.close()


def require_initial_database(connection):
    """Allow zero relations OR exactly the approved pair, never partial matches.

    Only called by the production preflight and authorized new-target runner,
    after actual target/TLS checks. Any existing Alembic/application table is a
    counted relation, so this policy cannot authorize an incremental migration.
    """
    try:
        counts = _rows(connection, RELATIONS_SQL, 1)
        if (len(counts) != 1 or len(counts[0]) != 2
            or any(type(value) is not int for value in counts[0])):
            raise RuntimeError(FAILURE)
        total, extensions = counts[0]
        if (total, extensions) not in ((0, 0), (2, 2)):
            raise RuntimeError(FAILURE)
        if _rows(connection, SCHEMAS_SQL, 1) != [('public',)]:
            raise RuntimeError(FAILURE)
        versions = _rows(connection, EXTENSION_VERSION_SQL, 1)
        if total == 0:
            if versions:
                # An installed but incomplete extension is not an empty target.
                raise RuntimeError(FAILURE)
            return
        if versions != [('1.12',)]:
            raise RuntimeError(FAILURE)
        rows = _rows(connection, EXTENSION_RELATIONS_SQL, 2)
        if (len(rows) != 2 or any(len(row) != 6 for row in rows)
            or any(any(type(value) is not str for value in row[:5])
                   or type(row[5]) is not bool for row in rows)
            or frozenset(rows) != APPROVED_VIEWS
            or {row[1] for row in rows} & application_relation_names()):
            raise RuntimeError(FAILURE)
    except Exception:
        # Never echo catalog values, SQLAlchemy errors or connection details.
        raise RuntimeError(FAILURE) from None
