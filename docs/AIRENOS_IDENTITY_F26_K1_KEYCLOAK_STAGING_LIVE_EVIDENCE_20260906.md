# AIRenOS Identity F2.6-K1 — Render Keycloak Staging Live Evidence

Date: 2026-09-06  
State: CLOSED / PASS  
Environment: Render Frankfurt staging only  
Governance: RULE-DOC-20 / RULE-DOC-21

## 1. Scope and human authority

F2.6-K1 was authorized only for creation and deployment of one Keycloak Standard staging service on Render Frankfurt, within the existing AIRenOS Identity staging budget ceiling, with no Session Authority and no production activation.

Keycloak remains a replaceable upstream authentication engine. It is not AIRenOS canonical Identity, Tenant, Membership, Role, Permission, Entitlement, Billing, Product Access or Session authority. No Keycloak-issued token is promoted to an AIRenOS bearer by this gate.

## 2. Canonical source lineage

Working branch:

`foundation/airenos-identity-f26-keycloak-render-staging-20260906`

Initial K1 source before the runtime correction:

`dc6136dbd78dc1f40810e8e4034d54157efcc195`

The initial provider deployment `dep-daerhu1t0dsc73bfrlmg` failed closed after the Keycloak 26.7.2 image build. Runtime diagnostics showed that optimized startup rejected a build/runtime mismatch for `kc.http-management-health-enabled`.

The failure is preserved as evidence. No security check, least-privilege assertion, version pin or production-mode requirement was weakened.

Append-only corrective lineage:

- `a98498740a6ac244c9dacfec7d0ee6045f70c603` — persisted `KC_HTTP_MANAGEMENT_HEALTH_ENABLED=false` in both the Keycloak builder and runtime image stages;
- `072a13f5532733cc52a20b5646938dd57f7c79e2` — added the regression assertion that the build/runtime health-listener option remains identical;
- certified K1 runtime source tree: `1153eec01bde8c7ff738f53eb2e4e3686a53d6fb`.

Dedicated F2.6 CI run `34054041136` completed SUCCESS across all three governed jobs:

- Render contract;
- PostgreSQL runtime;
- Keycloak image.

The companion CI failure remains the known stale cross-era R3-I migration guard only. It was neither bypassed nor weakened and does not invalidate the dedicated F2.6 PASS.

## 3. Live Render service proof

Authorized service:

- name: `airenos-keycloak-f26-staging`;
- Render service ID: `srv-daerht9t0dsc73bfrisg`;
- provider URL: `https://airenos-keycloak-f26-staging.onrender.com`;
- region: Frankfurt;
- plan: Standard;
- runtime: Docker;
- instances: 1;
- persistent disk: none;
- automatic deploy: OFF;
- health path: `/health/ready`.

Successful corrective redeploy:

`dep-daerm7uq1p3s73ak5hl0`

Terminal Render deploy status:

`live`

Exact upstream runtime image observed for the successful deployment:

`quay.io/keycloak/keycloak:26.7.2@sha256:9d1f1b2b7261ff53c66cb1092dfcdc34a5fb77e81f9e6a6e75b8b6a795de8067`

Live startup logs prove:

- Keycloak `26.7.2`;
- optimized production startup;
- `prod` profile active;
- main HTTP listener on port `10000`;
- PostgreSQL-backed schema initialization/migration;
- master realm initialization;
- bootstrap completion.

Render declared the deployment terminally `live` with `/health/ready` configured as the service health gate. This is classified as `PASS_PROVIDER_HEALTH_GATE`. Canonical chat did not independently fetch and inspect the external health response body, and this qualification is preserved explicitly.

The live Keycloak schema initialization/migration proves application-level connectivity to the dedicated logical database `airenos_keycloak_f26_staging`.

JGroups self-probe/socket-cookie warnings were observed in startup diagnostics. They are preserved as non-blocking diagnostics for this authorized single-instance staging topology and were not suppressed to obtain PASS.

## 4. PostgreSQL boundary preservation

The dedicated Keycloak logical database remains:

`airenos_keycloak_f26_staging`

Owner/runtime principal remains:

`airenos_keycloak_runtime_f26`

Post-provider verification retained PASS for the F2.6 logical-database verifier. The runtime remains least-privilege and owns no AIRenOS Identity objects.

The existing Identity PostgreSQL provider resource remains unchanged:

- Render ID: `dpg-dadcplv10e5c73ebujk0-a`;
- database: `airenos_identity_f25_staging_db`;
- current provider default: `airenos_identity_provider_admin_f26r2`;
- plan: `basic_256mb`;
- region: Frankfurt;
- storage: 1 GB;
- status: available.

No new PostgreSQL provider instance was created by K1.

## 5. Secret-safety evidence

Provider/runtime log inspection returned no occurrence of:

- `KC_DB_PASSWORD`;
- `KC_BOOTSTRAP_ADMIN_PASSWORD`;
- a complete JDBC credential URL;
- `password=`.

A provisional local bootstrap value was exposed by a UI read-back during the initial K1 attempt. It was immediately rotated before provider use and was never deployed. The deployed provider/runtime logs contain no observed secret disclosure.

Classification:

`LOG_SECRET_EXPOSURE = NONE`

The prior F2.6 provider-admin exposure remediation remains CLOSED / PASS and is not reopened by K1.

## 6. Preserved boundaries

K1 changed only the authorized Keycloak staging service and the append-only governed source/evidence required to make that service healthy and certify it.

Preserved:

- Identity PostgreSQL resource, plan, region, storage and bootstrap allowlist;
- `airenos_identity_bootstrap_f25` credential;
- `airenos_keycloak_runtime_f26` credential;
- no additional database;
- no persistent disk;
- no Session Authority service;
- no DNS change;
- no `login.airenos.com` activation;
- no Base44 mutation;
- no AIRenOS realm/client live configuration claim;
- no Foundation public-key binding;
- no production or Corte delle Stelle mutation;
- no PR #4 merge;
- no R3/main/RBL/K4 mutation;
- no force push, reset, amend or history rewrite.

## 7. Canonical Drive synchronization

K1 live evidence was appended without rewriting prior certified history to:

- canonical Handoff `1cLTVhQDg9Zkv9ZklwU7PGbTBYsOLAg5x4_1aA2yVZNA`, revision `53`, §57;
- AIRenOS Platform Bible `1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA`, revision `114`, §29.

Both writes used Google Docs revision guards and were followed by remote read-back.

## 8. Closure classification

- `F2_6_K1 = CLOSED / PASS`
- `KEYCLOAK_STAGING_SERVICE = LIVE`
- `KEYCLOAK_VERSION = 26.7.2`
- `KEYCLOAK_HEALTH_READY = PASS_PROVIDER_HEALTH_GATE`
- `KEYCLOAK_DATABASE_CONNECTIVITY = PASS_LIVE_RUNTIME`
- `F26_DATABASE_VERIFIER = PASS`
- `LOG_SECRET_EXPOSURE = NONE`
- `SESSION_AUTHORITY = NOT_CREATED`
- `PRODUCTION = FALSE`
- full `F2.6 = OPEN`

The next technical boundary is:

`F2.6-K2 — governed AIRenOS realm/client live configuration + OIDC readiness`

F2.6-K2 is NOT authorized by this record. Session Authority remains blocked until Keycloak/OIDC readiness passes and separate human authorization is granted.
