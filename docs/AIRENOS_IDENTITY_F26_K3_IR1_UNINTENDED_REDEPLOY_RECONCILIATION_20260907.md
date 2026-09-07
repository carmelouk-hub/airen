# AIRenOS Identity F2.6-K3-IR1 — Unintended Keycloak Staging Redeploy Incident Reconciliation

Date: 2026-09-07  
Environment: Render Frankfurt staging only  
Gate: `F2_6_K3_IR1`  
Canonical classification: `CLOSED / PASS — INCIDENT RECONCILED / NO FUNCTIONAL RUNTIME DRIFT OBSERVED`

## 1. Human authorization

Authorized scope: reconcile and register append-only the unintended redeploy incident affecting only the existing Render staging service `airenos-keycloak-f26-staging`; perform read-only GitHub, Google Drive and Render checks; compare runtime-source equivalence between `072a13f5532733cc52a20b5646938dd57f7c79e2` and `16e3975e9a39123610d8db0d3a45c12749a7ccef`; verify post-redeploy runtime/readiness/database/OIDC continuity; and, only on complete incident reconciliation, register evidence in GitHub + canonical Handoff + Platform Bible. No rollback, further redeploy, environment mutation, K3 subject mutation, Session Authority, DNS, Base44, new cost or production was authorized.

## 2. Fresh RULE-DOC-21 pre-write reconciliation

Fresh canonical pre-write reconciliation was performed after authorization and before this governed write.

GitHub:

- working branch: `foundation/airenos-identity-f26-keycloak-render-staging-20260906`
- pre-write HEAD: `16e3975e9a39123610d8db0d3a45c12749a7ccef`
- pre-write tree: `d643645a69472b7ff7d084c633fae81756cf5468`
- R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- main: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- RBL: `d055fba86d938aa38cee648171425046c7d972a4`
- K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`
- PR #4: OPEN / DRAFT / UNMERGED

Google Drive before this registration:

- canonical Handoff revision: `54`
- Platform Bible revision: `115`

No protected branch or production authority mismatch was observed.

## 3. Incident preserved exactly

During canonical-chat read-only verification, an unintended provider-side operation occurred against Render service `srv-daerht9t0dsc73bfrisg` (`airenos-keycloak-f26-staging`). The invoked environment-update operation carried an empty environment-variable list and did not submit any environment key or value. Despite the empty merge payload, Render triggered redeployment. The call was inadvertently repeated, producing two API-triggered deploys.

The incident is preserved without history rewriting:

1. previous K1/K2 runtime deploy:
   - deploy: `dep-daerm7uq1p3s73ak5hl0`
   - source: `072a13f5532733cc52a20b5646938dd57f7c79e2`
   - final provider state after incident: `deactivated`

2. unintended redeploy #1:
   - deploy: `dep-daf6aogn74is738hifc0`
   - source: `16e3975e9a39123610d8db0d3a45c12749a7ccef`
   - trigger: `api`
   - final state: `deactivated`

3. unintended redeploy #2:
   - deploy: `dep-daf6atf9l3cc73bup8n0`
   - source: `16e3975e9a39123610d8db0d3a45c12749a7ccef`
   - trigger: `api`
   - state: `live`
   - finished: `2026-09-07T07:20:29.514799Z`

No rollback was executed. No additional redeploy was triggered by IR1.

## 4. Runtime-source equivalence

GitHub compare `072a13f5532733cc52a20b5646938dd57f7c79e2...16e3975e9a39123610d8db0d3a45c12749a7ccef` returned:

- status: `ahead`
- ahead_by: `2`
- behind_by: `0`
- total_commits: `2`
- changed files: exactly `2`

The only changed files are append-only evidence documents:

- `docs/AIRENOS_IDENTITY_F26_K1_KEYCLOAK_STAGING_LIVE_EVIDENCE_20260906.md`
- `docs/AIRENOS_IDENTITY_F26_K2_LIVE_OIDC_READINESS_EVIDENCE_20260906.md`

No deployable source, Containerfile, Blueprint, realm contract, migration, SQL, runtime code or configuration file changed between the previous deployed source and the current deployed source.

Therefore:

`072a13f... -> 16e3975... = DOCUMENTATION-ONLY SOURCE DELTA`

## 5. Containerfile and Blueprint read-back

Independent GitHub read-back at both source SHAs confirmed exact content equality for:

- `deploy/keycloak/Containerfile`
- `render.identity.keycloak.f26.yaml`

The effective deployment contract remains:

- Keycloak `26.7.2`
- Docker runtime
- `start --optimized`
- `KC_DB=postgres`
- health enabled
- `KC_HTTP_MANAGEMENT_HEALTH_ENABLED=false`
- public HTTP port `10000`
- exact staging hostname `https://airenos-keycloak-f26-staging.onrender.com`
- health path `/health/ready`
- plan Standard
- region Frankfurt
- auto deploy off

