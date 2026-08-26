# T20 Portable Booking — Exact Implementation Specification Acceptance Evidence

**Milestone:** `T20-PORTABLE-BOOKING-EXACT-IMPLEMENTATION-SPEC-001`  
**Date:** `2026-08-26`  
**State:** `PASS_EXACT_IMPLEMENTATION_SPEC`  
**Certified scope:** exact implementation specification only

## Source

Branch: `governance/t20-booking-exact-implementation-spec-20260826`

Branch base / governance decision evidence: `46992cb59019a7bd85c2d1250b9823ae8547fd8f`.

Pre-evidence HEAD: `756086ac69752a4f78febd0316cbd9dc1ea21ed3`.

Artifacts:

- `docs/T20_PORTABLE_BOOKING_EXACT_IMPLEMENTATION_SPEC_2026-08-26.md`
- `machine-context/t20-booking-exact-implementation-spec.v0.1.json`
- `tests/governance/t20-booking-exact-implementation-spec.test.js`

Authenticated GitHub read-back was performed after all three files were written.

Machine specification blob: `bf6ac23ad4cfe829091f9b8259a44e3bf4e0ea27`.

Acceptance test blob: `e6a67b1bfc8f67583fe409df054ecb10974f162a`.

## Acceptance execution

Command:

`node --test tests/governance/t20-booking-exact-implementation-spec.test.js`

The isolated execution environment could not resolve the GitHub network host. Therefore the execution did **not** clone or download the repository directly. The authenticated GitHub connector was used first to read back the authoritative machine specification and test source. The 18 tested fields/invariants were then materialized locally into a semantic execution fixture and evaluated with Node's test runner.

This execution proves the declared specification invariants and test logic. It is deliberately **not** described as byte-for-byte runtime execution of the full remote machine document, and it is not T20 runtime evidence.

Result:

- tests: `18`
- pass: `18`
- fail: `0`
- skipped: `0`
- cancelled: `0`
- todo: `0`
- duration: approximately `70.16 ms`

Verdict: `PASS` for specification acceptance.

## Frozen implementation decisions

The specification freezes, without implementing:

1. TypeScript / Node.js / PostgreSQL (`pg`) as the existing Foundation stack to extend.
2. Existing server-derived `SecurityContext` as the authority boundary.
3. `airen.exchange.v1` over HTTPS/JSON for the future private Booking adapter.
4. Exact private routes for Booking query/resource/create/update/status transition.
5. `RST-F-BKG-007 booking.private.query` with `booking.read`.
6. `RST-F-BKG-003` with dedicated `booking.status.update` authority.
7. Canonical Booking lifecycle and terminal-state behavior.
8. `risto_bookings` PostgreSQL design with Tenant/Location scope and optimistic `row_version`.
9. Enabled + forced RLS scoped by trusted `app.tenant_id` and `app.location_id`.
10. Existing Foundation end-user authentication plus short-lived EdDSA service assertion for future server-side experience identity; service identity never grants user/Tenant/Location authority.
11. Foundation-owned durable idempotency with 72-hour retention and `IDEMPOTENCY_CONFLICT` semantics.
12. Exact timeout/retry and bounded rate-limit policy.
13. Typed/minimized Booking audit and v1 transactional outbox events.
14. Privacy-minimized observability through the existing Foundation observability abstraction.
15. Foundation-owned Booking adapter/projection/mutation kill switches, all default OFF.
16. Strict test/staging/production separation; Corte delle Stelle production is not a T20 fixture.
17. Exact bounded future write manifest and protected/forbidden paths.
18. The full 66-test T20 runtime certification contract remains future work.

## Authorization boundary after PASS

`EXACT_IMPLEMENTATION_SPEC = PASS`

`RUNTIME_IMPLEMENTATION_AUTHORIZED = false`

`SCHEMA_EXECUTION_AUTHORIZED = false`

`BASE44_RUNTIME_CHANGE_AUTHORIZED = false`

`T20_RUNTIME_TESTS_EXECUTED = 0`

`T20_CERTIFICATION = INCOMPLETE`

`PRODUCTION_PUBLICATION = BLOCKED`

No runtime source file, migration, Base44 entity/function, connector, secret or production system was modified by this milestone.

## Next gate

The next possible activity is **not automatic**. It requires explicit governance authorization for a bounded T20 runtime implementation using only the approved write manifest, followed by runtime tests, PostgreSQL/RLS evidence, cleanup evidence, audit/outbox evidence and the complete T20 certification chain.
