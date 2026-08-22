\set ON_ERROR_STOP on
DROP ROLE IF EXISTS airen_runtime_ci;
CREATE ROLE airen_runtime_ci LOGIN PASSWORD :'runtime_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
GRANT airen_app, airen_auth TO airen_runtime_ci;
