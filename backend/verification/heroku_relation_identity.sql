-- Diagnostic only; not migration approval or proof of provider provenance.
-- Run via connection.execute(text(sql), {"avero_relation_names": reviewed_names})
-- inside the existing verified read-only preflight transaction. Never print
-- connection parameters, owner names, view definitions, or application rows.
SELECT n.nspname AS schema_name,
       c.relname AS relation_name,
       c.relkind AS relation_kind,
       e.extname AS extension_name,
       e.extversion AS extension_version,
       (d.objid IS NOT NULL) AS exact_extension_member,
       (n.nspname = 'public'
        AND c.relname::text = ANY(:avero_relation_names)) AS avero_name_conflict,
       'UNVERIFIED'::text AS provider_provenance
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_depend d
  ON d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = c.oid
 AND d.objsubid = 0 AND d.refclassid = 'pg_catalog.pg_extension'::regclass
 AND d.refobjsubid = 0 AND d.deptype = 'e'
LEFT JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
WHERE n.nspname NOT IN ('pg_catalog','information_schema')
  AND n.nspname NOT LIKE 'pg_%'
  AND c.relkind IN ('r','p','v','m','S','f')
ORDER BY n.nspname, c.relname, e.extname
