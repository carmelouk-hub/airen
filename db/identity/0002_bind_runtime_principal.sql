-- AIRenOS Identity F2.5C — bind a provider-managed runtime login to airen_auth.
-- psql-only operator contract. No password or connection string is accepted by this file.
-- Usage from an already authenticated bootstrap-owner psql session:
--   \set runtime_role airenos_identity_runtime
--   \i db/identity/0002_bind_runtime_principal.sql

\if :{?runtime_role}
\else
  \echo 'F2.5C FAIL: psql variable runtime_role is required'
  \quit 3
\endif

SELECT EXISTS (
  SELECT 1
  FROM pg_roles
  WHERE rolname = :'runtime_role'
    AND rolcanlogin
    AND NOT rolsuper
    AND NOT rolbypassrls
    AND NOT rolcreaterole
    AND NOT rolcreatedb
) AS f25_runtime_attributes_ok \gset

\if :f25_runtime_attributes_ok
\else
  \echo 'F2.5C FAIL: runtime role must LOGIN and must not be SUPERUSER/BYPASSRLS/CREATEROLE/CREATEDB'
  \quit 4
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE r.rolname = :'runtime_role'
    AND n.nspname IN ('identity','authz','security')
) AS f25_runtime_not_object_owner \gset

\if :f25_runtime_not_object_owner
\else
  \echo 'F2.5C FAIL: runtime role owns protected Identity objects'
  \quit 5
\endif

SELECT format('GRANT airen_auth TO %I', :'runtime_role') \gexec

SELECT pg_has_role(:'runtime_role', 'airen_auth', 'member') AS f25_runtime_membership_ok \gset

\if :f25_runtime_membership_ok
\else
  \echo 'F2.5C FAIL: runtime role is not a member of airen_auth after binding'
  \quit 6
\endif

\echo 'F2.5C PASS: runtime principal attributes and airen_auth membership verified'
