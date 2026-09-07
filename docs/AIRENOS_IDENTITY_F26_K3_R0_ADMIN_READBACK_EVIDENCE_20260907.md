# AIRenOS Identity F2.6-K3-R0 — Secret-Safe Keycloak Admin Read-Back Evidence

Date: 2026-09-07  
Environment: Render Frankfurt staging only  
Gate: `F2_6_K3_R0`  
Registration boundary: `F2_6_K3_R0_C1`  
Canonical classification after successful cross-source registration: `CLOSED / PASS`

## 1. Human authorization

Authorized scope: register append-only the already-obtained read-only K3-R0 evidence in GitHub, canonical Handoff and Platform Bible, after a fresh reconciliation and followed by remote read-back plus cross-source reconciliation.

Explicitly excluded: real subject authentication, Authorization Code exchange, Session Authority, DNS, Base44, production, new cost, redeploy, rollback and environment mutation.

## 2. Fresh RULE-DOC-21 pre-write reconciliation

Fresh live read-only reconciliation was performed before this governed write.

GitHub before this evidence commit:

- working branch: `foundation/airenos-identity-f26-keycloak-render-staging-20260906`
- pre-write HEAD: `8b4083c9d75e8c5c66a20c505d2078a426ca1eda`
- pre-write tree: `46b71141d4bcda605fe62df1022eb4ed4e1ec448`
- pre-write parent: `16e3975e9a39123610d8db0d3a45c12749a7ccef`
- R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- main: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- RBL: `d055fba86d938aa38cee648171425046c7d972a4`
- K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`
- PR #4: OPEN / DRAFT / UNMERGED

Google Drive before this registration:

- canonical Handoff revision: `55`
- Platform Bible revision: `116`

Render before this registration:

- workspace: `AIRENOS`
- services: exactly `3`
- Keycloak service ID: `srv-daerht9t0dsc73bfrisg`
- Keycloak service: `airenos-keycloak-f26-staging`
- current live deploy: `dep-daf6atf9l3cc73bup8n0`
- current deployed source: `16e3975e9a39123610d8db0d3a45c12749a7ccef`
- auto deploy: off
- Session Authority service: absent
- Identity PostgreSQL: `dpg-dadcplv10e5c73ebujk0-a`, status `available`, PostgreSQL 17, Frankfurt, 1 GB, plan `basic_256mb`

No mismatch was observed at the authorized pre-write boundary.

## 3. Operator-provided live Keycloak admin read-back

The operator supplied a secret-safe live `kcadm.sh` read-back obtained inside the existing Keycloak staging runtime. The shared output contained no administrator password, bearer token, Authorization header, client secret, database credential, PKCE verifier, private JWK or signing private key.

The read-back reported:

`K3_R0_ADMIN_AUTH=PASS_READ_ONLY_CONTEXT`

Realm:

- realm: `airenos`
- enabled: `true`

OIDC client:

- internal client UUID: `10c407cd-4cd6-476b-a067-3b6b32d530f9`
- clientId: `airenos-browser-session`
- enabled: `true`
- protocol: `openid-connect`
- publicClient: `true`
- standardFlowEnabled: `true`
- implicitFlowEnabled: `false`
- directAccessGrantsEnabled: `false`
- serviceAccountsEnabled: `false`
- redirectUris: exactly `["https://session.airenos.com/oidc/callback"]`
- webOrigins: `[]`

This matches the K2 client contract and does not modify it.

## 4. Pre-existing contaminated proof subject read-back

The same read-only admin context inspected the already-existing subject without mutation.

Exact subject:

- UUID: `a114e404-9818-4cdd-ba2b-6d7b81fa4f8e`
- username: `airenos-f26-oidc-proof`
- enabled: `true`
- createdTimestamp: `1788734040343`
- requiredActions: `[]`

Exact-username lookup returned the same UUID.

Direct group read-back returned:

- groups: `[]`

Role-mapping output returned:

```json
{
  "realmMappings": [ {} ]
}
```

Because the command used a projected/filtered output shape, this result is preserved as `ROLE_MAPPING_READBACK_PRESENT_BUT_FILTERED`. It is NOT promoted to a claim that the subject has zero roles.

No group, role, required action, username, enabled state or other subject property was changed by K3-R0.

## 5. Evidence classification

The new evidence closes only the R0 administrative read-back requirement that remained incomplete after IR1.

```text
K3_R0_ADMIN_AUTH = PASS_READ_ONLY_CONTEXT
K3_R0_REALM_ADMIN_READBACK = PASS
K3_R0_CLIENT_ADMIN_READBACK = PASS
K3_R0_CONTAMINATED_SUBJECT_READBACK = PASS
K3_R0_SUBJECT_GROUPS = EMPTY_DIRECTLY_PROVEN
K3_R0_SUBJECT_ROLE_MAPPINGS = READBACK_PRESENT_BUT_FILTERED
K3_R0_SUBJECT_ROLE_MAPPINGS_EMPTY = NOT_CLAIMED
K3_R0_SECRET_EXPOSURE_IN_RECORDED_OUTPUT = NONE_OBSERVED
K3_R0_KEYCLOAK_MUTATION = FALSE
K3_R0_SUBJECT_MUTATION = FALSE
```

K2 remains the direct live OIDC readiness authority. IR1 remains the authority for the unintended-redeploy incident and its reconciled-equivalence continuity classification.

## 6. Boundaries not crossed

K3-R0 did NOT perform:

- real subject authentication;
- real Authorization Code issuance proof;
- real Authorization Code exchange;
- real ID-token runtime verification;
- real browser login;
- Session Authority creation or activation;
- DNS mutation;
- Base44 mutation;
- production mutation;
- Render environment mutation;
- redeploy or rollback;
- new service, database, storage or cost creation.

## 7. Terminal classification

After successful C1 registration and cross-source read-back:

```text
F2_6_K3_R0_READ_ONLY_EVIDENCE = COMPLETE / PASS
F2_6_K3_R0_CANONICAL_REGISTRATION = COMPLETE / MATCH
F2_6_K3_R0_C1 = CLOSED / PASS
F2_6_K3_R0 = CLOSED / PASS

REAL_SUBJECT_AUTHENTICATION = NOT_EXECUTED
AUTHORIZATION_CODE_EXCHANGE = NOT_EXECUTED
SESSION_AUTHORITY = ABSENT

F2_6_K3 = OPEN / NOT EXECUTED
STOP_GATE = ACTIVE
```

## 8. Next boundary

This evidence does not authorize or execute the next K3 subject/browser/token boundary. Any real subject authentication, Authorization Code exchange, ID-token runtime verification, Session Authority work, DNS, Base44 or production action requires a separate explicit governed authorization and a fresh reconciliation.