`CONTAINERFILE_DRIFT = NONE`

`BLUEPRINT_DRIFT = NONE`

## 6. Render service topology and static provider state

Fresh provider read-back after the incident shows:

- service ID: `srv-daerht9t0dsc73bfrisg`
- name: `airenos-keycloak-f26-staging`
- repository: `https://github.com/carmelouk-hub/airen`
- branch: `foundation/airenos-identity-f26-keycloak-render-staging-20260906`
- runtime: Docker
- plan: Standard
- region: Frankfurt
- instances: `1`
- auto deploy: off
- health path: `/health/ready`
- service not suspended
- current deploy `dep-daf6atf9l3cc73bup8n0` = `live`

Workspace topology remains exactly three services and contains no Session Authority service.

No new Render service, Postgres, key-value store, disk, plan or cost-bearing resource was created by IR1.

## 7. Post-redeploy runtime and readiness

Provider logs for the live replacement instance prove post-redeploy startup:

- `Bootstrap completed in 7.088000 seconds`
- `Keycloak 26.7.2 ... started in 17.412s`
- listening on `http://0.0.0.0:10000`
- management interface on `http://0.0.0.0:9000`
- `Profile prod activated`

Render accepted the deploy as `live` while the service health contract remains `/health/ready`.

Classification:

`KEYCLOAK_POST_REDEPLOY_RUNTIME = PASS`

`KEYCLOAK_VERSION = 26.7.2`

`KEYCLOAK_PROFILE = prod`

`KEYCLOAK_HTTP_PORT = 10000`

`KEYCLOAK_READINESS = PASS_PROVIDER_HEALTH_GATE`

IR1 does not claim a second independent health-response body because the canonical HTTP runtime cannot directly fetch the service body. This is the same evidence-classification discipline already used by K1/K2.

## 8. Database continuity

Fresh Render metadata confirms the existing managed Identity PostgreSQL resource is unchanged:

- ID: `dpg-dadcplv10e5c73ebujk0-a`
- status: `available`
- plan: `basic_256mb`
- region: Frankfurt
- storage: `1 GB`
- PostgreSQL: `17`
- current provider default user: `airenos_identity_provider_admin_f26r2`
- bootstrap IP allowlist remains `81.56.149.88/32`

Provider metrics show active database connections after the new Keycloak deploy became live. Combined with successful Keycloak bootstrap/startup against the unchanged PostgreSQL deployment contract, this is live runtime evidence that database-backed startup remained operational.

A canonical read-only SQL query was attempted through the Render SQL connector and failed before SQL execution because that connector still cannot satisfy the provider SSL/TLS requirement. No SQL statement was executed and no database mutation occurred.

Classification:

`KEYCLOAK_DATABASE_CONNECTIVITY = PASS_LIVE_RUNTIME`

`CANONICAL_SQL_READBACK = NOT_AVAILABLE_CONNECTOR_TLS`

The prior K2 Desktop verifier evidence remains the last successful direct logical-database SQL verification and is not rewritten by IR1.

## 9. Environment-operation reconciliation

The unintended provider operation submitted an empty environment-variable merge payload; no environment variable key and no secret/value was supplied by the operation. The connector does not expose a secret-safe complete environment-value read-back endpoint, so IR1 does not claim direct value-by-value comparison of secret environment variables.

The following facts are nevertheless independently reconciled:

- no key/value was present in the mutation payload;
- `replace` semantics were not used to replace the environment set;
- Containerfile and Blueprint are unchanged;
- Keycloak reached the same version, production profile and expected ports;
- database-backed bootstrap remained operational;
- the provider accepted the same `/health/ready` contract and marked the deploy live.

Classification:

`ENV_MUTATION_PAYLOAD = EMPTY`

`ENV_SECRET_VALUE_READBACK = NOT_AVAILABLE_BY_CONNECTOR`

`ENV_FUNCTIONAL_DRIFT_EVIDENCE = NONE_OBSERVED`

No secret was exposed during reconciliation.

## 10. OIDC continuity after redeploy

Canonical K2 evidence remains `CLOSED / PASS` and records the live `airenos` realm, public client `airenos-browser-session`, exact staging issuer, Discovery/JWKS readiness, Authorization Code + PKCE S256 readiness and fail-closed PKCE enforcement.

