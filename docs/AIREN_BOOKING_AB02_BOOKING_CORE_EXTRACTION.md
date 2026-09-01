# AB-02 — AIRen Booking Core Structural Extraction

Status: IMPLEMENTED / CI EVIDENCE REQUIRED BEFORE GOVERNANCE CLOSURE
Protocol: RULE-DOC-20 + RULE-DOC-21

## Base authority

- Source baseline: AIRenPay D5 exact SHA `cd40f911ef7761341afe41cfee28f20799616666`.
- AB-01 plan authority: `f0f97901e589a2ca30c61d2f9af6f7fc032819fc`.
- Protected RBL: `d055fba86d938aa38cee648171425046c7d972a4`.
- Protected K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`.
- Protected R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- `main`: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`.
- PR #4 must remain OPEN / DRAFT / UNMERGED.

## Implementation boundary

AB-02 moves the existing Booking domain implementation into the AIRenOS-owned `packages/booking-core/src` boundary:

1. `contracts.ts`
2. `policy.ts`
3. `application-service.ts`
4. `hold-contracts.ts`
5. `hold-policy.ts`
6. `hold-application-service.ts`
7. `index.ts`

The corresponding `packages/ristoairen/src/booking/*` paths are retained only as compatibility re-exports to the AIRenOS-owned implementation. Existing consumers therefore keep the same import compatibility and runtime binding while physical product ownership moves out of RISTOAIREN.

## Behavior-preservation boundary

AB-02 intentionally does not neutralize product access or rename historical identifiers. The extracted core still contains `RistoProductAccessGuard.assertRistoAirenAccess` and the certified `RST-F-BKG-*` / `RST-F-BKG-HOLD-*` idempotency identifiers. Those are known temporary coupling debt assigned to AB-03.

No API route, PostgreSQL table, migration, SQL function, audit event, outbox event or idempotency identifier is renamed by AB-02. `/v1/ristoairen/bookings` remains an unchanged compatibility surface.

AIRenPay remains physically untouched in AB-02 and continues to resolve Booking types through the preserved RISTOAIREN compatibility path until AP-01.

Base44 app `6a9034a05aadd6259d2d88e3` is not modified. Render, Stripe and production are not touched.

## Regression evidence contract

The historical T20 Booking contract remains unchanged in behavioral assertions and continues to exercise the legacy RISTOAIREN import surface, which now delegates to `packages/booking-core`. AB-02 adds structural assertions proving that:

- the canonical `packages/booking-core` export surface exists;
- RISTOAIREN compatibility exports are the exact same runtime bindings, preventing a Booking fork;
- each historical RISTOAIREN Booking file contains only the expected compatibility re-export;
- temporary RISTOAIREN access/idempotency tokens remain present until AB-03.

Existing RBL02-RBL14, T20 PostgreSQL/security/cleanup and RBL HTTP/OCI regressions remain required by the branch CI.

## Non-authorization

AB-02 does not authorize AB-03, AP-01, AB-04, AB-05, Gate E, database migration, canonical API publication, Base44 editing, secret changes, provider operations, protected-branch movement, PR merge or production deployment.
