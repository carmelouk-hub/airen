# AB-01 — AIRen Booking Product Boundary & Structural Extraction Plan

Status: AUTHORIZED / DESIGN-CENSUS ONLY / NO RUNTIME MUTATION
Protocol: RULE-DOC-20 + RULE-DOC-21

## 1. Objective

Align the implementation topology with ADR-016 without changing certified behavior. Booking Core becomes an AIRenOS-owned domain package productized commercially as AIRen Booking. RISTOAIREN becomes an entitled hospitality consumer. AIRenPay remains independent and optional. Base44 remains a presentation and server-side bridge layer only.

## 2. Reconciled authority baseline

- AIRen Booking governance branch before AB-01: `1988ba13a4917c845a11e38242a8c04e8d80897d`.
- AIRenPay D5 implementation/deployed source: `cd40f911ef7761341afe41cfee28f20799616666`.
- RISTOAIREN RBL head: `d055fba86d938aa38cee648171425046c7d972a4`.
- R3 certified head: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- Protected `main`: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`.
- PR #4 remains OPEN / DRAFT / UNMERGED.
- Gate E remains NOT OPEN. ADR-016 remains NOT RUNTIME-CERTIFIED.

## 3. Current implementation census

### 3.1 Booking domain currently under RISTOAIREN

- `packages/ristoairen/src/booking/contracts.ts`
- `packages/ristoairen/src/booking/policy.ts`
- `packages/ristoairen/src/booking/application-service.ts`
- `packages/ristoairen/src/booking/hold-contracts.ts`
- `packages/ristoairen/src/booking/hold-policy.ts`
- `packages/ristoairen/src/booking/hold-application-service.ts`
- `packages/ristoairen/src/booking/index.ts`

Observed vertical coupling includes `RistoProductAccessGuard.assertRistoAirenAccess`, RST-prefixed idempotency function identifiers and imports from the RISTOAIREN package path.

### 3.2 API and runtime adapters currently RISTOAIREN-named

- `apps/api/src/ristoairen-booking-api.ts`
- `apps/api/src/ristoairen-booking-runtime.ts`
- `apps/api/src/ristoairen-booking-hold-runtime.ts`

The certified route is `/v1/ristoairen/bookings`. It is a compatibility surface, not proof that RISTOAIREN owns Booking Core.

### 3.3 PostgreSQL implementation

- `packages/persistence-postgres/src/risto-booking-repository.ts`
- `packages/persistence-postgres/src/risto-booking-hold-repository.ts`
- `packages/persistence-postgres/src/risto-booking-hold-lifecycle.ts`
- `packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql`
- `packages/persistence-postgres/src/migrations/20260829_001_risto_booking_holds.sql`

Existing table, migration and canonical function identifiers are certified physical compatibility identifiers. AB-01 does not authorize destructive rename or history rewrite.

### 3.4 AIRenPay currently under RISTOAIREN

- `packages/ristoairen/src/airenpay/contracts.ts`
- `packages/ristoairen/src/airenpay/policy.ts`
- `packages/ristoairen/src/airenpay/authorization-expiry-policy.ts`
- `packages/ristoairen/src/airenpay/persistence-contracts.ts`
- `packages/ristoairen/src/airenpay/index.ts`

AIRenPay currently imports Booking guarantee types directly. The target boundary must invert this dependency: Booking Core expresses a provider-neutral payment/guarantee requirement; AIRenPay implements the optional capability interface.

### 3.5 Base44 read-only live inventory

- Canonical RISTOAIREN Base44 app: `6a9034a05aadd6259d2d88e3`.
- Server-side bridge: `base44/functions/airenBookingBridge/entry.ts`.
- Booking experience: `src/components/booking/BookingExperience.jsx`.
- Historical truth map: `src/lib/booking-truth.js`.
- Base44 schemas contain only the built-in `User` extension; no Booking entity or parallel Booking database exists.
- The bridge authenticates the Base44 user, creates short-lived user and service assertions and invokes AIRenOS server-side.
- Booking mutations remain guarded by `AIREN_BOOKING_MUTATIONS_ENABLED`.
- The bridge currently hard-codes the RISTOAIREN endpoint and `/v1/ristoairen/bookings` path.
- `booking-truth.js` still points to the historical T20 branch and contains statements superseded by the certified real read-only connection.

## 4. Target topology

### 4.1 AIRenOS-owned packages

- `packages/booking-core`: vertical-neutral Booking, BookingHold, capacity, availability, policy, lifecycle, audit/outbox and repository ports.
- `packages/airenpay`: provider-neutral payment, guarantee and transaction orchestration capability.
- `packages/integrations`: concrete provider adapters such as Stripe TEST; no product ownership.

### 4.2 Vertical package

- `packages/ristoairen`: hospitality mappings, table/cover/service semantics, RISTOAIREN packaging and compatibility adapters only.
- RISTOAIREN may not contain a private Booking Core or AIRenPay fork.

### 4.3 API compatibility

- Add a future AIRen Booking canonical API boundary under an AIRenOS-owned name.
- Preserve `/v1/ristoairen/bookings` temporarily as a tested compatibility adapter delegating to the same Booking Core.
- Do not perform a breaking route, database table, event or idempotency identifier rename during extraction.

## 5. Product, entitlement and authority contract

- Canonical AIRen Booking product entitlement target: `airen.booking`.
- Canonical optional AIRenPay entitlement target: `airen.pay`.
- Historical `rbl01c2.booking.external` remains a non-production proof key and is not the commercial product key.
- Permission keys such as `booking.read`, `booking.create`, `booking.update` and `booking.status.update` remain actor-authority checks and must never substitute entitlement resolution.
- RISTOAIREN package inclusion means the tenant receives `airen.booking`; it does not change Booking Core ownership.
- AIRenPay invocation additionally requires entitlement, tenant configuration and BookingPolicy/payment requirement.
- Base44 authentication cannot grant either entitlement.

## 6. Base44 treatment

Base44 work is required, but not in AB-01 and not as a rebuild.

Later controlled work must:

- preserve app `6a9034a05aadd6259d2d88e3` and the server-side bridge model;
- keep AIRenOS as Identity, Tenant, Location, membership, entitlement and Booking authority;
- update labels to show AIRen Booking as an entitled product included in RISTOAIREN;
- replace stale truth-map metadata with the new canonical ownership and live evidence;
- point the bridge to the canonical AIRen Booking API when available, retaining the certified legacy route until compatibility proof passes;
- keep secrets server-side and bearer/service credentials out of browser persistence;
- keep mutation disabled until Gate E is separately authorized and proved.

## 7. Governed implementation sequence

1. AB-02 — create `packages/booking-core` and extract the seven Booking domain files without behavior change.
2. AB-03 — introduce a product-neutral access guard and canonical `airen.booking` entitlement while preserving the RBL entitlement as test-only compatibility.
3. AP-01 — create `packages/airenpay`, move provider-neutral AIRenPay contracts/policy and remove RISTOAIREN ownership.
4. AB-04 — add AIRen Booking API/runtime naming and keep the RISTOAIREN route as a compatibility adapter.
5. AB-05 — update the existing Base44 bridge and Booking experience; do not create Booking entities in Base44.
6. Gate E — execute Direct Booking E2E only after separate authorization, covering no-payment and optional AIRenPay modes, concurrency, abandonment, expiry/release, conversion-once, entitlement and audit.

Each step requires its own pre-write RULE-DOC-20/21 reconciliation, exact-file boundary, tests, remote read-back and post-write cross-source reconciliation.

## 8. Explicit non-authorization

AB-01 does not authorize application code movement, schema migration, API publication, Base44 edit, secret change, Render configuration, provider call, payment mutation, Gate E opening, PR merge, protected-branch movement, production deployment or Corte delle Stelle change.

## 9. AB-01 decision state

`AB01_CENSUS = COMPLETE`
`BOOKING_CORE_TARGET_OWNER = AIRENOS`
`RISTOAIREN_RELATION = ENTITLED_HOSPITALITY_CONSUMER`
`AIRENPAY_TARGET_OWNER = AIRENOS_INDEPENDENT_OPTIONAL_CAPABILITY`
`BASE44_ROLE = PRESENTATION_AND_SERVER_SIDE_BRIDGE_ONLY`
`BASE44_CHANGE_IN_AB01 = NONE`
`GATE_E = NOT_OPEN`
`PRODUCTION_CHANGE = NONE`
