-- AIRenOS Identity F2.5E — bind and certify an unmanaged least-privilege runtime login.
-- Render-managed database credentials are administrative rotation credentials and MUST NOT
-- be used as the Session Authority application runtime.
-- psql-only operator contract. No password or connection string is accepted by this file.
-- Required variables:
--   \set runtime_role airenos_identity_runtime_f25e
--   \set provider_owner_role airenos_identity_f25_staging_db_user

\if :{?runtime_role}
\else
  \echo 'F2.5E FAIL: psql variable runtime_role is required'
  \quit 3
\endif

\if :{?provider_owner_role}
\else
  \echo 'F2.5E FAIL: psql variable provider_owner_role is required'
  \quit 4
\endif

BEGIN;

SELECT (
  :'runtime_role' <> :'provider_owner_role'
  AND :'runtime_role' <> 'airen_auth'
  AND EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = :'provider_owner_role'
  )
  AND EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = :'runtime_role'
      AND rolcanlogin
      AND NOT rolsuper
      AND NOT rolbypassrls
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolinherit
      AND NOT rolreplication
  )
) AS f25e_runtime_attributes_ok \gset

\if :f25e_runtime_attributes_ok
\else
  \echo 'F2.5E FAIL: runtime role identity or attributes are unsafe'
  \quit 5
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_roles r ON r.oid = c.relowner
  WHERE r.rolname = :'runtime_role'
    AND n.nspname IN ('identity','authz','security')
) AS f25e_runtime_not_object_owner \gset

\if :f25e_runtime_not_object_owner
\else
  \echo 'F2.5E FAIL: runtime role owns protected Identity objects'
  \quit 6
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_auth_members m
  JOIN pg_roles member_role ON member_role.oid = m.member
  JOIN pg_roles granted_role ON granted_role.oid = m.roleid
  WHERE member_role.rolname = :'runtime_role'
    AND granted_role.rolname <> 'airen_auth'
) AS f25e_no_foreign_memberships \gset

\if :f25e_no_foreign_memberships
\else
  \echo 'F2.5E FAIL: runtime role has provider-owner, predefined, or other foreign membership'
  \quit 7
\endif

SELECT NOT EXISTS (
  SELECT 1
  FROM pg_db_role_setting s
  JOIN pg_roles r ON r.oid = s.setrole
  CROSS JOIN LATERAL unnest(s.setconfig) AS config(value)
  WHERE r.rolname = :'runtime_role'
    AND config.value LIKE 'role=%'
) AS f25e_no_startup_role_override \gset

\if :f25e_no_startup_role_override
\else
  \echo 'F2.5E FAIL: runtime role has a startup role override'
  \quit 8
\endif

SELECT (
  NOT has_database_privilege(:'runtime_role', current_database(), 'CREATE')
  AND NOT has_schema_privilege(:'runtime_role', 'identity', 'CREATE')
  AND NOT has_schema_privilege(:'runtime_role', 'authz', 'CREATE')
  AND NOT has_schema_privilege(:'runtime_role', 'security', 'CREATE')
) AS f25e_no_inherited_owner_authority \gset

\if :f25e_no_inherited_owner_authority
\else
  \echo 'F2.5E FAIL: runtime role retains inherited owner authority'
  \quit 9
\endif

SELECT format(
  'GRANT airen_auth TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE',
  :'runtime_role'
) \gexec

SELECT EXISTS (
  SELECT 1
  FROM pg_auth_members m
  JOIN pg_roles member_role ON member_role.oid = m.member
  JOIN pg_roles granted_role ON granted_role.oid = m.roleid
  WHERE member_role.rolname = :'runtime_role'
    AND granted_role.rolname = 'airen_auth'
    AND NOT m.admin_option
    AND NOT m.inherit_option
    AND m.set_option
) AS f25e_airen_auth_membership_ok \gset

\if :f25e_airen_auth_membership_ok
\else
  \echo 'F2.5E FAIL: airen_auth membership options are unsafe'
  \quit 10
\endif

INSERT INTO security.identity_schema_migrations(version)
VALUES ('F2.5E-0003')
ON CONFLICT (version) DO NOTHING;

COMMIT;

\echo 'F2.5E PASS: runtime effective authority is isolated from Render provider-owner roles'