Immediately before this incident, K3-R0 independently observed public Discovery HTTP 200 with issuer:

`https://airenos-keycloak-f26-staging.onrender.com/realms/airenos`

K3-R0 performed zero Keycloak mutations, zero authentication attempts and zero token exchanges.

The unintended Render operation was provider-service configuration orchestration only. It did not call the Keycloak Admin API, did not modify the Keycloak logical database, did not create/update/delete a realm, client, user, role, group, mapper or authentication flow, and did not perform an OIDC token exchange.

The replacement deploy runs deployable source identical to the previously certified runtime source and reconnects to the same persistent PostgreSQL-backed Keycloak state. Render HTTP metrics also record successful `200` and `302` responses after the replacement deploy became live, although Render does not expose path attribution for those metric points and IR1 does not misclassify them as direct Discovery/JWKS body evidence.

The canonical environment again cannot independently retrieve the Discovery/JWKS response bodies. Therefore IR1 certifies continuity by deterministic runtime-source equivalence + unchanged persistent provider state + absence of Keycloak data mutation + successful post-redeploy runtime/readiness, while preserving K2 as the direct live OIDC configuration/readiness authority.

Classification:

`OIDC_CONFIG_DRIFT_CAUSED_BY_INCIDENT = NONE_OBSERVED`

`OIDC_POST_REDEPLOY_CONTINUITY = PASS_RECONCILED_EQUIVALENCE`

`POST_REDEPLOY_DISCOVERY_BODY_SECOND_EXECUTION = NOT_AVAILABLE_CANONICAL_HTTP_RUNTIME`

`POST_REDEPLOY_JWKS_BODY_SECOND_EXECUTION = NOT_AVAILABLE_CANONICAL_HTTP_RUNTIME`

This classification does NOT promote real Authorization Code issuance/exchange, real ID-token runtime verification or real browser login. Those remain outside this gate.

## 11. Protected boundaries

IR1 preserves all protected boundaries:

- R3 unchanged
- main unchanged
- RBL unchanged
- K4 unchanged
- PR #4 remains OPEN / DRAFT / UNMERGED
- no Session Authority
- no Base44 mutation
- no DNS mutation
- no production mutation
- no K3 proof-subject mutation
- no rollback
- no additional redeploy
- no new resource or cost

## 12. Incident terminal classification

```text
F2_6_K3_IR1 = CLOSED / PASS
INCIDENT_RECONCILIATION = PASS
UNINTENDED_REDEPLOY_HISTORY_PRESERVED = TRUE
CURRENT_LIVE_DEPLOY = dep-daf6atf9l3cc73bup8n0
CURRENT_RUNTIME_SOURCE = 16e3975e9a39123610d8db0d3a45c12749a7ccef
PREVIOUS_RUNTIME_SOURCE = 072a13f5532733cc52a20b5646938dd57f7c79e2
SOURCE_DELTA = DOCUMENTATION_ONLY
CONTAINERFILE_DRIFT = NONE
BLUEPRINT_DRIFT = NONE
KEYCLOAK_POST_REDEPLOY_RUNTIME = PASS
KEYCLOAK_READINESS = PASS_PROVIDER_HEALTH_GATE
KEYCLOAK_DATABASE_CONNECTIVITY = PASS_LIVE_RUNTIME
OIDC_POST_REDEPLOY_CONTINUITY = PASS_RECONCILED_EQUIVALENCE
FUNCTIONAL_RUNTIME_DRIFT_OBSERVED = FALSE
ROLLBACK_REQUIRED = FALSE
ROLLBACK_EXECUTED = FALSE
ADDITIONAL_REDEPLOY_EXECUTED_BY_IR1 = FALSE
ENVIRONMENT_MUTATION_EXECUTED_BY_IR1 = FALSE
KEYCLOAK_MUTATION_EXECUTED_BY_IR1 = FALSE
K3_SUBJECT_MUTATION = FALSE
SESSION_AUTHORITY_CREATED = FALSE
BASE44_CHANGED = FALSE
DNS_CHANGED = FALSE
PRODUCTION = FALSE
```

## 13. K3 state after IR1

IR1 closes only the incident-reconciliation boundary. It does not certify K3.

```text
F2_6_K3 = OPEN
F2_6_K3_R0_READ_ONLY_EVIDENCE = INCOMPLETE_ADMIN_READBACK
K3_CERTIFICATION = NOT_PERFORMED
```

K3 may resume only through a separately governed continuation of R0 that obtains a secret-safe administrative read-back context without violating the existing authentication/token constraints. No such continuation is executed by IR1.
