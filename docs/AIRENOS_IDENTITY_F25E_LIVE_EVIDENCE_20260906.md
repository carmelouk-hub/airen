# AIRenOS Identity F2.5E — Live Effective Runtime Authority Evidence

State: CLOSED / PASS  
Environment: Render Identity staging only  
Governance: RULE-DOC-20/21, dual-source reconciliation required

## Canonical lineage before this evidence commit

- F2.5E implementation head: `52f58cf474e4b608fca924e8b8ee98334ce9adfb`
- F2.5D preserved head: `82ac8c8d4961e8d24dd281f8aa65e34944503d28`
- R3 preserved head: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- `main` preserved head: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- RULE-DOC-21 mirror commit: `51e5e409e404067a34979d811ae4028962ed3e40`
- PR #4: OPEN / DRAFT / UNMERGED
- Drive revisions after the governed documentation writes: Handoff 47; Platform Bible 111; Kairos 3; RULE-DOC-21 3

Fresh GitHub and Drive reconciliation immediately before this write returned MATCH.

## Root cause

The former Render-managed credential named `airenos_identity_runtime` authenticated as that `session_user`, but a new connection started with `current_user` and the configured role set to the Render provider-owner role.

Provider-superuser grants supplied inherited provider-owner and PostgreSQL predefined-role authority. F2.5D checked the named login's direct attributes, protected-object ownership and `airen_auth` membership, but did not check:

- `session_user` versus `current_user`;
- role-level `INHERIT`;
- membership ADMIN, INHERIT and SET options;
- provider-owner and predefined-role membership;
- startup role settings;
- effective database and protected-schema CREATE authority.

The managed credential could therefore pass the F2.5D checks while executing with inherited provider-owner authority.

## Append-only correction

F2.5E adds:

- `db/identity/0003_bind_effective_runtime_authority.sql`;
- runtime assertions for new-connection effective authority;
- a CI fixture that first reproduces the Render false-positive and then proves the corrected path;
- a Blueprint contract that forbids `fromDatabase.connectionString` for the Session Authority runtime;
- an explicit unsynced `SESSION_AUTHORITY_DATABASE_URL` secret input referenced through `secret://env/SESSION_AUTHORITY_DATABASE_URL`.

No secret, password, token or complete connection URL is stored in Git or Drive.

## CI evidence

GitHub Actions run `33981948187`, run number 7, completed SUCCESS on implementation commit `52f58cf474e4b608fca924e8b8ee98334ce9adfb`.

Both required jobs passed:

- F2.5E static contract;
- F2.5E dedicated PostgreSQL runtime.

Earlier append-only failures remain preserved. No safety assertion was weakened.

## Live Render staging proof

Target:

- database: `airenos-identity-f25-staging-db`;
- provider id: `dpg-dadcplv10e5c73ebujk0-a`;
- PostgreSQL 17;
- Frankfurt;
- non-production only.

Safe runtime login:

- `airenos_identity_runtime_f25e`;
- LOGIN = true;
- SUPERUSER = false;
- BYPASSRLS = false;
- CREATEROLE = false;
- CREATEDB = false;
- INHERIT = false;
- REPLICATION = false;
- protected Identity ownership count = 0;
- effective database CREATE = false;
- no provider-owner membership;
- no PostgreSQL predefined-role membership;
- exactly one membership: `airen_auth`, ADMIN false, INHERIT false, SET true.

Independent new TLS connection:

- `session_user = airenos_identity_runtime_f25e`;
- `current_user = airenos_identity_runtime_f25e`;
- startup effective role = `none`.

Runtime behavior:

- direct protected-table access denied: PASS;
- transaction-scoped `SET LOCAL ROLE airen_auth`: PASS;
- narrow `security.resolve_active_airenos_session` read path: PASS;
- migration marker `F2.5E-0003`: present.

## Credential rotation and rollback

A new Render-managed default credential named `airenos_identity_provider_admin_f25e` is retained strictly for provider administration and rotation. It is not an application credential.

The safe unmanaged runtime secret is escrowed in the operating-system credential store. Secret-output verification returned PASS without printing the secret.

Only after the safe runtime passed end-to-end and rollback escrow was verified, the compromised managed credential `airenos_identity_runtime` was deleted.

Provider read-back after deletion:

- old compromised runtime role count = 0;
- safe runtime login count = 1;
- bootstrap login count = 1.

A new safe-runtime reconnection again proved `session_user = current_user` and effective role `none`.

## Preserved boundaries

- `airenos_identity_bootstrap_f25` remains ACTIVE.
- Bootstrap IP allowlist remains unchanged.
- No production action occurred.
- No Corte delle Stelle mutation occurred.
- No Blueprint sync occurred.
- No Session Authority service or Keycloak staging service was created.
- PR #4 was not merged.
- R3 and `main` were not modified.
- No force push, reset, amend or history rewrite occurred.
- No new cost was created.

## Closure classification

- `F2_5E_IMPLEMENTATION = PASS`
- `F2_5E_CI = PASS`
- `F2_5E_LIVE_RUNTIME_AUTHORITY = PASS`
- `OLD_COMPROMISED_RUNTIME_CREDENTIAL = DELETED_AFTER_SAFE_PROOF`
- `BOOTSTRAP_CREDENTIAL = ACTIVE_PRESERVED`
- `BLUEPRINT_SYNC = NOT_EXECUTED`
- `SESSION_AUTHORITY_SERVICE = NOT_CREATED`
- `PRODUCTION = FALSE`
