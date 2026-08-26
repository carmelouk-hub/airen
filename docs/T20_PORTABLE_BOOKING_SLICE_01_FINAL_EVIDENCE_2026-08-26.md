# T20 Portable Booking Slice-01 — Final Evidence — 2026-08-26

Milestone: `T20-PORTABLE-BOOKING-SLICE-01`

Verdict: `PASS_BOUNDED_T20_SLICE_01`

Certified scope: `ISOLATED_T20_RUNTIME_AND_PRIVATE_BOUNDARY_MODULE_ONLY`

## Governance boundary

- Exact Implementation Specification: `T20 Portable Booking — Exact Implementation Specification — ACCEPTED 2026-08-26`.
- Correction 01 is authoritative for PostgreSQL request scope: `airen.identity_id`, `airen.tenant_id`, `airen.location_id`, `airen.correlation_id`.
- Runtime production publication: `NOT_PERFORMED / NOT_AUTHORIZED`.
- Base44 runtime implementation/publication: `NOT_PERFORMED / NOT_AUTHORIZED`.
- Corte delle Stelle migration/cutover or production-data use: `NOT_PERFORMED / NOT_AUTHORIZED`.
- R3 certified branch and PR #4: protected from this milestone; PR #4 remains `OPEN / DRAFT / UNMERGED` at certified R3 head `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- No merge, production cutover, Base44 runtime promotion, Corte cutover or subsequent macro-gate is authorized by this PASS.

## Certified implementation snapshot

- Working branch: `t20/booking-runtime-slice-01-20260826`
- Frozen implementation candidate commit: `cb5a842c8608c66fe6bf47dd98529f686873e2fd`
- Frozen implementation candidate tree: `f061dc26e343efd9a5496e735997c2104f937e0c`
- Frozen implementation base: `cdeba8500dcde1d133685270c8dbcb7b6febcc2c`
- Base-to-candidate compare: `ahead_by=30`, `behind_by=0`, exactly 17 changed paths, all within the 19-path bounded implementation manifest.
- Protected-path delta: `ZERO` for `base44-apps/`, `apps/admin/`, `packages/platform-core/`, Corte production scope, certified R3 branch and `main`.

The two allowed manifest paths `packages/persistence-postgres/src/index.ts` and `apps/api/src/server.ts` were remotely read and intentionally remain unchanged. `apps/api/src/server.ts` is not wired to publish the Booking boundary in this milestone. Therefore this certificate does not claim an HTTP deployment or published endpoint.

## Authoritative CI evidence

Authoritative final workflow:

- Workflow: `foundation-contract-ci`
- Run number: `447`
- Run id: `32980392986`
- Candidate SHA: `cb5a842c8608c66fe6bf47dd98529f686873e2fd`
- Final conclusion: `SUCCESS`
- `application-contracts`: `SUCCESS`
- `postgres-rls-runtime`: `SUCCESS`
- `deployment-path-runtime`: `SKIPPED BY DESIGN` on `t20/**`

Exact T20 proof count on the same candidate:

| Suite | Result |
|---|---:|
| Contract/domain | 22/22 PASS |
| PostgreSQL runtime | 18/18 PASS |
| Security/isolation | 21/21 PASS |
| Cleanup/residue | 5/5 PASS |
| **TOTAL** | **66/66 PASS** |

Across all four T20 suites: `fail=0`, `cancelled=0`, `skipped=0`, `todo=0`.

## Required security and authority proofs

- C08 explicitly rejects client-provided Tenant/Location scope spoof fields with `TENANT_SCOPE_VIOLATION`.
- S02 proves `airen_app` with no trusted request settings sees zero Booking rows.
- S04 proves same-Tenant/different-Location isolation.
- S05 and S06 prove cross-Tenant denial at application and RLS levels.
- S07 proves cross-Location direct update cannot modify the protected row.
- S08 proves Foundation idempotency storage also has forced RLS.
- S09-S14 prove EdDSA service assertion validity, expiry, maximum 300-second TTL, revoked key denial, audience binding and forged-signature denial.
- S15 proves the adapter kill switch fails closed and, when enabled, an unauthenticated request is denied with HTTP 401 / `AUTHENTICATION_REQUIRED`.
- S16 proves query limiting at burst `20` and `120/min` deterministically.
- S17 proves mutation limiting at burst `20` and `60/min` deterministically.
- S18 preserves the responsabile least-privilege boundary: read/status authority does not grant create or generic update.
- S19 proves generic Booking update cannot mutate status.
- S20 proves private projection does not expose Tenant/Location authority fields.
- S21 proves audit/outbox payload minimization excludes sensitive Booking contact/note fields.

