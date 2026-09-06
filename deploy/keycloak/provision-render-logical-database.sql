\set ON_ERROR_STOP on

\if :{?keycloak_runtime_password}
\else
  \echo 'missing required in-memory keycloak_runtime_password'
  \quit 3
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
  \quit 4
\endif

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOINHERIT PASSWORD %L',
  :'keycloak_runtime_role',
  :'keycloak_runtime_password'
) \gexec

SELECT count(*) = 0 AS provider_admin_runtime_membership_absent
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
WHERE granted_role.rolname = :'keycloak_runtime_role'
  AND member_role.rolname = current_user
\gset

\if :provider_admin_runtime_membership_absent
\else
  \echo 'provider admin already has unexpected Keycloak runtime membership'
  \quit 5
\endif

-- PostgreSQL 17 requires the database creator to be able to SET ROLE to the
-- requested owner. Grant only SET temporarily, never INHERIT or ADMIN, and
-- guarantee cleanup even when CREATE DATABASE itself fails.
SELECT format(
  'GRANT %I TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'keycloak_runtime_role',
  current_user
) \gexec

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

SELECT format(
  'REVOKE %I FROM %I',
  :'keycloak_runtime_role',
  current_user
) \gexec

SELECT count(*) = 0 AS provider_admin_runtime_membership_removed
FROM pg_catalog.pg_auth_members am
JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
WHERE granted_role.rolname = :'keycloak_runtime_role'
  AND member_role.rolname = current_user
\gset

\if :provider_admin_runtime_membership_removed
\else
  \echo 'temporary Keycloak runtime SET membership cleanup failed'
  \quit 6
\endif

SELECT :'keycloak_database_create_sqlstate' = '00000' AS keycloak_database_create_ok \gset
\if :keycloak_database_create_ok
\else
  \echo 'Keycloak logical database creation failed after temporary membership cleanup'
  \quit 7
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
