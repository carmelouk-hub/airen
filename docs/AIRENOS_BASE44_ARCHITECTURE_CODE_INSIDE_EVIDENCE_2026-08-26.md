# AIRenOS Base44 Architecture Explorer v0.2 — Code Inside — Evidence — 2026-08-26

Milestone: `AIRENOS-BASE44-ARCHITECTURE-CODE-INSIDE-004`

Verdict: `PASS_READ_ONLY_CODE_VISUALIZATION_WITH_BASE44_METADATA_RESIDUES_ISOLATED`

## Scope

Expose short static excerpts of real governed AIRenOS source code inside the six already-approved Architecture Explorer module cards. The visualization remains read-only and uses native HTML `<details>` elements only. No runtime fetch, script execution, form, operational button, Base44 entity access, backend function, connector, secret, Tenant/Location authority or production publication is introduced.

## GitHub implementation

Repository: `carmelouk-hub/airen`
Branch: `base44/airenos-architecture-explorer-20260826`
Previous evidence commit: `4a8a6c6c8bdc38f1cfa851802e8728fd5299db7f`
Implementation HEAD before this evidence: `b71e6b488a632733cf68d51c6e7f9aa7cbab1df8`
Implementation tree: `1ede03bdd2e11aa6a88d4ab03b03c88d47b92433`
Compare from previous evidence: `ahead_by=2`, `behind_by=0`, exactly two changed paths:
- `base44-apps/airenos-control-plane-staging/public/architecture-explorer.html`
- `base44-apps/airenos-control-plane-staging/tests/architecture-explorer-boundary.test.js`

Remote blobs:
- Explorer HTML: `663a4e4e95976dd1e13d5269ac3aefa49b5595a2`
- Boundary test: `a89e2071d627ddbccc7ff18801e266012ba7e974`

`src/App.jsx`, `index.html`, Foundation packages, T20 certified implementation, Golden governance/spec, RistoAIRen staging and Corte production were not modified by this micro-step.

## Pinned real source excerpts

The Explorer displays six static excerpts pinned to these exact governed GitHub blobs:
1. `packages/identity/src/index.ts` — `b0ee6060c5a28f7d1aa216f223054bea4d06d9d9`
2. `packages/authorization/src/index.ts` — `ea4e48220eb040b5e555593715a0b50df0181d80`
3. `packages/tenant/src/index.ts` — `fa2f500f8a1a7e725067de40711d20f81f41a922`
4. `packages/persistence-postgres/src/index.ts` — `6d040134f58072b67c5c3f67a640b578136380b4`
5. `packages/persistence-postgres/src/risto-booking-repository.ts` — `468232abf7621039de744fe6822053b1843781f8`
6. `apps/api/src/ristoairen-booking-api.ts` — `6661d5528da34814f7d443751447aee253432820`

The six displayed source drawers expose representative markers including `AUTHENTICATION_REQUIRED`, `MEMBERSHIP_REQUIRED`, `TENANT_RESOLUTION_FAILED`, `airen.identity_id`, `PostgresRistoBookingMutationTransaction`, and `RETRYABLE_FAILURE`.

## Visual/runtime boundary

Explorer version marker: `v0.2 · CODE INSIDE`
Pinned-source marker: `SOURCE BLOBS PINNED`
Code drawers: `6`
`<script>` elements: `0`
Runtime `fetch()`: absent
`base44.entities`: absent
Forms: absent
Operational buttons: absent

The parent AIRenOS Control Plane still embeds the Explorer through the previously certified sandboxed iframe with empty capability set and `referrerPolicy="no-referrer"`.

## Base44 regression

App: `airenos-control-plane-staging`
App ID: `6a8c9e874818cd5b11c8cc72`

Full staging regression after v0.2 and cleanup attempt:
- tests: `36`
- pass: `36`
- fail: `0`
- cancelled: `0`
- skipped: `0`
- todo: `0`
- optimized Vite build: `PASS`

Latest sandbox SHA-256:
- `public/architecture-explorer.html` = `e9a6910fca1badd5e2df3019fb84f0e1424785d86626dba9dda45c0dfd0496c1`
- `tests/architecture-explorer-boundary.test.js` = `35456ce7e9e5de3473adf99a20b1784610ad5216c66421dd4fb42b2b81c90f9d`
- `src/App.jsx` = `84ce6ef31bdb52f903c8066d6615a018e41d3d3f82418afc52fb3ce5e095a401`
- `index.html` = `259b961525ac46edb75b1d1a16694d49718b2b6b4db46ae0985a39f3e6872952`

HTTP smoke executed after v0.2 sync:
- `/` -> `200`, title `AIRenOS · Control Plane`
- `/architecture-explorer.html` -> `200`, title `AIRenOS Architecture Explorer`
- `v0.2 · CODE INSIDE` present

## Base44 checkpoint

Checkpoint: `6a8f52f062e44e350a3f4f15`
Name: `AIRenOS Architecture Explorer v0.2 — Code Inside · metadata residues isolated`
Base44 git commit: `94d9ed3b472263e2b48dc1632cacf5172e0724eb`

## Base44 metadata residue reconciliation

During resource audit, the original accidental `__noop__` schema was traced to `base44/entities/__noop__.jsonc` in the Base44 sandbox. That file was removed and the Base44 internal repository auto-committed the deletion. Post-removal filesystem grep returns zero `__noop__` matches and the file is no longer tracked.

However, the Base44 schema registry still reports `__noop__`, proving the remaining residue is persisted in Base44 metadata outside the current app filesystem.

A second accidental schema invocation during checkpoint discovery created another empty metadata schema named `noop_should_not_create`. It is not referenced by GitHub or by AIRenOS application code. Both schema residues are therefore classified as:

`BASE44_METADATA_RESIDUES_NONOPERATIONAL_PENDING_SUPPORT_CLEANUP`

Important: this evidence does NOT claim `Base44 authority delta = ZERO` while those registry entries remain. It does certify:
- `FOUNDATION_AUTHORITY_DELTA = ZERO`
- `OPERATIONAL_WRITE_DELTA = ZERO`
- `PRODUCTION = NOT_PERFORMED`
- no Explorer code path reads from or writes to either metadata schema.

No further Base44 entity-schema operations are authorized for the Architecture Explorer workflow.

## Protected state

Final live PR #4 pre-evidence check:
- OPEN
- DRAFT
- UNMERGED
- certified R3 head `3d32b53bde2191c7718606cf9d3fe3497ae3f626`

Protected boundaries unchanged:
- certified R3 branch/tree
- `main`
- T20 certified implementation
- Golden governance/spec
- RistoAIRen staging
- Corte delle Stelle production

## Terminal classification

`ARCHITECTURE_EXPLORER_V0_2_CODE_INSIDE = PASS_READ_ONLY_CODE_VISUALIZATION`
`REAL_SOURCE_DRAWERS = 6_VERIFIED_PINNED_BLOBS`
`BASE44_METADATA_RESIDUES = ISOLATED_NONOPERATIONAL_PENDING_SUPPORT_CLEANUP`
`FOUNDATION_AUTHORITY_DELTA = ZERO`
`OPERATIONAL_WRITE_DELTA = ZERO`
`PRODUCTION = NOT_PERFORMED`
