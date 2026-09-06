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

SELECT format(
  'ALTER ROLE %I WITH LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
  :'keycloak_runtime_role',
  :'keycloak_runtime_password'
) \gexec

SELECT format(
  'CREATE DATABASE %I OWNER %I',
  :'keycloak_database',
  :'keycloak_runtime_role'
)
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_database WHERE datname = :'keycloak_database'
) \gexec

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
