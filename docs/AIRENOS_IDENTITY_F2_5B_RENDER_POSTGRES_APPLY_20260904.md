# AIRenOS Identity — F2.5B Render PostgreSQL Apply Checkpoint

Date: 2026-09-04
Governance: RULE-DOC-20 + RULE-DOC-21
Environment: staging / non-production

## Authority and scope

This checkpoint records the first paid provider resource created under the explicit user-approved AIRenOS Identity Render staging budget cap of USD 45/month. It does not authorize production, changes to existing RISTOAIREN/Booking/Pay resources, or costs beyond the approved cap.

## Provider resource

- Provider: Render
- Workspace: AIRENOS
- Region: Frankfurt
- Resource type: dedicated managed PostgreSQL
- Resource name: `airenos-identity-f25-staging-db`
- Provider resource ID: `dpg-dadcplv10e5c73ebujk0-a`
- Database name: `airenos_identity_f25_staging_db`
- Plan: `basic_256mb`
- PostgreSQL version: 17
- Disk: 1 GB
- Provider read-back status: `available`
- IP allow list: empty at provider read-back

No database password, connection URI, private key, token, provider credential, or other secret is recorded in this file.

## Isolation proof

The pre-existing RISTOAIREN database remains a different provider resource (`ristoairen-rbl01c2-db`, ID `dpg-da87bdad0e5s739slf20-a`). It was not deleted, mutated, reused, repurposed, or migrated for AIRenOS Identity.

## Schema / runtime-role status

`db/migrations/0035_airenos_session_lifecycle.sql` was inspected before any schema apply. It is not standalone: it references pre-existing `identity.identities`, `authz.platform_role_assignments`, `security` schema, and the `airen_auth` / `airen_app` roles. Therefore it MUST NOT be applied in isolation to the new dedicated Identity database.

No schema migration and no database role mutation was executed at this checkpoint.

## Connectivity observation

A provider connector read-only query attempt returned a TLS-required connection error. The attempt performed no SQL mutation and exposed no credential in governance artifacts. This is classified as a connector-path limitation, not as evidence that the database resource is unavailable, because the independent provider resource read-back reports `available`.

Credentials MUST NOT be copied into chat, Git, Drive, Base44, CI logs, or other unapproved boundaries merely to bypass this connector limitation.

## Terminal state

- `F2_5B_DEDICATED_IDENTITY_POSTGRES = CREATED_AVAILABLE`
- `IDENTITY_DB_ISOLATED_FROM_RISTOAIREN = TRUE`
- `SCHEMA_MIGRATIONS = NOT_EXECUTED`
- `LEAST_PRIVILEGE_RUNTIME_ROLE = NOT_EXECUTED`
- `KEYCLOAK_STAGING = NOT_CREATED`
- `OIDC_PKCE = NOT_PROVEN`
- `SESSION_AUTHORITY_LIVE = NOT_CREATED`
- `PRODUCTION = FALSE`

Next step is limited to establishing a provider-internal secret-safe database bootstrap path and determining the exact minimal Identity schema/role dependency set before any SQL mutation. Fail closed if that cannot be done without exposing credentials or broadening the database scope.