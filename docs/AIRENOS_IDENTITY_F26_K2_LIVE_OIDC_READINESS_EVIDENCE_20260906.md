# AIRenOS Identity F2.6-K2 — Live Realm / OIDC Client / OIDC Readiness Evidence

Date: 2026-09-06
Environment: Render Frankfurt staging only
Gate: `F2_6_K2`
Canonical classification: `CLOSED / PASS`

## Human authorization

Authorized scope: configure only the AIRenOS realm and the public OIDC client on the already-existing Keycloak staging service, prove issuer/discovery/JWKS/Authorization Code + PKCE readiness, and preserve all later boundaries. No Session Authority, Base44, DNS or production was authorized.

## Canonical source/provider state before evidence registration

- working/evidence base HEAD: `6aa6d464b5f6775123c46dabeafa32756fc5f236`
- tree: `3c68f70c06d155c260a31b2ca6100ccf431ed0d4`
- deployed runtime source: `072a13f5532733cc52a20b5646938dd57f7c79e2`
- R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- main: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- RBL: `d055fba86d938aa38cee648171425046c7d972a4`
- K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`
- PR #4: OPEN / DRAFT / UNMERGED
- Handoff revision after K2 registration: `54`
- Platform Bible revision after K2 registration: `115`

Render service preserved:

- service: `airenos-keycloak-f26-staging`
- service ID: `srv-daerht9t0dsc73bfrisg`
- deploy: `dep-daerm7uq1p3s73ak5hl0`
- deploy status: `live`
- runtime: Docker
- plan: Standard
- region: Frankfurt
- instances: 1
- auto deploy: off
- health path: `/health/ready`

Identity Postgres preserved:

- resource: `dpg-dadcplv10e5c73ebujk0-a`
- status: available
- plan: `basic_256mb`
- region: Frankfurt
- storage: 1 GB
- current provider default user: `airenos_identity_provider_admin_f26r2`
- bootstrap allowlist unchanged

## Authorized live Keycloak delta

Created inside the existing Keycloak staging database only:

- realm `airenos`, enabled;
- exactly one public OIDC client `airenos-browser-session`;
- standard Authorization Code flow enabled;
- PKCE S256 required;
- implicit flow disabled;
- direct access grants disabled;
- service accounts disabled;
- exact redirect URI `https://session.airenos.com/oidc/callback`;
- no wildcard redirect URI;
- no wildcard web origin;
- no browser client secret.

No test user, real user, custom AIRenOS authority realm role, group, authentication flow or authority mapper was created.

## OIDC readiness evidence

Desktop live HTTPS/Admin evidence, returned secret-safe and reconciled by canonical chat:

- realm absent before K2 and present/enabled after K2;
- client absent before K2 and exactly one matching client after K2;
- OIDC Discovery HTTP PASS;
- staging issuer exact: `https://airenos-keycloak-f26-staging.onrender.com/realms/airenos`;
- Authorization Code response type advertised;
- PKCE S256 advertised;
- an AIRenOS-allowed ID-token signing algorithm advertised;
- JWKS HTTP PASS;
- JWKS contained 2 keys and a usable RSA/RS256 signing key;
- live Authorization Code request with exact callback and PKCE S256 accepted;
- state binding observed;
- negative PKCE enforcement PASS.

Independent canonical provider corroboration: Render Keycloak application logs contain a live event with `realmName="airenos"`, `clientId="airenos-browser-session"`, exact redirect URI `https://session.airenos.com/oidc/callback`, `response_type="code"`, and fail-closed `invalid_request` with reason `Missing parameter: code_challenge_method` for the negative PKCE request. This independently proves that the live provider recognizes the realm/client/callback and enforces PKCE rather than silently accepting a non-S256-equivalent request.

Canonical chat could not independently fetch the Discovery/JWKS response bodies through its web runtime. Those response-body proofs therefore remain Desktop live HTTPS evidence reconciled against live Render service/log state, not a second independent HTTP execution.

## Database and secret-safety evidence

Desktop read-only `deploy/keycloak/verify-render-logical-database.sql` evidence:

- canonical PASS message observed;
- `airenos_keycloak_runtime_f26` remains safe;
- Identity-owned object count remains 0;
- Keycloak logical database owner remains `airenos_keycloak_runtime_f26`.

The canonical Render SQL connector TLS limitation remains unchanged; therefore the SQL verifier is classified as Desktop live SQL evidence reconciled against canonical Render PostgreSQL metadata.

`SECRET_EXPOSURE = NONE`.

No bootstrap administrator password, Keycloak admin token, database credential, Authorization header, PKCE verifier, private JWK or signing private key was recorded in GitHub, Drive, chat, Base44 or logs by this gate.

## Authority boundary

Keycloak remains a replaceable upstream authentication engine only.

It is NOT canonical authority for AIRenOS Identity, Tenant, Membership, Role, Permission, Entitlement, Billing, Product Access or Session state. Keycloak-issued access tokens are NOT AIRenOS bearers.

## Terminal classification

```text
F2_6_K2 = CLOSED / PASS
REALM_CLIENT_LIVE = PASS
OIDC_DISCOVERY_READINESS = PASS — DESKTOP LIVE EVIDENCE RECONCILED
OIDC_JWKS_READINESS = PASS — DESKTOP LIVE EVIDENCE RECONCILED
AUTH_CODE_PKCE_READINESS = PASS
PKCE_FAIL_CLOSED_ENFORCEMENT = PASS — INDEPENDENT PROVIDER LOG CORROBORATION

REAL_AUTHORIZATION_CODE_ISSUED = NOT_RUN_SCOPE_BLOCKED
REAL_AUTHORIZATION_CODE_EXCHANGE = NOT_RUN_SCOPE_BLOCKED
REAL_ID_TOKEN_SIGNATURE_RUNTIME_PROOF = NOT_RUN_SCOPE_BLOCKED
REAL_BROWSER_LOGIN = NOT_RUN_SCOPE_BLOCKED

CANONICAL_LOGIN_AIRENOS_DNS = NOT_CHANGED
CANONICAL_SESSION_AIRENOS_DNS = NOT_CHANGED
CANONICAL_ADMIN_AIRENOS_DNS = NOT_CHANGED
CANONICAL_ISSUER_TARGET_PROVEN = FALSE

ISA_F2_REAL_UPSTREAM_OIDC_PROVIDER_ADAPTER = OPEN_REAL_EXCHANGE_NOT_PROVEN
K4_C3_RUNTIME_DEPLOY_SESSION_HANDOFF_PROOF = OPEN_NOT_YET_EXECUTED

SESSION_AUTHORITY_CREATED = FALSE
BASE44_CHANGED = FALSE
DNS_CHANGED = FALSE
PRODUCTION = FALSE
```

## Next boundary

Any real subject / real Authorization Code exchange, runtime ID-token verification from that real exchange, Session Authority, canonical DNS activation, browser handoff, Base44 integration or production requires a separate governed authorization. No such later boundary is authorized by F2.6-K2.
