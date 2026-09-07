# AIRENOS IDENTITY F2.6-K3-P1 — REAL AUTHORIZATION CODE + PKCE S256 OIDC FLOW EVIDENCE

Date: 2026-09-07
Scope: governed staging-only identity proof
Classification at evidence capture: `F2_6_K3_P1 = PASS / VERIFIED`; overall `F2_6_K3 = OPEN / NOT_YET_CANONICALLY_CLOSED`.

## 1. Authorization boundary

This proof was explicitly authorized for a new clean synthetic Keycloak staging subject and a real browser Authorization Code flow with PKCE S256, including real authorization-code exchange and cryptographic ID-token verification through the existing AIRenOS F2 OIDC adapter.

Explicit exclusions remained in force: no AIRenOS Session Authority invocation, no AIRenOS bearer issuance, no DNS, Base44, Kairos or production mutation, no new cost, no Render environment mutation, redeploy or rollback. Credentials, authorization codes, tokens, verifier, nonce, state and callback URLs are intentionally absent from this evidence.

## 2. Clean proof subject

- username: `airenos-f26-k3-p1-clean-20260907161108`
- provider subject UUID: `e2a785db-b027-4fbe-a79a-2700c1a4e5f6`
- enabled: true
- requiredActions: empty at final provider read-back
- provider-side setup read-backs observed groups empty, direct realm roles empty and effective realm roles empty before the successful real flow.
- No K3-P1 tenant or entitlement assignment operation was executed. This evidence does not claim global absence beyond the provider surfaces directly read back.

## 3. OIDC and exact-source preflight

The successful run reported secret-safe preflight PASS against the exact AIRenOS source used for the proof:

- `K3_P1_LOCAL_EXACT_SOURCE=PASS`
- `K3_P1_OIDC_DISCOVERY_PKCE_PREFLIGHT=PASS`
- `K3_P1_BROWSER_OPEN=PASS`

The staging issuer was the governed Keycloak realm `https://airenos-keycloak-f26-staging.onrender.com/realms/airenos`; Authorization Code and PKCE S256 support had already been directly reconciled in K2/P1 readiness checks. JWKS read-back exposed no private key material.

The AIRenOS adapter under proof is `packages/integrations/src/oidc-upstream-provider.ts`, which performs the authorization-code token exchange and cryptographic ID-token/JWKS validation with issuer, audience, subject, nonce and temporal claim checks.

## 4. Real browser Authorization Code + PKCE proof

Operator-provided runner output from the final successful governed attempt:

```text
K3_P1_REAL_BROWSER_LOGIN=PASS
K3_P1_AUTH_CODE_RECEIVED=PASS_SECRET_SAFE
K3_P1_ADAPTER_CODE_EXCHANGE=PASS_SECRET_SAFE
K3_P1_ID_TOKEN_CRYPTO_VERIFY=PASS
K3_P1_PROVIDER_SUBJECT=e2a785db-b027-4fbe-a79a-2700c1a4e5f6
K3_P1_SESSION_AUTHORITY_INVOKED=FALSE
K3_P1_AIRENOS_BEARER_ISSUED=FALSE
K3_P1_REAL_FLOW=PASS
```

The exact provider subject returned by the verified identity matched the clean proof-subject UUID.

## 5. Final provider read-back

A final secret-safe Keycloak admin read-back, supplied immediately after the successful flow, confirmed the exact clean subject as enabled with no required actions and showed a Keycloak IdP session for client `airenos-browser-session`.

The session identifier and source IP are deliberately omitted. A Keycloak IdP session is provider authentication state and is NOT AIRenOS Session Authority. AIRenOS Session Authority remained absent/not invoked and no AIRenOS bearer was issued.

## 6. Preserved attempt history

Earlier attempts are preserved, not rewritten:

- first real attempt: clean subject resolved but browser password authentication failed (`invalid_user_credentials`); no code exchange;
- second attempt: advanced to Keycloak profile completion and was deliberately abandoned pending governed synthetic profile completion;
- later attempt: callback returned `authentication_expired`; no authorization code was issued;
- final clean attempt: full browser login, Authorization Code, PKCE S256 code exchange and ID-token cryptographic verification PASS.

## 7. Protected-boundary reconciliation

Post-flow and pre-registration read-backs preserved the protected boundaries:

- R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- main: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- RBL: `d055fba86d938aa38cee648171425046c7d972a4`
- K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`
- PR #4: OPEN / DRAFT / UNMERGED
- canonical Handoff pre-registration revision: 56
- Platform Bible pre-registration revision: 117
- Render Keycloak latest deploy: `dep-daf6atf9l3cc73bup8n0`, source `16e3975e9a39123610d8db0d3a45c12749a7ccef`, LIVE; no newer deploy observed.

No P1 production, Base44, DNS, Kairos, environment, redeploy or rollback mutation was performed.

## 8. Registration-tooling incident lineage

During the first canonical-registration attempt, four unintended append-only commits added only `__NOOP__`, `__NOOP2__`, `__NOOP3__` and `__NOOP4__`:

- `6e4ec109698e5659f1f15208ccf939c3ccffc264`
- `18e5fc6840b70a90653a0e557b3fe2d12764ed4b`
- `848e3bc51a137d2cecfc31854813b305387dc4d1`
- `e2c374aacc9915c4c039c5e540e927534d91d70e`

They were contained by authorized append-only cleanup commit `4b502a267204bbdc8422ad8d149ce29d855c99fd`, which removed exactly those four files and restored the content tree exactly to pre-incident tree `48474a43897bcef17aff27906e7a1d8228b22bf8`. No reset, amend, squash, force-push or history rewrite occurred.

A later tooling call created unattached empty commit object `ebb8479e67111567be59cbc50a40ca55e8193343` with `files=[]` and the same tree; the Identity branch ref never moved to it. It is not canonical K3-P1 evidence.

## 9. Evidence classification

```text
F2_6_K3_P1 = PASS / VERIFIED
REAL_BROWSER_LOGIN = PASS
AUTHORIZATION_CODE = PASS / SECRET_SAFE
PKCE_S256 = PASS
CODE_EXCHANGE_THROUGH_AIRENOS_ADAPTER = PASS
ID_TOKEN_CRYPTO_VERIFY = PASS
PROVIDER_SUBJECT_EXACT_MATCH = PASS
KEYCLOAK_IDP_SESSION = PRESENT / EXPECTED
AIRENOS_SESSION_AUTHORITY = NOT_INVOKED
AIRENOS_BEARER = NOT_ISSUED
F2_6_K3_P1_CANONICAL_REGISTRATION = IN_PROGRESS
F2_6_K3 = OPEN / NOT_YET_CANONICALLY_CLOSED
```

This evidence alone does not authorize any next gate, production action, Session Authority activation, Base44 integration, DNS change or bearer issuance.