## Persistence, idempotency and cleanup

- `risto_bookings` has PostgreSQL RLS `ENABLE + FORCE` using trusted `airen.tenant_id` and `airen.location_id` request scope.
- Missing trusted settings fail closed through `NULLIF(current_setting(..., true), '')::uuid`.
- `foundation_idempotency_keys` is Foundation-owned, durable, scope-bound and forced-RLS protected.
- Booking mutations preserve same-unit-of-work audit/outbox behavior and deterministic optimistic concurrency.
- T20 fixtures are synthetic and `TEST_TEMPORARY`; Corte delle Stelle is never used as a fixture.

Deterministic cleanup proof:

- X01: zero T20 Booking rows after cleanup.
- X02: zero T20 idempotency rows after cleanup.
- X03: zero T20 Booking outbox residue after cleanup.
- X04: zero T20 Booking audit residue after cleanup.
- X05: fixture topology remains non-production and isolated from Corte.

Terminal residue/orphan status: `ZERO_VERIFIED`.

## Bounded manifest remote read-back

All 19 authorized paths were remotely read during final reconciliation. The 17 changed paths are exactly:

1. `.github/workflows/ci.yml`
2. `apps/api/src/ristoairen-booking-api.ts`
3. `package.json`
4. `packages/persistence-postgres/src/idempotency-control-plane.ts`
5. `packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.rollback.sql`
6. `packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql`
7. `packages/persistence-postgres/src/risto-booking-repository.ts`
8. `packages/ristoairen/src/booking/application-service.ts`
9. `packages/ristoairen/src/booking/contracts.ts`
10. `packages/ristoairen/src/booking/index.ts`
11. `packages/ristoairen/src/booking/policy.ts`
12. `packages/ristoairen/src/index.ts`
13. `tests/helpers/t20-booking-fixtures.ts`
14. `tests/integration/t20-booking-contract.test.ts`
15. `tests/postgres/t20-booking-cleanup.test.ts`
16. `tests/postgres/t20-booking-runtime.test.ts`
17. `tests/postgres/t20-booking-security.test.ts`

The two authorized but unchanged paths are:

18. `packages/persistence-postgres/src/index.ts`
19. `apps/api/src/server.ts`

Latest security-sensitive blob read-backs on the certified candidate:

- `packages/ristoairen/src/booking/policy.ts`: `60f78fa516fb0ac6e77d49dff6e00b314eb5c734`
- `tests/integration/t20-booking-contract.test.ts`: `da5a8b39089ebc78a8b221a37730c5fe4e96ded3`
- `tests/postgres/t20-booking-security.test.ts`: `1db7106fabfa20899f7a1f8c9941ee6425bc8f44`

## Historical intermediate failures retained as provenance

Intermediate CI failures are not hidden. During implementation the suite exposed and caused correction of:

- TypeScript parameter properties incompatible with the Node strip-types execution path.
- Empty PostgreSQL request settings producing UUID cast errors instead of fail-closed zero visibility.
- `KeyObject` imported type-only while used at runtime by the EdDSA verifier.
- Security-test transaction contamination after an expected negative SQL probe.
- Initial rate limiter proof lacking the exact frozen burst=20 requirement.
- Initial suite wording not explicitly proving unauthenticated denial and client scope spoof denial.

These are historical implementation findings. The authoritative terminal evidence is workflow #447 against candidate `cb5a842c8608c66fe6bf47dd98529f686873e2fd`.

## Authority delta and terminal state

- Foundation authority delta: `ZERO`
- Base44 authority delta: `ZERO`
- Production side effects: `FALSE`
- Corte production side effects: `FALSE`
- Certified R3 mutation: `FALSE`
- T20 Slice-01 runtime/test scope: `PASS`

Terminal milestone state: `PASS_BOUNDED_T20_SLICE_01`.

This PASS certifies only the bounded T20 Portable Booking Slice-01 isolated runtime and private-boundary-module test scope. It does not authorize production, HTTP deployment/publication, Base44 runtime, Corte migration/cutover, R3 merge, or any next macro-gate.