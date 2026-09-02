# AIRen Booking — AB-05 Base44 Bridge / Experience Migration Evidence

Date: 2026-09-02
Repository: `carmelouk-hub/airen`
Evidence branch: `rbl/airen-booking-ab05-base44-bridge-migration-20260902`

## 1. Governance authority

AB-05 was explicitly authorized by the user on 2026-09-02 after AP-01 had been reported and reconciled as CLOSED / PASS.

Before every governed write, live GitHub + Google Drive reconciliation was performed under RULE-DOC-20 / RULE-DOC-21. After every governed write, remote read-back and cross-source reconciliation were performed. All reconciliations used fail-closed semantics.

This evidence record supports AB-05 closure. Canonical closure status is determined by the authoritative Drive Handoff / Platform Bible registration performed after this GitHub evidence write.

## 2. Integration baseline

AP-01 integration baseline:

- branch: `rbl/airenpay-ap01-product-neutral-extraction-20260902`
- SHA: `932c474723dfd4debda72d29a989c61f36bbbd5e`
- tree: `f9fb131a4f87b24a588da33dfa3ca34cd68b5831`

AB-04 canonical AIRen Booking authority:

- branch: `rbl/airen-booking-ab04-canonical-api-runtime-20260901`
- SHA: `43dbf6cd1b814f5dedd507a44aeccbf69c565899`
- tree: `ac1a71ed47a25293ff82506445cb1dcfa8530b23`
- Foundation run: `33616191418` — SUCCESS
- OCI staging run: `33616191457` — SUCCESS
- canonical API: `/v1/bookings`
- compatibility API: `/v1/ristoairen/bookings`
- entitlement target: `airen.booking`

## 3. Base44 governed scope

Canonical Base44 app:

- app ID: `6a9034a05aadd6259d2d88e3`
- role: Experience Layer + authenticated server-side bridge only
- Booking authority / source of truth: AIRenOS, not Base44

Pre-migration checkpoint:

- checkpoint ID: `6a97fff2b9b4af9b37f57d3e`
- Base44 commit: `951e6f814a7c9c13ab651b9fc1c5b40115ec9a2e`

Validated post-migration checkpoint:

- checkpoint ID: `6a98030bff3c7f72ec152926`
- Base44 commit: `493d2bd4c1d95fba9c5e6a8d1831736470c53647`

Exact Base44 delta from pre-checkpoint to validated checkpoint:

- 4 files changed
- 64 insertions
- 43 deletions

Files:

1. `base44/functions/airenBookingBridge/entry.ts`
2. `src/components/booking/BookingExperience.jsx`
3. `src/components/booking/BookingTruthMap.jsx`
4. `src/lib/booking-truth.js`

## 4. Bridge migration contract

The Base44 bridge now uses canonical-first routing:

1. request canonical AIRen Booking route `/v1/bookings`;
2. use `/v1/ristoairen/bookings` only when the canonical upstream response is HTTP 404;
3. preserve the existing authenticated server-side bridge boundary;
4. preserve the mutation gate `AIREN_BOOKING_MUTATIONS_ENABLED`;
5. expose selected routing through response header `x-airen-booking-route`;
6. preserve `SERVICE_SUBJECT = "ristoairen-booking-bridge"` intentionally, because changing the assertion subject was outside AB-05 scope and could break upstream authentication continuity.

No hard cutover was performed because the connected staging runtime currently does not expose the canonical route.

Observed connected staging behavior, read-only probe:

- GET `/v1/bookings` → HTTP 404 `not_found`
- GET `/v1/ristoairen/bookings` → HTTP 401 `AUTHENTICATION_REQUIRED`

This proves that the legacy compatibility route still exists while the canonical route is not yet published by that connected Render runtime. Render itself was not modified by AB-05.

## 5. Truth-map / Experience migration

Obsolete T20 / RISTOAIREN ownership metadata in the Base44 Booking experience was replaced by current AIRen Booking canonical metadata derived from AB-04 and the AP-01 integration baseline.

The Base44 experience now identifies:

- AIRen Booking canonical ownership;
- `/v1/bookings` as canonical API;
- `/v1/ristoairen/bookings` as compatibility API;
- `airen.booking` as entitlement target;
- AIRenOS as the sole Booking authority;
- Base44 as read-only Experience Layer / bridge in the authorized scope;
- production and Corte delle Stelle usage as NOT AUTHORIZED.

Physical compatibility names in certified persistence/schema history were not rewritten.

## 6. Validation evidence

Validation against the Base44 checkout at `/app`:

- `npm run lint` — PASS
- `npm run build` — PASS
- static AB-05 bridge contract checks — PASS
  - canonical path present
  - compatibility path present
  - canonical-first order verified
  - compatibility fallback only on HTTP 404 verified
  - mutation gate preserved
  - legacy service subject preserved
  - route observability header present

Global TypeScript check remains red because of inherited pre-existing diagnostics outside the AB-05 files. This was not classified as an AB-05 failure or as a global PASS. A detached worktree at the pre-migration checkpoint was typechecked with the same toolchain and compared with the current checkout:

- pre-checkpoint global typecheck exit: 2
- post-migration global typecheck exit: 2
- complete diagnostic diff: zero
- errors referencing any of the four AB-05 changed files: zero

Therefore the AB-05 typecheck diagnostic delta is ZERO; existing unrelated type debt is preserved rather than rewritten.

## 7. Data / authority boundary verification

Base44 entity schemas were read before and after AB-05. The only visible entity is the built-in `User` entity.

AB-05 created no Base44 `Booking` entity, no Booking database, no parallel backend authority and no source-of-truth fork.

No changes were made to:

- Render configuration or deployment
- Stripe
- provider configuration
- database / schema / migrations
- production
- Corte delle Stelle production
- real-money flows
- commercial cutover
- AIRenPay commercial cutover

No real booking mutation was executed.

## 8. Protected-boundary reconciliation

Protected boundaries remained unchanged during AB-05:

- RBL `rbl/ristoairen-real-baseline-01-20260827` → `d055fba86d938aa38cee648171425046c7d972a4`
- K4 `kairos/k4-interactive-map-base44-20260830` → `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`
- R3 `r3/control-plane-20260822` → `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- `main` → `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`
- AP-01 integration baseline → `932c474723dfd4debda72d29a989c61f36bbbd5e`

PR #4 remains OPEN / DRAFT / UNMERGED with head `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.

## 9. Explicit non-authorizations

AB-05 does not authorize:

- deployment of `/v1/bookings` to the connected Render staging service;
- removal of the compatibility route;
- Base44 Booking persistence;
- mutation enablement;
- production publication;
- Corte delle Stelle production cutover;
- Stripe or money movement;
- commercial cutover;
- K5 or any subsequent gate.

Any next governed gate requires a fresh dual-source reconciliation and separate explicit user authorization.
