# T20 Portable Booking — Governance Decision Gate Evidence

**Gate:** `T20-BOOKING-GOVERNANCE-DECISION-001`  
**Date:** `2026-08-26`  
**State:** `PASS_GOVERNANCE_DECISION_GATE`  
**Certified scope:** governance decisions for exact implementation specification only

## Source under test

Branch: `governance/t20-booking-decision-gate-20260826`

Pre-evidence HEAD: `bea580c8038d1614c45848a666a6cf66ebe1f59b`

Machine decision blob from authenticated GitHub read-back: `4c53717df63709d27bc0f473e475005c77296b6a`.

Acceptance test blob from authenticated GitHub read-back: `6ecde98c313d5601c152569110d2a21eea123ce6`.

## Execution

Command:

`node --test tests/governance/t20-booking-governance-decision-gate.test.js`

Execution used an isolated Node workspace materialized from the exact UTF-8 machine decision and test contents read back through the authenticated GitHub connector. No external package installation was required.

## Result

- tests: `13`
- pass: `13`
- fail: `0`
- skipped: `0`
- cancelled: `0`
- todo: `0`
- duration: approximately `86.46 ms`

Verdict: `PASS`.

## Proven governance outcomes

1. The gate authorizes only an exact implementation specification; runtime/schema/production remain blocked.
2. Foundation authority remains intact; Base44 and client Tenant/Location remain non-authoritative.
3. `RST-F-BKG-007 booking.private.query` is reserved without colliding with existing `RST-F-BKG-006 booking.checkin`.
4. `RST-F-BKG-003` requires least-privilege `booking.status.update`.
5. `responsabile` is the Slice-01 canonical role key; `responsabile_cucina` is not an implicit alias.
6. No invented Booking feature entitlement is introduced for Slice-01; AIRenOS `ristoairen` product access remains required.
7. `SecurityContext` is the accepted server-derived application context; no synthetic `TenantContext` authority is introduced.
8. Schema/RLS remain implementation-spec design work only and cannot be executed by this gate.
9. Booking idempotency semantics are Foundation-owned and fail closed on semantic key conflicts.
10. Booking audit/outbox names are typed, versioned and secret/cross-Tenant safe by contract.
11. T20 fixtures remain synthetic, deterministic and cleanable; production/Corte data is not a destructive fixture.
12. Base44 forensic material remains reference evidence, not path or implementation authority.
13. T20 remains `INCOMPLETE` with zero runtime tests; production remains blocked.

## Post-gate authorization

`IMPLEMENTATION_SPEC_AUTHORIZED = true`

`RUNTIME_IMPLEMENTATION_AUTHORIZED = false`

`SCHEMA_EXECUTION_AUTHORIZED = false`

`T20_RUNTIME_TESTS_EXECUTED = 0`

`T20_CERTIFICATION = INCOMPLETE`

`PRODUCTION_PUBLICATION = BLOCKED`

Next safe activity: prepare, machine-test and reconcile the `T20 Portable Booking Exact Implementation Specification`, including exact DTO/API, schema/migration design, RLS policy design, authentication/service identity, timeout/retry policy, idempotency persistence, audit/outbox payloads, observability, kill-switch, environment separation, rollback/DR and bounded write manifest. No runtime implementation is authorized by this evidence.
