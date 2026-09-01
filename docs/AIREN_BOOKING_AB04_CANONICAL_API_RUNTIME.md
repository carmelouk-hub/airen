# AB-04 — AIRen Booking Canonical API & Runtime Naming

Status: IMPLEMENTED / CI EVIDENCE REQUIRED BEFORE GOVERNANCE CLOSURE
Protocol: RULE-DOC-20 + RULE-DOC-21

## Base authority

- Source baseline: AB-03 final SHA `cec3012dafff29765b934efa5e6d86a546f066e6`.
- Source tree: `c9e0183b455a35b20140f8d4d990bb35fd50b6b1`.
- AB-03: CLOSED / PASS.
- Protected RBL: `d055fba86d938aa38cee648171425046c7d972a4`.
- Protected K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`.
- Protected R3: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- `main`: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`.
- PR #4 must remain OPEN / DRAFT / UNMERGED.

## Canonical API authority

AB-04 publishes the product-neutral AIRen Booking API surface at:

`/v1/bookings`

The path is deliberately resource-first and contains no RISTOAIREN ownership token. The already-certified `/v1/ristoairen/bookings` surface remains available only as an explicit compatibility alias in this gate. Both paths resolve into the same Booking authority and cannot create a second domain implementation.

Prefix matching is boundary-safe: `/v1/bookings-evil` is not an AIRen Booking route.

## Canonical runtime authority

Canonical runtime files and symbols are introduced under `apps/api/src/airen-booking-*`:

- `airen-booking-api.ts`
- `airen-booking-runtime.ts`
- `airen-booking-hold-runtime.ts`

The pre-AB-04 implementations are retained byte-identically as internal `*-core.ts` snapshots so the naming cutover does not silently rewrite certified behavior. The old `ristoairen-booking-*` API/runtime files become thin compatibility bindings to the AIRen Booking surfaces.

Canonical runtime environment keys are:

- `AIREN_BOOKING_ADAPTER_ENABLED`
- `AIREN_BOOKING_PROJECTION_ENABLED`
- `AIREN_BOOKING_MUTATION_ENABLED`
- `AIREN_BOOKING_SERVICE_PUBLIC_KEYS_JSON`
- `AIREN_BOOKING_CURSOR_HMAC_KEY_SECRET_REF`
- `AIREN_BOOKING_REQUIRED_ENTITLEMENT`
- `AIREN_BOOKING_HOLD_RUNTIME_ENABLED`
- `AIREN_BOOKING_HOLD_EXPIRY_WORKER_ENABLED`
- `AIREN_BOOKING_HOLD_EXPIRY_INTERVAL_SECONDS`
- `AIREN_BOOKING_HOLD_EXPIRY_BATCH_LIMIT`

Historical `RISTOAIREN_BOOKING_*` keys remain accepted only as compatibility aliases. When canonical and compatibility aliases are supplied together with different values, configuration fails closed with `RUNTIME_CONFIGURATION_INVALID`.

## Preserved boundaries

- Booking Core remains `packages/booking-core`; no Booking fork is introduced.
- `airen.booking` remains the canonical entitlement.
- Historical idempotency compatibility remains unchanged.
- PostgreSQL tables, migrations, repositories and persisted identifiers are not renamed by AB-04.
- AIRenPay is not extracted or modified.
- `/v1/ristoairen/bookings` is not retired; retirement requires a separately authorized gate.
- Existing RBL TEST activation constraints remain fail closed, including the production activation prohibition.
- Base44 is not modified.
- Render and Stripe are not touched.
- Corte delle Stelle production is not touched.
- `main`, RBL, K4 and R3 protected boundaries are not moved.
- PR #4 remains OPEN / DRAFT / UNMERGED.
- Gate E is not opened by AB-04.

## Evidence contract

The existing Foundation and OCI regressions remain mandatory. The RBL-01 HTTP wiring test additionally proves:

1. `/v1/bookings` is the canonical AIRen Booking route;
2. `/v1/ristoairen/bookings` remains an explicit compatibility route;
3. canonical route prefix matching is boundary-safe;
4. canonical AIRen Booking runtime switches default deny;
5. canonical env names preserve existing fail-closed production/configuration behavior;
6. conflicting canonical/compatibility env aliases fail closed;
7. the historical server bindings route through compatibility wrappers whose declared authority is the canonical AIRen Booking surface.

AB-04 can be marked CLOSED / PASS only after exact-SHA Foundation + OCI success, governed Drive closure, remote read-back and final dual-source reconciliation.
