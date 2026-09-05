# AIRenOS Identity F2.5E — Effective Runtime Authority Correction

Date: 2026-09-05  
State: IMPLEMENTATION CANDIDATE / CI PENDING / LIVE APPLY PENDING  
Environment: Render Frankfurt, non-production only

## 1. Trigger

A fresh external TLS connection using the Render default credential named `airenos_identity_runtime` authenticated successfully, but the database did not execute as that role.

Observed secret-free evidence:

- `session_user = airenos_identity_runtime`;
- `current_user = airenos_identity_f25_staging_db_user`;
- startup `role` setting = `airenos_identity_f25_staging_db_user`;
- runtime role attributes: LOGIN, non-superuser, non-bypass-RLS, non-create-role, non-create-db;
- runtime role-level INHERIT = true;
- runtime memberships granted by `postgres`: provider owner, `pg_read_all_stats`, and `pg_signal_backend`, each with INHERIT and SET enabled and ADMIN disabled;
- runtime is also a member of `airen_auth`;
- runtime owns zero protected Identity objects;
- effective provider-owner role owns protected Identity objects and has CREATE DATABASE / CREATE ROLE authority.

The credential therefore passed the F2.5D role-attribute check while retaining and automatically assuming provider-owner authority.

## 2. Root cause

F2.5D `0002_bind_runtime_principal.sql` checked the named login role's direct attributes, protected-object ownership and `airen_auth` membership. It did not check:

- `session_user` versus `current_user` on a new connection;
- role-level INHERIT;
- membership INHERIT / SET options;
- membership in the provider owner or PostgreSQL predefined roles;
- startup `role` overrides in `pg_db_role_setting`;
- effective database and schema CREATE authority.

Render-managed credential rotation creates another credential for the database user. Live read-back proves that this provider-managed credential carries owner and predefined-role memberships granted by the provider superuser. Those grants have no ADMIN option for the tenant-visible roles, so they cannot be safely removed or rewritten by the managed non-superuser bootstrap principal.

## 3. Security decision

Render-managed PostgreSQL credentials are classified as provider administration and rotation credentials, not Session Authority application credentials.

The application runtime must be a separate PostgreSQL login created through the governed bootstrap path with all of the following:

- LOGIN;
- NOSUPERUSER;
- NOBYPASSRLS;
- NOCREATEROLE;
- NOCREATEDB;
- NOINHERIT;
- NOREPLICATION;
- no startup `role` override;
- no provider-owner or predefined-role membership;
- zero ownership in `identity`, `authz`, and `security`;
- exactly one granted role: `airen_auth`, with ADMIN false, INHERIT false, SET true;
- no direct database or protected-schema CREATE authority.

The application explicitly enters `airen_auth` only for the narrow transaction scope already exercised by the Session Authority runtime tests.

## 4. Provider secret binding

`fromDatabase.connectionString` always resolves to Render's current default managed credential and is therefore forbidden for the Session Authority runtime.

The F2.5E Blueprint uses:

- `SECRET_MANAGER_ADAPTER=env`;
- `SESSION_AUTHORITY_DATABASE_URL_SECRET_REF=secret://env/SESSION_AUTHORITY_DATABASE_URL`;
- `SESSION_AUTHORITY_DATABASE_URL` as a Render-managed secret input with `sync: false`.

No connection URL, username/password pair, token or secret is stored in Git.

## 5. F2.5E gate

`db/identity/0003_bind_effective_runtime_authority.sql` is additive over F2.5D and fails closed unless the target runtime login already satisfies the effective-authority boundary. It then grants only `airen_auth` with explicit PostgreSQL 17 membership options and records `F2.5E-0003`.

CI must reproduce the real Render false-positive before proving the corrected unmanaged runtime path.

## 6. Rotation and rollback order

1. Preserve `airenos_identity_bootstrap_f25`.
2. Preserve the currently compromised managed runtime credential until a replacement default credential and the safe unmanaged runtime have both been proven.
3. Create a new Render-managed default rotation credential; do not bind it to the application.
4. Create and bind the unmanaged least-privilege runtime.
5. Prove a new TLS connection end-to-end.
6. Only then delete the compromised old runtime credential.
7. Preserve the new managed default credential as provider administration authority and keep it out of application configuration.

The bootstrap IP allowlist remains unchanged. No production, Blueprint sync, Session Authority service creation, Keycloak staging, PR #4 merge, R3 change or `main` change is authorized by this correction.
