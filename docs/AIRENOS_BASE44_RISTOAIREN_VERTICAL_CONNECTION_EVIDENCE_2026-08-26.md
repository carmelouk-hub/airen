# AIRenOS Base44 Architecture Explorer v0.3 — RistoAIRen Vertical Connection — Evidence — 2026-08-26

Milestone: `AIRENOS-BASE44-RISTOAIREN-VERTICAL-CONNECTION-005`

Verdict: `PASS_READ_ONLY_RISTOAIREN_VERTICAL_CONNECTION_VISUALIZATION`

## Scope

Expose the governed architectural connection between AIRenOS Foundation and the RistoAIRen Hospitality vertical inside the existing read-only Architecture Explorer. No runtime authority, entity access, backend function, connector, secret, production publication or public Booking endpoint is introduced.

## GitHub implementation

Branch: `base44/airenos-architecture-explorer-20260826`
Previous evidence HEAD: `3e1c88fa085702707ef12f6202dc45f73f5ee40d`
Implementation HEAD before evidence: `c08fbec5f870e7d7c6cddede5c1a34aee5be181d`
Implementation tree: `83659fcf06e303e6603df928e8a17bba715f5d25`
Compare: `ahead_by=2`, `behind_by=0`, exactly two changed paths:
- `base44-apps/airenos-control-plane-staging/public/architecture-explorer.html`
- `base44-apps/airenos-control-plane-staging/tests/architecture-explorer-boundary.test.js`

Explorer blob: `04b0025a97c194ddddc95c99895a90b5c06d2d31`
Boundary-test blob: `2c95f1a49b648544e062c860c3854f7ab5a76ab2`

## Visualized connection

`AIRenOS FOUNDATION → GOVERNED EXCHANGE → RISTOAIREN → BOOKING → EXPERIENCE LAYER`

Foundation-owned authority remains explicit for Identity, Tenant/Location, Membership/RBAC, Entitlements, trusted DB scope/RLS, Audit and Outbox.

RistoAIRen owns restaurant-specific domain logic and experience behavior but cannot self-assert trusted scope or bypass the Foundation pipeline.

Pinned architecture sources:
- RistoAIRen Foundation/Experience adapter design blob: `8e0c79796e59b970c7e7cb3e8170abcd8de155ad`
- RistoAIRen Base44 staging README blob: `eb666f018812a684576506ef05f5c02555603d19`
- T20 Booking repository blob: `468232abf7621039de744fe6822053b1843781f8`

The adapter design's historical T20 field is not used as current certification state. Current Booking status is displayed from the certified bounded T20 runtime lineage.

## Base44 verification

App: `airenos-control-plane-staging`
App ID: `6a8c9e874818cd5b11c8cc72`
Tests: `38/38 PASS`
Fail: `0`
Skipped: `0`
Build: `PASS`
Explorer marker present: `v0.3 · RISTOAIREN CONNECTED`
Vertical marker present: `RistoAIRen Vertical Connection`

Sandbox SHA-256:
- Explorer: `210fe14c30ff315cda6efd5aa039f1d05e499f4f5adafed60f107fbd61d4133c`
- Boundary test: `b062919bc48ecd07fdc6977b557b13800149cf360a7eedb1656e28e029856e7e`
- `src/App.jsx`: `84ce6ef31bdb52f903c8066d6615a018e41d3d3f82418afc52fb3ce5e095a401`
- `index.html`: `259b961525ac46edb75b1d1a16694d49718b2b6b4db46ae0985a39f3e6872952`

Checkpoint: `6a8f554d3c7540d899a278e3`
Base44 commit: `13ba5ba58f0d87ea33266f69fbd83bd5e63b7100`

## Boundaries

`FOUNDATION_AUTHORITY_DELTA = ZERO`
`OPERATIONAL_WRITE_DELTA = ZERO`
`PUBLIC_BOOKING_ENDPOINT = NOT_PUBLISHED`
`GOLDEN = NOT_AUTHORIZED_BY_THIS_STEP`
`PRODUCTION = NOT_PERFORMED`
`BASE44_METADATA_RESIDUES = PREEXISTING_ISOLATED_NONOPERATIONAL`

PR #4 must remain OPEN / DRAFT / UNMERGED. Certified R3, T20 implementation, Golden governance/spec, RistoAIRen staging runtime and Corte delle Stelle production remain untouched.

## Terminal

`ARCHITECTURE_EXPLORER_V0_3_RISTOAIREN_CONNECTION = PASS_READ_ONLY_VISUALIZATION`
`RISTOAIREN_VERTICAL_CONNECTION = VERIFIED_ARCHITECTURAL_DEPENDENCY_VIEW`
`FOUNDATION_AUTHORITY = PRESERVED`
