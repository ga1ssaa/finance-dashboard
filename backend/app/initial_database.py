"""Catalog-only policy for the separately authorized initial production migration.

This is not a provider-provenance or view-definition attestation. Never read the
views or grant an exemption to arbitrary extension members. No database writes.
"""

from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint, text


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
SELECT n.nspname::text,
       CASE WHEN n.nspname = 'public' THEN true
            WHEN n.nspname = '_heroku' THEN
                r.oid IS NOT NULL
                AND NOT pg_catalog.pg_has_role(current_user, n.nspowner, 'MEMBER')
                AND NOT pg_catalog.pg_has_role(current_user, n.nspowner, 'MEMBER WITH ADMIN OPTION')
                AND NOT pg_catalog.has_schema_privilege(current_user, n.oid, 'CREATE')
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                    WHERE p.pronamespace = n.oid AND (pg_catalog.pg_has_role(current_user, p.proowner, 'MEMBER')
                        OR pg_catalog.pg_has_role(current_user, p.proowner, 'MEMBER WITH ADMIN OPTION')))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_type t
                    WHERE t.typnamespace = n.oid AND (pg_catalog.pg_has_role(current_user, t.typowner, 'MEMBER')
                        OR pg_catalog.pg_has_role(current_user, t.typowner, 'MEMBER WITH ADMIN OPTION')))
                AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c
                    WHERE c.relnamespace = n.oid AND (pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER')
                        OR pg_catalog.pg_has_role(current_user, c.relowner, 'MEMBER WITH ADMIN OPTION')))
            ELSE false END
FROM pg_catalog.pg_namespace n
LEFT JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
  AND n.nspname !~ '^pg_(toast_)?temp_[0-9]+$'
"""  # Heroku documents this internal namespace; its name alone is not approval.

PUBLIC_READY_SQL = """
SELECT current_schema() = 'public'
   AND current_schemas(false) = ARRAY['public']::name[]
   AND pg_catalog.has_schema_privilege(current_user, 'public', 'USAGE')
   AND pg_catalog.has_schema_privilege(current_user, 'public', 'CREATE')
