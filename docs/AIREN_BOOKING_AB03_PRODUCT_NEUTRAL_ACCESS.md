# AB-03 — AIRen Booking Product-Neutral Access & Entitlement Cutover

Status: IMPLEMENTED / INITIAL CI FAILURE PRESERVED / CORRECTIVE CI EVIDENCE REQUIRED BEFORE GOVERNANCE CLOSURE
Protocol: RULE-DOC-20 + RULE-DOC-21

## Source authority

- AB-02 source SHA: `7cf4c36e8c36ecd7566929654880612b0bd8a5c1`.
- AB-02 source tree: `e69fad5a06d52cec0aea440cced834e1c7f83ceb`.
- Canonical Booking entitlement: `airen.booking`.
- Frozen RBL TEST compatibility entitlement: `rbl01c2.booking.external`.

## Product-neutral core

AB-03 removes the remaining RISTOAIREN authority names from `packages/booking-core`:

- `RistoProductAccessGuard` becomes `BookingProductAccessGuard`;
- `assertRistoAirenAccess` becomes `assertBookingAccess`;
- Booking command IDs become `AIREN-F-BKG-001/002/003`;
- BookingHold command IDs become `AIREN-F-BKG-HOLD-001/002/003`.

The core contains no `RST-F-BKG-*` compatibility identifiers.

## Entitlement authority

`airen.booking` is the default and canonical product entitlement. The historical key `rbl01c2.booking.external` is accepted only by the RBL non-production compatibility composition and may not be selected in production. Arbitrary entitlement substitution through the historical RISTOAIREN environment field is rejected fail-closed.

Permissions such as `booking.read`, `booking.create`, `booking.update` and `booking.status.update` remain actor-authority checks and do not replace product entitlement.

## Idempotency compatibility

New mutations persist the AIRenOS canonical function IDs. The PostgreSQL compatibility layer reads the matching historical `RST-F-BKG-*` / `RST-F-BKG-HOLD-*` alias only to preserve completed historical replay semantics. If canonical and legacy records coexist for one mutation key, or a legacy record is not safely replayable, the operation fails closed.

The first AB-03 CI execution correctly exposed that the historical database CHECK constraint admitted only the `RST-*` namespace. That failure is preserved in the AB-03 lineage; it is not rewritten or treated as PASS.

AB-03 therefore adds the governed, additive migration `20260901_001_airen_booking_product_neutral_idempotency.sql`. It does not rewrite existing idempotency rows. It extends the database constraint to accept the six canonical `AIREN-F-BKG-*` identifiers for new writes while retaining the six historical `RST-F-BKG-*` identifiers required for replay compatibility. The historical migrations remain unchanged so their governed checksums are preserved.

This prevents a namespace cutover from turning a historical retry into a second mutation while allowing new AIRenOS-owned Booking mutations to persist under the canonical namespace.

## Preserved boundaries

- `/v1/ristoairen/bookings` remains the compatibility HTTP route until AB-04.
- RISTOAIREN runtime/file names remain compatibility-adapter names until AB-04.
- No Booking database table or historical migration is renamed or rewritten.
- No Base44 app is edited.
- No Render or Stripe operation is performed.
- No production deployment is authorized.
- `main`, protected RBL, K4 and R3 are not moved.
- PR #4 remains OPEN / DRAFT / UNMERGED.

AB-03 does not authorize AB-04, AIRenPay extraction, Gate E, merge or production cutover.
