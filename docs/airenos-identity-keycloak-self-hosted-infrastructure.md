# AIRenOS Identity Infrastructure — Self-Hosted Keycloak Authentication Engine

Date: 2026-08-31
Gate: AIRenOS Identity & Session Authority / F2 Keycloak infrastructure contract
Status: implementation/deployability contract; live provider binding remains open.

## Decision

AIRenOS adopts self-hosted Keycloak as the primary upstream authentication engine while preserving AIRenOS as the sole canonical identity, session and authorization authority.

This decision follows the same architectural principle used for AIRenPay: AIRenOS owns the domain contract and authority, while a replaceable provider-specific engine sits behind a stable adapter boundary.

Keycloak is therefore infrastructure, not business authority.

## Existing foundation preserved

- F0 remains the AIRenOS trust and Ed25519 session-token authority.
- F1 remains the canonical AIRenOS session lifecycle and immediate revocation authority.
- F2 remains provider-neutral and verifies OIDC Authorization Code + PKCE, discovery, issuer, JWKS and ID-token claims before exposing a provider subject.
- The canonical AIRenOS Identity directory resolves the verified Keycloak subject to an active AIRenOS Identity.
- Tenant, location, role, permission, membership and entitlement resolution remains server-side in AIRenOS.

No Keycloak role/group/organization claim may bypass those stores.

## Why self-hosted Keycloak

The architecture requires operational independence without reimplementing authentication protocols, password/passkey flows, MFA, recovery and identity federation. Self-hosted Keycloak provides a mature OIDC/SAML authentication engine while allowing AIRenOS to own deployment, data location, upgrade cadence, backups and the integration boundary.

The engine is replaceable because the F2 adapter consumes standard OIDC rather than Keycloak-specific authority claims.

## Version and supply-chain contract

The initial governed image is pinned to Keycloak `26.7.2` from `quay.io/keycloak/keycloak`. Floating versions are forbidden. Promotion must later record the exact OCI digest in deployment evidence.

The image is pre-built using `kc.sh build` with PostgreSQL, health and metrics enabled, then runs `start --optimized`. Development mode is forbidden outside explicitly isolated developer use and is never a staging/production certification path.

## Network and hostname model

Desired public issuer target:

`https://login.airenos.com/realms/airenos`

Desired restricted administration target:

`https://identity-admin.airenos.com`

Desired AIRenOS OIDC callback target:

`https://session.airenos.com/oidc/callback`

Public and administration surfaces must remain separated. The public login boundary must not imply public exposure of the Admin REST API/UI. Exact hostname and redirect-URI verification are mandatory.

These names are design targets. Their DNS, TLS and live reachability are not certified by this gate.

## Data boundary

Keycloak uses its own dedicated PostgreSQL database. It must never reuse the AIRenOS canonical application database or an AIRenOS runtime principal.

Keycloak database content is authentication-engine state. AIRenOS canonical Identity links, tenant memberships, roles, permissions, entitlements and AIRenOS session lifecycle remain in AIRenOS-controlled schemas/stores.

Production requires database HA appropriate to the hosting environment, encrypted backups, PITR where supported and recurring restore verification.

## Availability baseline

The first production-shaped baseline is single-region multi-AZ with at least two Keycloak replicas behind a trusted load balancer/reverse proxy and a resilient dedicated PostgreSQL layer.

Multi-region active/active is intentionally deferred. Experimental/preview multi-cluster features must not become a certification dependency.

## Realm/client authority contract

Realm: `airenos`

Browser client: `airenos-browser-session`

Required controls:

- public client;
- Authorization Code flow enabled;
- PKCE `S256` required;
- implicit flow disabled;
- direct access/password grants disabled;
- browser service account disabled;
- exact callback URI;
- wildcard redirect URIs and wildcard web origins forbidden.

The upstream Keycloak access token is never an AIRenOS access token. AIRenOS mints its own bounded Ed25519 bearer only after F2 verification and canonical Identity resolution.

## Secret boundary

No database password, bootstrap administrator password, client secret, signing key or TLS private key is committed to GitHub, stored in Base44, embedded into image layers or written to governance documents.

Production secret delivery remains a deployment concern behind the existing AIRenOS secret-provider principles. A browser/public OIDC client does not require a browser-held client secret.

## Observability and audit

Keycloak health and metrics are enabled in the optimized build. Authentication-engine events may be forwarded to the AIRenOS observability/security plane, but they do not replace canonical AIRenOS audit events for authorization and governed business actions.

## Current non-claim

This gate does not assert that Keycloak has been deployed or that any real account has authenticated. It does not close F2 real-provider binding, F3 browser handoff, F4 staging E2E or K4-C3.

Closure of real-provider binding requires a governed live deployment with provider read-back proving:

1. reachable HTTPS issuer and discovery document;
2. live realm `airenos`;
3. live public client registration with exact PKCE/redirect controls;
4. real authorization transaction against a real account;
5. real code exchange and ID-token verification through the F2 adapter;
6. canonical provider-subject -> AIRenOS Identity resolution;
7. AIRenOS F0/F1 session issuance and active-session proof;
8. no provider/Base44 authority leakage into tenant/role/entitlement decisions.