"""

TARGET_CONFLICTS_SQL = """
SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname::text = ANY(:relation_names)
    UNION ALL
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname::text = ANY(:table_names)
)
"""  # A standalone composite/domain type can conflict even without a table.

TARGET_TABLE_NAMES = frozenset({
    'alembic_version', 'owners', 'transactions', 'subscriptions', 'budget_profiles',
    'preferences', 'users', 'auth_sessions', 'auth_refresh_tokens',
    'data_operation_receipts', 'auth_rate_limits',
})  # Exact DDL footprint through the fixed revision 0005_auth_rate_limits.

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
DIAGNOSTIC_STAGES = ('COUNTS', 'SCHEMAS', 'EXTENSION_VERSION', 'VIEWS')
INITIAL_DATABASE_FAILURE_CODES = frozenset(
    'INITIAL_' + stage + '_' + failure
    for stage in DIAGNOSTIC_STAGES
    for failure in ('EXECUTION_FAILED', 'FETCH_FAILED', 'RESULT_INVALID', 'CLOSE_FAILED', 'NOT_APPROVED')
) | frozenset({
    'INITIAL_NAME_CHECK_FAILED', 'INITIAL_SCHEMA_CONFLICT',
    'INITIAL_TARGET_TIMEOUT', 'INITIAL_TARGET_CHECK_ERROR',
    'INITIAL_PUBLIC_SCHEMA_NOT_READY',
})


class InitialDatabaseError(RuntimeError):
    """Fixed output only; never include database values or original exceptions."""

    def __init__(self, code):
        super().__init__(FAILURE)
        self._code = code

    @property
    def code(self):
        code = self._code
        return code if type(code) is str and code in INITIAL_DATABASE_FAILURE_CODES else 'INITIAL_TARGET_CHECK_ERROR'

    def __str__(self):
        return FAILURE


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


def _rows(connection, sql, maximum, stage):
    # Fixed SQL, no bind values: preserve literal '%' through psycopg. Bound
    # replies and explicitly close results even when metadata is malformed.
    try:
        result = connection.exec_driver_sql(sql, execution_options={'no_parameters': True})
    except TimeoutError:
        raise
    except Exception:
        raise InitialDatabaseError('INITIAL_' + stage + '_EXECUTION_FAILED') from None
    try:
        try:
            rows = result.fetchmany(maximum + 1)
        except TimeoutError:
            raise
        except Exception:
            raise InitialDatabaseError('INITIAL_' + stage + '_FETCH_FAILED') from None
        try:
            too_many = len(rows) > maximum
            rows = [tuple(row) for row in rows]
        except TimeoutError:
            raise
        except Exception:
            raise InitialDatabaseError('INITIAL_' + stage + '_RESULT_INVALID') from None
        if too_many:
            raise InitialDatabaseError('INITIAL_' + stage + '_NOT_APPROVED')
        return rows
    finally:
        try:
            result.close()
        except TimeoutError:
            raise
        except Exception:
            raise InitialDatabaseError('INITIAL_' + stage + '_CLOSE_FAILED') from None


def require_initial_database(connection):
    """Allow zero relations OR exactly the approved pair, never partial matches.

    Only called by the production preflight and authorized new-target runner,
    after actual target/TLS checks. Any existing Alembic/application table is a
    counted relation, so this policy cannot authorize an incremental migration.
    The provider namespace is protected from the application and is never added
    to search_path or excluded from relation checks. No internal object manifest
    or trigger-name parser is needed: AVERO creates only public tables/indexes.
    """
    try:
        counts = _rows(connection, RELATIONS_SQL, 1, 'COUNTS')
        if (len(counts) != 1 or len(counts[0]) != 2
            or any(type(value) is not int for value in counts[0])):
            raise InitialDatabaseError('INITIAL_COUNTS_RESULT_INVALID')
        total, extensions = counts[0]
        if (total, extensions) not in ((0, 0), (2, 2)):
            raise InitialDatabaseError('INITIAL_COUNTS_NOT_APPROVED')
        schemas = _rows(connection, SCHEMAS_SQL, 2, 'SCHEMAS')
        if (not schemas or any(len(row) != 2 or type(row[0]) is not str or row[1] is not True for row in schemas)
            or len({row[0] for row in schemas}) != len(schemas)
            or {row[0] for row in schemas} not in ({'public'}, {'public', '_heroku'})):
            raise InitialDatabaseError('INITIAL_SCHEMAS_NOT_APPROVED')
        ready = _rows(connection, PUBLIC_READY_SQL, 1, 'SCHEMAS')
        if ready != [(True,)] or type(ready[0][0]) is not bool:
            raise InitialDatabaseError('INITIAL_PUBLIC_SCHEMA_NOT_READY')
        try:
            names = application_relation_names()
            result = connection.execute(text(TARGET_CONFLICTS_SQL), {
                'relation_names': sorted(names), 'table_names': sorted(TARGET_TABLE_NAMES),
            })
            try:
                conflict = result.scalar_one()
            finally:
                result.close()
            if type(conflict) is not bool:
                raise ValueError()
        except TimeoutError:
            raise
        except Exception:
            raise InitialDatabaseError('INITIAL_NAME_CHECK_FAILED') from None
        if conflict:
            raise InitialDatabaseError('INITIAL_SCHEMA_CONFLICT')
        versions = _rows(connection, EXTENSION_VERSION_SQL, 1, 'EXTENSION_VERSION')
        if total == 0:
            if versions:
                # An installed but incomplete extension is not an empty target.
                raise InitialDatabaseError('INITIAL_EXTENSION_VERSION_NOT_APPROVED')
            return
        if versions != [('1.12',)]:
            raise InitialDatabaseError('INITIAL_EXTENSION_VERSION_NOT_APPROVED')
        rows = _rows(connection, EXTENSION_RELATIONS_SQL, 2, 'VIEWS')
        if (len(rows) != 2 or any(len(row) != 6 for row in rows)
            or any(any(type(value) is not str for value in row[:5])
                   or type(row[5]) is not bool for row in rows)):
            raise InitialDatabaseError('INITIAL_VIEWS_RESULT_INVALID')
        if frozenset(rows) != APPROVED_VIEWS:
            raise InitialDatabaseError('INITIAL_VIEWS_NOT_APPROVED')
        if {row[1] for row in rows} & names:
            raise InitialDatabaseError('INITIAL_SCHEMA_CONFLICT')
    except InitialDatabaseError:
        raise
    except TimeoutError:
        raise InitialDatabaseError('INITIAL_TARGET_TIMEOUT') from None
    except Exception:
        # Never echo catalog values, SQLAlchemy errors or connection details.
        raise InitialDatabaseError('INITIAL_TARGET_CHECK_ERROR') from None
