# AP-01 — AIRenPay Product-Neutral Structural Extraction

Status: IMPLEMENTATION CANDIDATE / LOCAL APPLICATION PASS / REMOTE CI REQUIRED / NOT CLOSED

Protocol: RULE-DOC-20 + RULE-DOC-21

## Source authority

- Explicit AP-01 user authorization: received 2026-09-02.
- Source branch: `rbl/airen-booking-ab04-canonical-api-runtime-20260901`.
- Source SHA: `43dbf6cd1b814f5dedd507a44aeccbf69c565899`.
- Source tree: `ac1a71ed47a25293ff82506445cb1dcfa8530b23`.
- Working branch: `rbl/airenpay-ap01-product-neutral-extraction-20260902`.
- Canonical handoff: Drive `1cLTVhQDg9Zkv9ZklwU7PGbTBYsOLAg5x4_1aA2yVZNA`, tab `t.0`, terminal §32 AB-04 CLOSED / PASS.
- Detailed architecture: Drive `1c4O5bsu00OyG-qw_cSnq84VD8DH68FaYzPqxhW5E67A`.

The pre-write read observed a changed Google Docs opaque revision token while Drive revision `28`, modification time `2026-09-02T09:54:39.599Z`, paragraph count and normalized full text remained identical to the stored revision and terminal §32. GitHub authority, protected boundaries and PR #4 all matched. This was reconciled as token rotation without a document-content or Drive-version change; no mismatch was ignored.

## Authorized result

AP-01 establishes `packages/airenpay` as the AIRenOS-owned home of provider-neutral AIRenPay contracts and policy. RISTOAIREN remains an entitled hospitality consumer and compatibility surface; it no longer physically owns an AIRenPay implementation.

The canonical optional entitlement target is exported as `AIREN_PAY_ENTITLEMENT = "airen.pay"`. AP-01 does not activate that entitlement, invoke AIRenPay, connect Direct Booking to a provider or open Gate E.

## Dependency direction

- `packages/airenpay` may depend on AIRenOS shared contracts and the provider-neutral guarantee types owned by `packages/booking-core`.
- `packages/airenpay` may not depend on RISTOAIREN or a provider SDK.
- Concrete provider adapters remain in `packages/integrations` and consume the canonical AIRenPay package.
- PostgreSQL persistence remains an adapter and consumes the canonical AIRenPay package.
- `packages/ristoairen/src/airenpay` contains exact compatibility re-exports only.

## Exact implementation file census

Created:

- `packages/airenpay/README.md`
- `packages/airenpay/src/authorization-expiry-policy.ts`
- `packages/airenpay/src/contracts.ts`
- `packages/airenpay/src/index.ts`
- `packages/airenpay/src/persistence-contracts.ts`
- `packages/airenpay/src/policy.ts`
- `tests/integration/ap01-airenpay-extraction.test.ts`
- `docs/AIRENPAY_AP01_PRODUCT_NEUTRAL_EXTRACTION.md`

Modified as compatibility adapters, ownership descriptions, test wiring or canonical import cutovers:

- `package.json`
- `packages/ristoairen/README.md`
- `packages/ristoairen/src/airenpay/authorization-expiry-policy.ts`
- `packages/ristoairen/src/airenpay/contracts.ts`
- `packages/ristoairen/src/airenpay/index.ts`
- `packages/ristoairen/src/airenpay/persistence-contracts.ts`
- `packages/ristoairen/src/airenpay/policy.ts`
- `packages/persistence-postgres/src/risto-airenpay-repository.ts`
- `packages/integrations/src/stripe-airenpay-test-adapter.ts`
- `packages/integrations/src/stripe-airenpay-test-http-client.ts`
- `deploy/prove-stripe-airenpay-test-authorization-capture.ts`
- `deploy/prove-stripe-airenpay-test-authorization-expiry-readback.ts`
- `deploy/prove-stripe-airenpay-test-authorization-hold.ts`
- `deploy/prove-stripe-airenpay-test-authorization-release.ts`
- `deploy/prove-stripe-airenpay-test-payment-intent.ts`
- `deploy/prove-stripe-airenpay-test-refund-readback-recovery.ts`
- `deploy/prove-stripe-airenpay-test-refund.ts`
- `deploy/prove-stripe-airenpay-test-setup.ts`
- `deploy/stripe-airenpay-test-authorization-proof-client.ts`
- `tests/integration/rbl04-airenpay-contract.test.ts`
- `tests/integration/rbl05-stripe-airenpay-test-adapter.test.ts`
- `tests/integration/rbl06-stripe-airenpay-test-http-client.test.ts`
- `tests/integration/rbl09-stripe-airenpay-test-authorization-hold-runner-boundary.test.ts`
- `tests/integration/rbl10-stripe-airenpay-test-authorization-release-runner-boundary.test.ts`
- `tests/integration/rbl11-stripe-airenpay-test-authorization-capture-runner-boundary.test.ts`
- `tests/integration/rbl12-stripe-airenpay-test-refund-runner-boundary.test.ts`
- `tests/integration/rbl13-stripe-airenpay-test-refund-readback-recovery-boundary.test.ts`
- `tests/integration/rbl14-stripe-airenpay-test-authorization-expiry-readback-boundary.test.ts`

No other file is in the AP-01 implementation boundary.

## Compatibility and historical evidence

AP-01 changes physical and architectural ownership without changing AIRenPay behavior. Existing contract, policy, provider-adapter and persistence regressions must remain green through the exact same runtime bindings.

Certified historical PostgreSQL tables, migrations, event names, module names and `RST-F-PAY-001` are not renamed or rewritten. They remain compatibility evidence under the frozen extraction contract. Any replacement of those historical runtime identifiers requires a separately authorized, additive and independently proven gate.

No AIRenPay provider request is executed by AP-01. Existing proof runners remain explicit opt-in, TEST-only and fail closed without their governed flags and SecretRef material.

## Local evidence before publication

- AP-01 structural ownership tests: 4 / 4 PASS.
- Boundary check: PASS.
- T20 Booking and AIRenPay contract chain: PASS.
- Existing AIRenPay provider-neutral contract: 15 / 15 PASS.
- Existing Stripe TEST adapter and HTTP-client suites: PASS.
- Existing TEST proof-runner boundary suites: PASS.
- AIRen Booking HTTP wiring regression: 9 / 9 PASS.

Local evidence is not CI authority. AP-01 remains NOT PASS / NOT CLOSED until Foundation and OCI staging complete successfully on the same exact published SHA and the final RULE-DOC-20/21 remote read-back and governance append are complete.

## Explicit non-effects

- Base44 change: NONE.
- AIRen Booking API/runtime change: NONE.
- Database migration or schema change: NONE.
- Historical database identifier rewrite: NONE.
- Render operation: NONE.
- Stripe/provider operation: NONE.
- Secret value exposure or movement: NONE.
- Real money movement: NONE.
- Production change: NONE.
- Corte delle Stelle production change: NONE.
- Protected RBL, K4, R3 or `main` movement: NONE.
- PR #4 merge/state change: NONE.
- Gate E opening: NONE.
- K5 authorization: NONE.
- AB-05 authorization: NONE.
