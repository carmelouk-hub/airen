\set ON_ERROR_STOP on

\if :{?keycloak_runtime_password}
\else
  \echo 'missing required in-memory keycloak_runtime_password'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'missing required in-memory keycloak_runtime_password';
  END $f26$;
\endif

\set keycloak_runtime_role 'airenos_keycloak_runtime_f26'
\set keycloak_database 'airenos_keycloak_f26_staging'

SELECT format(
  'CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'keycloak_runtime_role',
  :'keycloak_runtime_password'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = :'keycloak_runtime_role'
) \gexec

SELECT CASE
  WHEN rolcanlogin
    AND NOT rolsuper
    AND NOT rolinherit
    AND NOT rolcreatedb
    AND NOT rolcreaterole
    AND NOT rolreplication
    AND NOT rolbypassrls
  THEN 'false'
  ELSE 'true'
END AS keycloak_runtime_role_unsafe
FROM pg_catalog.pg_roles
WHERE rolname = :'keycloak_runtime_role' \gset

\if :keycloak_runtime_role_unsafe
  \echo 'existing Keycloak runtime role violates the least-privilege boundary'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'existing Keycloak runtime role violates the least-privilege boundary';
  END $f26$;
\endif

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOINHERIT PASSWORD %L',
  :'keycloak_runtime_role',
  :'keycloak_runtime_password'
) \gexec

-- PostgreSQL 17 automatically grants a non-superuser CREATEROLE creator
-- ADMIN TRUE, INHERIT FALSE, SET FALSE on a role it creates. That bootstrap-
-- granted row cannot be modified by the creator. If a prior interrupted run
-- left our own temporary self-grant behind, remove only that grant first.
SELECT format(
  'REVOKE %I FROM %I GRANTED BY %I',
  :'keycloak_runtime_role',
  current_user,
  current_user
)
WHERE EXISTS (
  SELECT 1
  FROM pg_catalog.pg_auth_members am
  JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
  JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
  JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid = am.grantor
  WHERE granted_role.rolname = :'keycloak_runtime_role'
    AND member_role.rolname = current_user
    AND grantor_role.rolname = current_user
) \gexec

SELECT (
  count(*) = 1
  AND bool_and(am.admin_option)
  AND bool_and(NOT am.inherit_option)
  AND bool_and(NOT am.set_option)
  AND bool_and(grantor_role.rolname <> member_role.rolname)
)::text AS provider_admin_bootstrap_control_safe
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid = am.grantor
WHERE granted_role.rolname = :'keycloak_runtime_role'
  AND member_role.rolname = current_user
\gset

\if :provider_admin_bootstrap_control_safe
\else
  \echo 'provider admin bootstrap Keycloak runtime control boundary is unsafe'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'provider admin bootstrap Keycloak runtime control boundary is unsafe';
  END $f26$;
\endif

-- CREATE DATABASE ... OWNER requires SET ROLE ability to the target owner.
-- Add a second, self-granted membership with SET TRUE only for that command;
-- never inherit runtime privileges and never duplicate ADMIN authority.
SELECT format(
  'GRANT %I TO %I WITH INHERIT FALSE, SET TRUE GRANTED BY %I',
  :'keycloak_runtime_role',
  current_user,
  current_user
) \gexec

SELECT (
  count(*) = 1
  AND bool_and(NOT am.admin_option)
  AND bool_and(NOT am.inherit_option)
  AND bool_and(am.set_option)
)::text AS provider_admin_temporary_set_safe
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid = am.grantor
WHERE granted_role.rolname = :'keycloak_runtime_role'
  AND member_role.rolname = current_user
  AND grantor_role.rolname = current_user
\gset

\if :provider_admin_temporary_set_safe
\else
  \echo 'temporary Keycloak runtime SET grant is unsafe'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'temporary Keycloak runtime SET grant is unsafe';
  END $f26$;
\endif

\set ON_ERROR_STOP off
SELECT format(
  'CREATE DATABASE %I OWNER %I',
  :'keycloak_database',
  :'keycloak_runtime_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_database WHERE datname = :'keycloak_database'
) \gexec
\set keycloak_database_create_sqlstate :SQLSTATE
\set ON_ERROR_STOP on

-- Cleanup is grantor-scoped so the immutable bootstrap ADMIN row remains.
SELECT format(
  'REVOKE %I FROM %I GRANTED BY %I',
  :'keycloak_runtime_role',
  current_user,
  current_user
) \gexec

SELECT (
  count(*) = 1
  AND bool_and(am.admin_option)
  AND bool_and(NOT am.inherit_option)
  AND bool_and(NOT am.set_option)
  AND bool_and(grantor_role.rolname <> member_role.rolname)
)::text AS provider_admin_bootstrap_control_restored
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
JOIN pg_catalog.pg_roles grantor_role ON grantor_role.oid = am.grantor
WHERE granted_role.rolname = :'keycloak_runtime_role'
  AND member_role.rolname = current_user
\gset

\if :provider_admin_bootstrap_control_restored
\else
  \echo 'temporary Keycloak runtime SET authority cleanup failed'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'temporary Keycloak runtime SET authority cleanup failed';
  END $f26$;
\endif

SELECT :'keycloak_database_create_sqlstate' = '00000' AS keycloak_database_create_ok \gset
\if :keycloak_database_create_ok
\else
  \echo 'Keycloak logical database creation failed after temporary SET cleanup'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'Keycloak logical database creation failed after temporary SET cleanup';
  END $f26$;
\endif

SELECT
  rolname,
  rolcanlogin,
  rolsuper,
  rolinherit,
  rolcreatedb,
  rolcreaterole,
  rolreplication,
  rolbypassrls
FROM pg_catalog.pg_roles
WHERE rolname = :'keycloak_runtime_role';

SELECT
  datname,
  pg_catalog.pg_get_userbyid(datdba) AS owner
FROM pg_catalog.pg_database
WHERE datname = :'keycloak_database';
