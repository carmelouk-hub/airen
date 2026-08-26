# Golden Restaurant E2E — Readiness Freeze — 2026-08-26

Milestone: `GOLDEN-E2E-READINESS-FREEZE-001`

Artifact class: `GOVERNED_DESIGN_NOT_CERTIFICATION`

Source authority: DOC-015 — Golden Restaurant E2E Specification — v0.1.

Upstream prerequisite evidence: `T20-PORTABLE-BOOKING-SLICE-01 = PASS_BOUNDED_T20_SLICE_01`.

## 1. Purpose

Freeze the first post-T20 Golden Restaurant E2E governance gate without pretending that the full restaurant journey is already implemented.

DOC-015 defines the terminal Golden journey as:

`Public Discovery -> Booking -> Customer -> Arrival -> Check-In -> Table -> ServiceSession -> Order -> Production Routing -> Kitchen/Bar -> Ready -> Serve -> Bill -> Payment -> Close -> CRM Update -> Analytics/Event -> Audit -> STELLA Observation/Insight`.

The current portable runtime has certified Booking Slice-01 only. Therefore the full 45-point Golden Acceptance Foundation is not yet executable as one certification run.

## 2. Hard boundaries

- Corte delle Stelle remains PRODUCTION reference showcase and is never a destructive Golden fixture.
- Golden uses a synthetic permanent `DEMO / CERTIFICATION` Tenant.
- T20 `TEST_TEMPORARY` fixtures are not reused as Golden permanent fixtures.
- No production publication, Base44 runtime promotion, Corte migration/cutover, R3 merge or production feature enablement is authorized by this gate.
- No capability marked RESERVED_NEXT may be treated as Golden baseline.
- A UI-only PASS never constitutes Golden evidence.

## 3. Readiness classification of DOC-015 acceptance foundation

### Group A — prerequisite now satisfied

- Security prerequisite: T20 Booking Slice-01 has bounded runtime PASS with Tenant/Location isolation, authentication, RLS, idempotency, audit/outbox and cleanup evidence.

### Group B — partially implemented but not yet Golden-executable

The portable runtime now contains Booking domain capability sufficient to support future portions of:

- `GR-T02` Public booking creates same-Tenant reservation — NOT READY because the certified Slice-01 private boundary is not yet wired as a published/public HTTP route and public discovery/domain-resolution ingress is not implemented by this slice.
- `GR-T03` Booking appears to authorized staff — PARTIAL: private scoped Booking query exists and is tested, but no Golden actor/UI/browser journey is yet certified.
- Booking lifecycle evidence supports future GR-02 preparation, but Table, ServiceSession and check-in convergence are not implemented in this slice.

### Group C — blocked by missing domain implementations

`GR-T01` and `GR-T04` through `GR-T45` remain `NOT_EXECUTABLE_FOR_FULL_GOLDEN_CERTIFICATION` unless their required domains and environment controls exist and are separately proven.

This is not a failure. It is an implementation-readiness classification.

## 4. First Golden execution level

The first executable Golden milestone is frozen as `GOLDEN-G0-BOOTSTRAP`, not as full Golden PASS.

Mandatory goals for `GOLDEN-G0-BOOTSTRAP`:

1. create a synthetic permanent Golden Tenant in a non-production DEMO/CERTIFICATION environment;
2. create at least two synthetic Locations so location isolation can be exercised from the beginning;
3. provision real test identities/memberships using canonical roles that already exist in Foundation;
4. define reset semantics that cannot touch production or T20 fixtures;
5. wire only the already-certified Booking capability into the Golden environment through a bounded test ingress;
6. prove authenticated Tenant/Location context resolution, Booking create/query visibility and audit correlation end-to-end without Base44 authority;
7. produce a machine-readable fixture manifest, actor matrix, scenario catalog subset, evidence schema and reset contract;
8. return the Golden environment to its known baseline and verify zero unintended residue outside the Golden scope.

`GOLDEN-G0-BOOTSTRAP` does not certify the complete restaurant journey.

## 5. Frozen decisions from DOC-015 open-decision list

For the first Golden bootstrap only:

- Mandatory vs optional scenario set: mandatory is the G0 bootstrap subset above; the full 45-point set remains the terminal target and is not silently reduced.
- Multi-location: mandatory from bootstrap, minimum two Locations, because the architecture is multi-location and isolation must be designed in rather than retrofitted.
- Merchant payment provider sandbox: deferred until Bill/Payment domain enters the Golden implementation scope; no fake payment PASS may stand in for provider-sandbox evidence.
- Synthetic dataset volume: minimal deterministic fixture set for G0; load/performance volume remains separately gated.
- Browser/device framework: deferred until a browser-accessible Golden surface exists; backend/runtime evidence is mandatory in the meantime.
- Golden reset: mandatory before any Golden execution PASS and must be Foundation-owned/fail-closed.
- Performance/SLA thresholds: not part of G0 certification; must be frozen before performance claims.
- Supply chain: not mandatory for G0; remains required only when the relevant feature pack is formally included in a later Golden level.

## 6. Golden progression model

The DOC-015 test levels remain authoritative:

- `G0` Smoke/bootstrap
- `G1` Domain flow
- `G2` Cross-domain flow
- `G3` Full Restaurant Journey
- `G4` Extended Operations
- `G5` Failure/Recovery

No level may be called complete unless all mandatory scenarios for that level have evidence and cleanup.

## 7. Next authorized specification

This freeze authorizes preparation only of:

`GOLDEN-G0-BOOTSTRAP-EXACT-IMPLEMENTATION-SPEC`

That specification must freeze exact environment topology, fixture IDs/classes, actor matrix, reset algorithm, bounded write manifest, evidence schema, tests and rollback before any Golden bootstrap runtime write.

## 8. Gate status

`GOLDEN_FULL_CERTIFICATION = NOT_READY`

`GOLDEN_G0_BOOTSTRAP_SPEC = AUTHORIZED`

`GOLDEN_G0_RUNTIME_IMPLEMENTATION = NOT_AUTHORIZED_BY_THIS_DOCUMENT`

`PRODUCTION = BLOCKED`

`CORTE_FIXTURE_USE = FORBIDDEN`

`BASE44_AUTHORITY = ZERO`
