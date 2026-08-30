# AIRenOS Identity & Session Authority — F1 Session Lifecycle & Revocation

Status: `IMPLEMENTED_CONTRACT / RUNTIME_VALIDATION_REQUIRED / REAL_IDP_NOT_YET_PROVEN`

## 1. Purpose

F1 makes an AIRenOS access token dependent on canonical server-side session state. A valid signature alone is not sufficient: the token `sid` must correspond to an active, unrevoked AIRenOS session bound to the same canonical Identity and the same temporal window.

This gate does not add or simulate an upstream IdP. It closes the lifecycle gap between short-lived signed access tokens and immediate logout/security revocation.

## 2. Frozen lifecycle rules

1. AIRenOS MUST persist session metadata before returning a newly minted bearer to a caller.
2. If canonical session persistence fails, issuance fails closed and the bearer MUST NOT be returned.
3. The session store MUST contain metadata only: `sessionId`, `identityId`, `issuedAt`, `expiresAt`, lifecycle status and revocation metadata. Raw access tokens, refresh tokens, signing keys, tenant authority and role authority MUST NOT be stored there.
4. After cryptographic verification, an AIRenOS access token MUST be rejected unless its `(sid, sub, iat, exp)` matches an active canonical session record.
5. Revocation MUST invalidate a still-cryptographically-valid access token immediately.
6. Identity suspension MUST make all sessions for that Identity unusable even if they were not individually revoked yet.
7. Session access tokens remain capped at 300 seconds. F1 does not introduce long-lived browser bearer persistence.
8. AIRenOS runtime roles MUST NOT receive direct `SELECT`, `INSERT`, `UPDATE` or `DELETE` authority over the session table. Session lifecycle operations remain behind narrow `SECURITY DEFINER` functions granted only to `airen_auth`.
9. Revocation requires a non-empty bounded reason to preserve operational accountability.
10. F1 runtime tests are not evidence of a real upstream login or K4-C3 browser handoff.

## 3. PostgreSQL authority

Migration `0035_airenos_session_lifecycle.sql` creates `identity.airenos_sessions` with:

- UUID `session_id` primary key;
- canonical AIRenOS `identity_id` foreign key;
- issued/expiry timestamps with a database-enforced maximum five-minute lifetime;
- `active` / `revoked` lifecycle state;
- bounded revocation reason and timestamp;
- no bearer/token/secret/tenant/role columns;
- RLS enabled as additional defense while direct runtime grants remain revoked.

The `airen_auth` role receives execute-only access to:

- `security.register_airenos_session(...)`;
- `security.resolve_active_airenos_session(...)`;
- `security.resolve_airenos_identity(...)`;
- `security.revoke_airenos_session(...)`;
- `security.revoke_all_airenos_sessions(...)`.

`security.resolve_airenos_identity(uuid)` also closes the F0 production-wiring gap for internal AIRenOS `sub = identityId`: platform roles are reloaded server-side rather than copied from token claims.

## 4. Application lifecycle contract

`PersistentAirenOSSessionIssuer` wraps the F0 cryptographic issuer and persists session metadata before release.

`RevocationAwareAirenOSSessionVerifier` performs cryptographic verification first and then requires a matching active canonical session record.

`AirenOSSessionRevocationService` exposes single-session and all-sessions-for-Identity revocation with validated reasons.

`PostgresAirenOSSessionLifecycleStore` implements the lifecycle and Identity-by-id contracts through `airen_auth` and the narrow security functions. It never queries the session or Identity authority tables directly while operating under that runtime role.

## 5. Explicit non-claims

F1 does NOT certify:

- an upstream OIDC provider;
- OIDC discovery/JWKS from a real provider;
- Authorization Code + PKCE browser login;
- refresh-token issuance or rotation;
- browser handoff to Base44;
- Base44 -> AIRenOS -> Kairos provider-verified staging E2E;
- K4-C3 closure.

No Base44 credential becomes AIRenOS authority.

## 6. Gate state

- `ISA_F0_TRUST_CRYPTO_CONTRACT = GOVERNANCE_REGISTERED / DEDICATED_CI_PASS`
- `ISA_F1_SESSION_LIFECYCLE_REVOCATION = IMPLEMENTED / RUNTIME_VALIDATION_REQUIRED`
- `ISA_F2_REAL_UPSTREAM_OIDC_PROVIDER_ADAPTER = OPEN`
- `ISA_F3_BROWSER_AUTHORIZATION_HANDOFF = OPEN`
- `ISA_F4_STAGING_PROVIDER_VERIFIED_E2E = OPEN`

K4-C3 remains `OPEN / REAL SESSION PROOF PENDING` until F4 produces real provider-verified evidence.
