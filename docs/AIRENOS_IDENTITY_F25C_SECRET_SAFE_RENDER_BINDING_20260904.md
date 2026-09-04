# AIRenOS Identity F2.5C — Secret-Safe Render Binding Readiness

Date: 2026-09-04  
State: STATIC READINESS / DO NOT SYNC YET  
Environment: Render Frankfurt, non-production only

## 1. Purpose

This packet prepares the dedicated AIRenOS Identity PostgreSQL boundary and the Render-native secret binding path without copying, logging, committing, indexing, or transmitting any database password or full connection string through GitHub, Google Drive, Base44, chat, or CI logs.

The dedicated provider resource already exists as `airenos-identity-f25-staging-db`. RISTOAIREN / Booking databases are protected and MUST NOT be reused, mutated, deleted, or repurposed by this gate.

## 2. Locked invariants

- Render is infrastructure, not AIRenOS authority.
- Identity, ProductAccess, Entitlement, Billing, Tenant and Business authority remain AIRenOS-owned.
- This database contains only the minimum Identity / authentication / session boundary required by the Session Authority proof.
- Tenant, Location, Billing, Audit, Events and product-owned schemas are not duplicated into the dedicated Identity database.
- Runtime credentials MUST remain provider-managed and MUST NOT appear in Git, Drive, Base44, chat or CI logs.
- Production is FALSE.
- Blueprint sync/deploy is forbidden until the runtime principal proof below is PASS.
- No later F2.4/F2.5 proof may be promoted from partial evidence.

## 3. Static artifacts

- `db/identity/0001_identity_session_authority_boundary.sql`
  - creates only `identity`, `authz`, `security`;
  - creates the `airen_auth` NOLOGIN group role with no superuser, create-role, create-db or bypass-RLS authority;
  - creates the minimum Identity/provider-link/platform-role/session tables;
  - exposes the Session Authority database behavior only through narrow SECURITY DEFINER functions;
  - records schema marker `F2.5C-0001`.
- `db/identity/0002_bind_runtime_principal.sql`
  - accepts only a role name, never a password;
  - rejects a runtime principal that is SUPERUSER, BYPASSRLS, CREATEROLE or CREATEDB;
  - rejects a runtime principal that owns protected Identity/Authz/Security objects;
  - grants and verifies membership in `airen_auth` only after all checks pass.
- `render.identity.f25.yaml`
  - uses Render `fromDatabase` / `connectionString` so the DB URL is resolved inside Render;
  - defines no database resource and cannot recreate the existing Identity DB;
  - references no RISTOAIREN/Booking DB;
  - has `autoDeployTrigger: off` and MUST remain unsynced until the provider runtime role proof passes.

## 4. Provider-safe apply sequence

The following is the only approved sequence for the next live provider step.

1. Open the dedicated database `airenos-identity-f25-staging-db` in the Render dashboard.
2. Establish an authenticated PostgreSQL bootstrap-owner session using Render's own secure connection flow. Do not paste the password or full URL into chat, Git, Drive or any document.
3. Keep that bootstrap-owner session open and execute `db/identity/0001_identity_session_authority_boundary.sql` with `ON_ERROR_STOP=1`.
4. Confirm that the bootstrap completed without error. Do not call the gate PASS from absence of errors alone.
5. In the Render database credential controls, create a new Render-managed default credential with username `airenos_identity_runtime`. The password remains generated/held by Render; do not copy it into AIRenOS governance artifacts.
6. While the bootstrap-owner session remains open, execute:
   - `\set runtime_role airenos_identity_runtime`
   - `\i db/identity/0002_bind_runtime_principal.sql`
7. The binding script MUST print its PASS line. Any failure is terminal for this attempt: do not weaken the checks and do not use the new credential as Session Authority runtime.
8. Independently verify, through SQL/readiness evidence, that `airenos_identity_runtime` is LOGIN=true, SUPERUSER=false, BYPASSRLS=false, CREATEROLE=false, CREATEDB=false, owns zero protected Identity/Authz/Security objects, and is a member of `airen_auth`.
9. Only after steps 1-8 PASS may `render.identity.f25.yaml` be synchronized. At that point `SESSION_AUTHORITY_DATABASE_URL` is resolved by Render from `airenos-identity-f25-staging-db` using `property: connectionString`; no credential value is copied by the operator.
10. After service creation, the live Session Authority readiness check must independently prove the database runtime boundary before any OIDC/session proof is promoted.

## 5. Stop conditions

Fail closed and stop before Blueprint sync if any of the following occurs:

- a credential must be pasted into chat, Git or Drive;
- the proposed runtime user is superuser, bypass-RLS, create-role or create-db capable;
- the proposed runtime user owns protected objects;
- schema bootstrap introduces Tenant, Location, Billing, Audit, Events or product schemas;
- the dedicated database cannot be distinguished from RISTOAIREN/Booking;
- applying the next step would exceed the user-authorized staging budget ceiling;
- production or an irreversible boundary is reached;
- Render behavior differs materially from the verified contract.

## 6. Non-claims

At this checkpoint:

- dedicated Identity PostgreSQL resource = CREATED / AVAILABLE;
- dedicated Identity schema live apply = NOT YET EXECUTED;
- Render-managed least-privilege runtime credential = NOT YET CREATED / NOT PROVEN;
- Blueprint sync = NOT EXECUTED;
- Session Authority F2.5 service = NOT CREATED;
- Keycloak staging = NOT CREATED;
- real Ed25519 private key = NOT CREATED;
- live public JWK = NOT CREATED;
- OIDC Authorization Code + PKCE S256 = NOT PROVEN;
- AIRenOS Session = NOT PROVEN;
- RA-01 real E2E = NOT PROVEN;
- production = FALSE.

## 7. Promotion rule

F2.5C can become provider-applied PASS only after remote provider read-back proves both the dedicated schema and the least-privilege runtime principal. Static CI success alone certifies readiness only; it does not certify live provider application.
