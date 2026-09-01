# AB-03 — AIRen Booking Product-Neutral Access & Entitlement Cutover

Status: IMPLEMENTED / FOUR FOUNDATION FAILURES PRESERVED / CORRECTIVE #4 CI EVIDENCE REQUIRED BEFORE GOVERNANCE CLOSURE
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

New Booking mutations persist the AIRenOS canonical function IDs. The PostgreSQL compatibility layer reads the matching historical `RST-F-BKG-*` / `RST-F-BKG-HOLD-*` alias only to preserve completed historical replay semantics. If canonical and legacy records coexist for one mutation key, or a legacy record is not safely replayable, the operation fails closed.

Four Foundation failures are preserved in the AB-03 implementation lineage and are not rewritten or treated as PASS. The first exposed that the historical database CHECK constraint admitted only the `RST-*` Booking namespace. Subsequent failures exposed compatibility fixtures and migration-order interactions that still reasserted historical authority after the Booking cutover.

AB-03 adds the governed, additive migration `20260901_001_airen_booking_product_neutral_idempotency.sql`. It does not rewrite existing idempotency rows. It extends the database constraint to accept the six canonical `AIREN-F-BKG-*` identifiers for new writes while retaining the six historical Booking/Hold `RST-F-BKG-*` identifiers required for replay compatibility.

The historical AIRenPay migration `20260829_002_risto_airenpay.sql` is intentionally left unchanged to preserve its governed checksum. That historical migration reasserts the idempotency constraint and includes the still-unextracted `RST-F-PAY-001` identifier used by the AIRenPay persistence layer.

AB-03 corrective #4 therefore adds a second additive finalizer migration, `20260901_002_airen_booking_product_neutral_idempotency_airenpay_compat.sql`, applied after the historical AIRenPay migration and the AB-03 `001` migration. The final constraint is a compatibility superset containing the six AIRenOS canonical Booking/Hold IDs, the six historical Booking/Hold replay aliases, and `RST-F-PAY-001` until AIRenPay is extracted under its own separately authorized gate.

Neither the historical AIRenPay migration nor AB-03 migration `001` is rewritten. This preserves governed checksums, keeps new Booking writes in the AIRenOS namespace, preserves historical Booking/Hold replay safety, and avoids prematurely changing AIRenPay authority inside AB-03.

## Preserved boundaries

- `/v1/ristoairen/bookings` remains the compatibility HTTP route until AB-04.
- RISTOAIREN runtime/file names remain compatibility-adapter names until AB-04.
- No Booking database table or historical migration is renamed or rewritten.
- AIRenPay extraction is not performed by AB-03.
- No Base44 app is edited.
- No Render or Stripe operation is performed.
- No production deployment is authorized.
- `main`, protected RBL, K4 and R3 are not moved.
- PR #4 remains OPEN / DRAFT / UNMERGED.

AB-03 remains OPEN until the exact corrective #4 SHA passes the required Foundation and OCI evidence and the resulting state is registered through RULE-DOC-20/21 governance. AB-03 does not authorize AB-04, AIRenPay extraction, Gate E, merge or production cutover.
