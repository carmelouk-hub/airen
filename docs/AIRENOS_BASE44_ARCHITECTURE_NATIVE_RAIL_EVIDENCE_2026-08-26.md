# AIRenOS Base44 Architecture Native Rail — Evidence — 2026-08-26

Milestone: `AIRENOS-BASE44-ARCHITECTURE-NATIVE-RAIL-003`

Verdict: `PASS_VISUAL_INTEGRATION_WITH_KNOWN_BASE44_SCHEMA_RESIDUE`

## Scope

Replace the external fixed Architecture launcher with a native `Architecture` item in the AIRenOS React rail and render the already-verified read-only Architecture Explorer inside the Control Plane workspace.

This milestone is visual/read-only only. It does not authorize runtime authority, operational data writes, production publication, Base44 backend logic, Tenant/Location authority, T20/Golden expansion, Corte migration/cutover or R3 merge.

## GitHub implementation

Repository: `carmelouk-hub/airen`
Branch: `base44/airenos-architecture-explorer-20260826`
Pre-evidence implementation HEAD: `e4ed1e23c8d9b7875f4accc88f8f740cdc5e7b64`
Pre-evidence tree: `46a29dcb3dfee69cec49ab0f41d0330bb7a957e1`

Changed paths from previous evidence commit `7bcab9a546e6299abd023ba409b9faa6c16153f6`:
- `base44-apps/airenos-control-plane-staging/src/App.jsx`
- `base44-apps/airenos-control-plane-staging/index.html`
- `base44-apps/airenos-control-plane-staging/tests/architecture-explorer-navigation.test.js`

Compare: `ahead_by=3`, `behind_by=0`, exactly 3 changed paths.

`public/architecture-explorer.html` remained unchanged in this micro-step.

## Native Architecture integration

The React navigation now includes:
- id: `architecture`
- label: `Architecture`
- icon: `Network`

The Architecture view embeds `/architecture-explorer.html` inside the Control Plane workspace using an iframe with:
- `sandbox=""`
- `referrerPolicy="no-referrer"`
- no granted iframe capabilities

The view explicitly states:
`BASE44 = EXPERIENCE ONLY · FOUNDATION REMAINS AUTHORITATIVE`

The legacy fixed launcher was removed from `index.html`.

## Regression evidence

Full Base44 staging test run after implementation:
- tests: `33`
- pass: `33`
- fail: `0`
- cancelled: `0`
- skipped: `0`
- todo: `0`

Optimized Vite build: `PASS`.

Sandbox SHA-256:
- `src/App.jsx` = `84ce6ef31bdb52f903c8066d6615a018e41d3d3f82418afc52fb3ce5e095a401`
- `index.html` = `259b961525ac46edb75b1d1a16694d49718b2b6b4db46ae0985a39f3e6872952`
- `public/architecture-explorer.html` = `74f9b6563d1ace4fc28deb2a6ca522413b9a8e8733e5720befd6bcc713d4e94b`
- `tests/architecture-explorer-navigation.test.js` = `c59795923586d94cc43f00394e30b1fa1b25075e232b90dfe3caf9c878d20443`
- `tests/architecture-explorer-boundary.test.js` = `0f8f3c26dca3525afa12cf7a6f92075127111940956ed9b03cb002b845888695`

HTTP smoke:
- `/` -> `200`, title `AIRenOS · Control Plane`
- `/architecture-explorer.html` -> `200`, title `AIRenOS Architecture Explorer`
- Explorer marker `BASE44 = EXPERIENCE ONLY` present

## Base44 checkpoint

App: `airenos-control-plane-staging`
App ID: `6a8c9e874818cd5b11c8cc72`

Checkpoint id: `6a8f4f23bd762e5a45133862`
Checkpoint name: `AIRenOS Architecture native rail v0.3 — known __noop__ metadata residue`
Base44 commit: `34db89f06a582590ae6ab1fd40e726091be0e2fd`

## Known Base44 metadata residue

During the resource audit an accidental tool invocation created an empty Base44 entity schema named `__noop__`.

Verified facts:
- schema name: `__noop__`
- records: `0`
- not present anywhere in GitHub
- not present in the Base44 app filesystem or `base44/` configuration files
- not referenced by `App.jsx`
- not referenced by Architecture Explorer
- no Foundation code touched
- no Tenant/Location authority movement
- no operational data written
- no production publication performed

The Base44 UI can clear rows but does not persist deletion of this schema; the schema returns after refresh. Cleanup is therefore deferred to Base44 technical support or a future supported schema-delete operation.

Classification: `KNOWN_BASE44_SCHEMA_RESIDUE_NONOPERATIONAL`.

Important: this milestone MUST NOT claim `Base44 authority delta = ZERO` while the schema exists. Instead, the runtime/operational authority delta remains zero, while one known empty metadata schema residue remains pending cleanup.

## Protected state

PR #4 live pre-check on 2026-08-26:
- OPEN
- DRAFT
- UNMERGED
- certified R3 head `3d32b53bde2191c7718606cf9d3fe3497ae3f626`

Protected areas remain untouched:
- certified R3 branch/tree
- `main`
- T20 certified implementation
- Golden governance/spec
- RistoAIRen staging
- Corte delle Stelle production

## Terminal classification

`ARCHITECTURE_NATIVE_RAIL = PASS_VISUAL_INTEGRATION`
`BASE44_SCHEMA_RESIDUE = KNOWN_NONOPERATIONAL_PENDING_SUPPORT_CLEANUP`
`FOUNDATION_AUTHORITY_DELTA = ZERO`
`OPERATIONAL_WRITE_DELTA = ZERO`
`PRODUCTION = NOT_PERFORMED`

This known metadata residue does not authorize any additional Base44 data modeling. No further custom Base44 entities may be created for the Architecture Explorer.
