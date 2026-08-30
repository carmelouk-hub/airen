# AIRenOS Identity & Session Authority — Foundation F0

Status: `IMPLEMENTED_CONTRACT / LOCAL_TEST_PASS / LIVE_IDP_NOT_YET_PROVEN`

## 1. Purpose

AIRenOS Identity & Session Authority is a platform-level authority shared by Kairos and future AIRenOS verticals. It is not a Kairos-specific authentication subsystem and it does not treat Base44 authentication as AIRenOS authority.

The existing foundation already provides a provider-neutral authentication adapter, provider-subject to AIRenOS Identity resolution, signed-session verification, tenant routing, membership/RBAC resolution and entitlement resolution. F0 preserves those boundaries and adds the missing internal session-authority contract.

## 2. Normative protocol baseline

For the browser-facing identity integration, the normative baseline is:

- OpenID Connect Core 1.0 incorporating errata set 2;
- OAuth 2.0 Security Best Current Practice, RFC 9700;
- Authorization Code flow with PKCE using `S256` for public browser clients;
- exact redirect URI matching, issuer validation, audience validation, anti-CSRF transaction binding and provider key rotation.

OAuth 2.1 is not used as a normative dependency while it remains an IETF Internet-Draft.

## 3. Frozen trust boundary

1. An upstream IdP credential/assertion MUST be cryptographically verified before AIRenOS session establishment.
2. The verified upstream `(provider issuer/key, provider subject)` MUST resolve to an active AIRenOS Identity before any AIRenOS session is minted.
3. AIRenOS session access tokens MUST be signed by AIRenOS-controlled signing material. Private signing material MUST remain server-side and secret-provider managed.
4. The AIRenOS access-token subject is the AIRenOS `identityId`, not a tenant, role, email address or Base44 user identifier.
5. AIRenOS access tokens MUST NOT carry authoritative tenant membership, tenant role, platform role, location role or entitlement claims. Those are resolved server-side from canonical AIRenOS stores on every governed request.
6. Consumers MUST verify signature, exact issuer, exact audience, key id, token type, issue/expiry window and maximum TTL before resolving the principal.
7. Browser presentation clients MUST NOT persist AIRenOS bearer credentials in localStorage, sessionStorage, Base44 entities, URLs or logs.
8. Base44 login/token MUST NOT be accepted as AIRenOS authentication evidence.
9. A contract/unit test using generated keys or test doubles is never evidence of a real IdP login, browser handoff or live staging E2E.
10. Authorization remains backend-enforced after authentication. Authentication alone never grants tenant or platform authority.

## 4. F0 token contract

Header:

- `alg = EdDSA`
- `typ = at+jwt`
- `kid = active AIRenOS signing key id`

Claims:

- `iss` — exact HTTPS AIRenOS session issuer;
- `aud` — exact target service audience;
- `sub` — AIRenOS Identity UUID;
- `sid` — AIRenOS session identifier;
- `iat` — issued-at epoch seconds;
- `exp` — expiry epoch seconds.

F0 constrains access-token TTL to at most 300 seconds. Tenant, role and entitlement claims are deliberately absent.

## 5. F0 implementation

F0 adds:

- `packages/identity/src/session-authority.ts`
  - upstream-verifier boundary;
  - provider subject -> active AIRenOS Identity gate;
  - AIRenOS session issuer boundary;
  - internal AIRenOS-session authentication adapter that reloads identity state and platform roles server-side.
- `packages/integrations/src/airenos-session-ed25519.ts`
  - Ed25519 AIRenOS access-token issuer;
  - Ed25519 AIRenOS access-token verifier;
  - canonical Base64URL enforcement;
  - clean HTTPS issuer enforcement;
  - exact audience enforcement;
  - `at+jwt` token-type enforcement;
  - enabled-key and Ed25519-key enforcement;
  - maximum-TTL and clock-window enforcement.
- `tests/integration/airenos-identity-session-authority.test.ts`
  - fail-closed no-upstream-verification case;
  - provider subject -> AIRenOS Identity mapping before mint;
  - absence of tenant/role authority claims in bearer token;
  - server-side role reload;
  - wrong-audience, disabled-key and suspended-identity denial;
  - HTTPS issuer configuration denial.

## 6. Explicit non-claims

F0 does NOT claim or certify:

- a selected production/staging IdP;
- a live OIDC Authorization Code + PKCE browser login;
- an AIRenOS session lifecycle/revocation persistence layer;
- a JWKS/discovery HTTP endpoint;
- browser handoff completion;
- Base44 -> AIRenOS -> Kairos provider-verified E2E;
- K4-C3 closure.

No provider or browser identity is simulated for governance closure.

## 7. Next gates

- `ISA_F0_TRUST_CRYPTO_CONTRACT = IMPLEMENTED / TESTED`
- `ISA_F1_SESSION_LIFECYCLE_REVOCATION = OPEN`
- `ISA_F2_REAL_UPSTREAM_OIDC_PROVIDER_ADAPTER = OPEN`
- `ISA_F3_BROWSER_AUTHORIZATION_HANDOFF = OPEN`
- `ISA_F4_STAGING_PROVIDER_VERIFIED_E2E = OPEN`

K4-C3 remains `OPEN / REAL SESSION PROOF PENDING` until ISA_F4 produces real provider-verified browser evidence.
