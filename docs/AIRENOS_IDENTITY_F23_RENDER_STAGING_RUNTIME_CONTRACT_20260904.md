# AIRenOS Identity F2.3 — Render Staging Runtime Contract

Date: 2026-09-04  
Gate: `ISA_F2_3_RENDER_STAGING_RUNTIME`  
Parent: `d8346b151fb4cc3f6c5e91fee04c271e8d7eff76`  
Status: `STATIC_RENDER_STAGING_RUNTIME_IMPLEMENTED / LIVE_DEPLOY_NOT_EXECUTED`

## Purpose

F2.3 makes the already-governed AIRenOS Identity & Session Authority executable as a real HTTP staging service without transferring any Identity, ProductAccess, Entitlement, tenant or business authority to Render.

Render is introduced only as a temporary non-production execution-proof host. The canonical F2.2 infrastructure target remains OVHcloud Public Cloud Milan. This checkpoint does not replace or silently promote Render as the canonical Identity infrastructure provider.

## Runtime composition

The F2.3 adapter reuses the certified components rather than reimplementing authority logic:

- `OidcAuthorizationCodeUpstreamVerifier` for real Authorization Code + PKCE S256 verification;
- `PostgresAuthenticationIdentityDirectory` for provider-subject → active AIRenOS Identity resolution;
- `Ed25519AirenOSSessionIssuer` for EdDSA `at+jwt` AIRenOS sessions;
- `PersistentAirenOSSessionIssuer` and `PostgresAirenOSSessionLifecycleStore` for durable session registration and later revocation-aware verification;
- the F2.1 signing-key bootstrap utility for exclusive Ed25519 key creation outside the repository/worktree.

F2.3 adds transport and deployment wiring only. It does not create a second authentication authority.

## HTTP surface

The staging service exposes only:

- `GET /health/live`;
- `GET /health/ready`;
- `GET /v1/oidc/config`;
- `GET /v1/session/public-keyring`;
- `POST /v1/session/exchange`.

The exchange request is the canonical OIDC credential tuple `{ code, codeVerifier, expectedNonce }`. Request bodies are bounded to 16 KiB. Exchange requires the exact configured HTTPS browser Origin and, in the Render contract, `x-forwarded-proto=https`. CORS never uses a wildcard. Responses are `no-store`.

No Base44 token, cookie or Base44 user assertion becomes an AIRenOS credential.

## Signing-key boundary

The Render contract mounts a persistent disk at `/var/data/airenos-session`. The private PKCS#8 Ed25519 key and public JWK keyring are separate mode-0600 regular files outside `/app` and outside the Git worktree.

At service start:

1. if both files exist, they are validated and reused;
2. if exactly one exists, startup fails closed;
3. if neither exists and explicit staging bootstrap is enabled, the existing F2.1 bootstrap creates both exclusively on the provider disk;
4. the private key is parsed only in process memory and is never written to stdout/stderr;
5. the active public JWK is cryptographically checked against the private key before the server starts.

CI does not execute this live bootstrap against Render and does not create staging private material.

## Database boundary

F2.3 intentionally does **not** create a new PostgreSQL database in `render.identity.f23.yaml`.

A real Identity → Foundation/RA-01 proof requires coherent Identity and session-lifecycle persistence. The service therefore requires an externally governed database SecretRef. Concrete database topology, migration/admin principal, cost and sharing with Foundation remain part of the provider-apply review rather than being guessed by this static contract.

The runtime database principal must be non-superuser, non-BYPASSRLS and able to assume only the already-governed `airen_auth` boundary required by Identity/session lifecycle operations.

## Render boundary

The Blueprint declares one staging web service only:

`airenos-session-authority-f23-staging`

It does not name, mutate, depend on, suspend or replace the existing Render Booking resources. It does not create production resources. A persistent disk requires a paid Render service, so applying this Blueprint is a later billable-provider action and is **not executed by F2.3 static implementation**.

## Non-claims

This checkpoint is not evidence that:

- a Render F2.3 service exists;
- a billable Render resource was created;
- a real staging private signing key exists;
- Keycloak staging is deployed;
- a real OIDC Authorization Code exchange succeeded;
- a real AIRenOS browser session was issued;
- Foundation has consumed the effective public keyring;
- RA-01 has verified a real AIRenOS session;
- RISTOAIREN Experience is attached;
- production is enabled.

All remain false/not proven until independent provider read-back and governed E2E evidence exist.

## Next gate

After the F2.3 commit and dedicated CI are green, the next decision is a provider cost/topology review. Only then may a separately governed Render apply be considered. Any actual provider write requires RULE-DOC-21 pre-check, explicit staging-only scope, cost visibility and post-write provider/GitHub/Drive reconciliation.
