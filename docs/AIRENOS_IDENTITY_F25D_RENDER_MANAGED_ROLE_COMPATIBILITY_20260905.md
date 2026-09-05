# AIRenOS Identity F2.5D — Render-Managed Role Compatibility Correction

Date: 2026-09-05  
State: CORRECTIVE STATIC READINESS / LIVE APPLY PENDING  
Environment: Render Frankfurt, non-production only

## 1. Why F2.5D exists

The first real F2.5C schema apply against the dedicated Render PostgreSQL reached the `airen_auth` group-role creation and then failed at the unconditional `ALTER ROLE ... NOSUPERUSER ... NOBYPASSRLS` statement.

Render correctly exposes a managed bootstrap principal that can create the required group role but is not a PostgreSQL superuser. PostgreSQL therefore rejects attempts by that principal to change the SUPERUSER attribute, even when the requested value is the safe `NOSUPERUSER` value.

The F2.5C transaction had started with `BEGIN` and had not reached `COMMIT`. The operator executed `ROLLBACK`; independent read-back then proved zero `identity`/`authz`/`security` schemas and zero `airen_auth` roles remained. No partial schema state was promoted.

## 2. Preserved history

F2.5C remains preserved at commit `5e7ee2b3fadd30acbacac37ba42149a161ee0ea9`. Its static CI was valid for the environment it modeled, but that CI used the local PostgreSQL `postgres` superuser as bootstrap owner and therefore did not model Render's managed non-superuser bootstrap constraint.

F2.5D is append-only and does not rewrite that evidence.

## 3. Security-preserving correction

`db/identity/0001_identity_session_authority_boundary.sql` still creates `airen_auth` as:

- NOLOGIN;
- NOSUPERUSER;
- NOCREATEDB;
- NOCREATEROLE;
- NOINHERIT;
- NOBYPASSRLS.

The incompatible privileged mutation is removed. It is replaced by a fail-closed read-back of `pg_roles`. Bootstrap aborts unless `airen_auth` is non-login, non-superuser, non-create-db, non-create-role, non-inheriting, non-bypass-RLS and non-replication.

This does not weaken the role boundary. It changes enforcement from a provider-incompatible privileged mutation to provider-neutral creation plus explicit verification.

The corrected migration records `F2.5D-0001`.

## 4. Regression proof added

The dedicated F2.5 CI now creates a Render-like bootstrap fixture that is explicitly:

- LOGIN;
- NOSUPERUSER;
- NOCREATEDB;
- CREATEROLE;
- NOINHERIT;
- NOBYPASSRLS;
- granted CREATE only on the dedicated CI database.

The corrected `0001` must execute successfully as that non-superuser principal. The runtime credential is then created and bound through the unchanged `0002_bind_runtime_principal.sql`, and the existing least-privilege runtime behavior proof remains mandatory.

## 5. Blueprint safety

`render.identity.f25.yaml` points to the F2.5D corrective branch. It remains unsynced and retains `autoDeployTrigger: off` plus provider-side `fromDatabase.connectionString` binding. No credential or connection string is embedded in Git.

## 6. Live re-apply rule

F2.5D may be applied to the dedicated Identity staging database only after its exact GitHub commit passes the dedicated CI and a fresh RULE-DOC-21 dual-source reconciliation succeeds.

The operator must extract the SQL from that exact passing commit. No locally hand-edited SQL is an authorized apply artifact.

After live apply, provider/database read-back must prove the `F2.5D-0001` marker and the safe `airen_auth` role attributes before the Render-managed runtime credential is created.

## 7. Non-claims

At this checkpoint:

- dedicated Identity PostgreSQL = CREATED / AVAILABLE;
- failed F2.5C live attempt = ROLLED BACK / CLEAN READ-BACK;
- F2.5D corrected live schema apply = NOT YET EXECUTED;
- Render-managed runtime credential = NOT YET CREATED / NOT PROVEN;
- Blueprint sync = NOT EXECUTED;
- Session Authority service = NOT CREATED;
- Keycloak staging = NOT CREATED;
- OIDC Authorization Code + PKCE S256 = NOT PROVEN;
- AIRenOS Session = NOT PROVEN;
- production = FALSE.
