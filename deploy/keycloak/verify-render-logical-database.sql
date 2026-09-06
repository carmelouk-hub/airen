\set ON_ERROR_STOP on

-- AIRenOS Identity F2.6 — read-only live verifier for the Render Keycloak
-- logical database boundary. This file must never contain credentials.
\set keycloak_runtime_role 'airenos_keycloak_runtime_f26'
\set keycloak_database 'airenos_keycloak_f26_staging'

\echo 'F2.6 read-only verification: runtime role and logical database'

SELECT
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = :'keycloak_runtime_role'
  ) AS runtime_role_exists,
  COALESCE((
    SELECT rolcanlogin
       AND NOT rolsuper
       AND NOT rolinherit
       AND NOT rolcreatedb
       AND NOT rolcreaterole
       AND NOT rolreplication
       AND NOT rolbypassrls
    FROM pg_catalog.pg_roles
    WHERE rolname = :'keycloak_runtime_role'
  ), false) AS runtime_role_safe,
  COALESCE((
    SELECT count(*) = 0
    FROM pg_catalog.pg_auth_members am
    JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
    WHERE member_role.rolname = :'keycloak_runtime_role'
  ), false) AS runtime_has_no_memberships,
  COALESCE((
    SELECT count(*) = 0
    FROM pg_catalog.pg_db_role_setting s
    JOIN pg_catalog.pg_roles r ON r.oid = s.setrole
    CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting)
    WHERE r.rolname = :'keycloak_runtime_role'
      AND lower(cfg.setting) LIKE 'role=%'
  ), false) AS runtime_has_no_startup_role_override,
  COALESCE((
    SELECT (
      (SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relowner = r.oid) +
      (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proowner = r.oid) +
      (SELECT count(*) FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid)
    ) = 0
    FROM pg_catalog.pg_roles r
    WHERE r.rolname = :'keycloak_runtime_role'
  ), false) AS runtime_owns_no_identity_objects,
  EXISTS (
    SELECT 1
    FROM pg_catalog.pg_database
    WHERE datname = :'keycloak_database'
  ) AS keycloak_database_exists,
  COALESCE((
    SELECT pg_catalog.pg_get_userbyid(datdba) = :'keycloak_runtime_role'
       AND datallowconn
    FROM pg_catalog.pg_database
    WHERE datname = :'keycloak_database'
  ), false) AS keycloak_database_owned_and_connectable
\gset f26_

\if :f26_runtime_role_exists
\else
  \echo 'F2.6 FAIL: runtime role is missing'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: runtime role is missing'; END $f26$;
\endif

\if :f26_runtime_role_safe
\else
  \echo 'F2.6 FAIL: runtime role attributes are unsafe'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: runtime role attributes are unsafe'; END $f26$;
\endif

\if :f26_runtime_has_no_memberships
\else
  \echo 'F2.6 FAIL: runtime role has unexpected memberships'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: runtime role has unexpected memberships'; END $f26$;
\endif

\if :f26_runtime_has_no_startup_role_override
\else
  \echo 'F2.6 FAIL: runtime role has a startup role override'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: runtime role has a startup role override'; END $f26$;
\endif

\if :f26_runtime_owns_no_identity_objects
\else
  \echo 'F2.6 FAIL: runtime role owns objects in the AIRenOS Identity database'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: runtime role owns objects in the AIRenOS Identity database'; END $f26$;
\endif

\if :f26_keycloak_database_exists
\else
  \echo 'F2.6 FAIL: Keycloak logical database is missing'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: Keycloak logical database is missing'; END $f26$;
\endif

\if :f26_keycloak_database_owned_and_connectable
\else
  \echo 'F2.6 FAIL: Keycloak logical database owner/connectability mismatch'
  DO $f26$ BEGIN RAISE EXCEPTION 'F2.6 FAIL: Keycloak logical database owner/connectability mismatch'; END $f26$;
\endif

SELECT
  r.rolname,
  r.rolcanlogin,
  r.rolsuper,
  r.rolinherit,
  r.rolcreatedb,
  r.rolcreaterole,
  r.rolreplication,
  r.rolbypassrls,
  (SELECT count(*)
   FROM pg_catalog.pg_auth_members am
   WHERE am.member = r.oid) AS membership_count,
  (SELECT count(*)
   FROM pg_catalog.pg_db_role_setting s
   CROSS JOIN LATERAL unnest(s.setconfig) AS cfg(setting)
   WHERE s.setrole = r.oid
     AND lower(cfg.setting) LIKE 'role=%') AS startup_role_override_count,
  ((SELECT count(*) FROM pg_catalog.pg_class c WHERE c.relowner = r.oid) +
   (SELECT count(*) FROM pg_catalog.pg_proc p WHERE p.proowner = r.oid) +
   (SELECT count(*) FROM pg_catalog.pg_namespace n WHERE n.nspowner = r.oid)) AS identity_owned_object_count
FROM pg_catalog.pg_roles r
WHERE r.rolname = :'keycloak_runtime_role';

SELECT
  d.datname,
  pg_catalog.pg_get_userbyid(d.datdba) AS database_owner,
  d.datallowconn
FROM pg_catalog.pg_database d
WHERE d.datname = :'keycloak_database';

\echo 'F2.6 PASS: runtime role and Keycloak logical database live read-back verified'
