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

-- PostgreSQL 17 grants the creator of a role administrative membership in
-- that role, but SET may remain false. Preserve that administrative control
-- as non-inheriting/non-SET baseline authority; elevate only SET temporarily
-- for CREATE DATABASE ... OWNER and always restore SET false afterward.
SELECT format(
  'GRANT %I TO %I WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
  :'keycloak_runtime_role',
  current_user
) \gexec

SELECT COALESCE((
  SELECT am.admin_option
     AND NOT am.inherit_option
     AND NOT am.set_option
  FROM pg_catalog.pg_auth_members am
  JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
  JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
  WHERE granted_role.rolname = :'keycloak_runtime_role'
    AND member_role.rolname = current_user
), false) AS provider_admin_runtime_control_safe
\gset

\if :provider_admin_runtime_control_safe
\else
  \echo 'provider admin Keycloak runtime control boundary is unsafe'
  DO $f26$ BEGIN
    RAISE EXCEPTION 'provider admin Keycloak runtime control boundary is unsafe';
  END $f26$;
\endif

SELECT format(
  'GRANT %I TO %I WITH ADMIN TRUE, INHERIT FALSE, SET TRUE',
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
  'GRANT %I TO %I WITH ADMIN TRUE, INHERIT FALSE, SET FALSE',
  :'keycloak_runtime_role',
  current_user
) \gexec

SELECT COALESCE((
  SELECT am.admin_option
     AND NOT am.inherit_option
     AND NOT am.set_option
  FROM pg_catalog.pg_auth_members am
  JOIN pg_catalog.pg_roles granted_role ON granted_role.oid = am.roleid
  JOIN pg_catalog.pg_roles member_role ON member_role.oid = am.member
  WHERE granted_role.rolname = :'keycloak_runtime_role'
    AND member_role.rolname = current_user
), false) AS provider_admin_runtime_control_restored
\gset

\if :provider_admin_runtime_control_restored
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
