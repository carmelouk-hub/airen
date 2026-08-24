# T20 Portable Booking — Exact File & Contract Census

**State:** `CENSUS_COMPLETE_FAIL_CLOSED`

**Verdict:** `INCOMPLETE`

**Implementation authorized:** `false`

**Certification claim:** `false`

**Evidence date:** 2026-08-24

## Purpose

This is the exact, read-only RULE-DOC-15 census required by the T20-0 freeze for `T20-S01-PORTABLE-BOOKING`. It records only facts supported by the repository, live canonical Google Drive authorities, or registered forensic evidence. It does not assign new implementation paths and does not turn an unresolved contract into an inferred requirement.

The human Drive evidence is `T20-0A-001` (`1ewgenwG38RdQzd6yecjAxdqmrI4JZ2ZTdF9ebJWTv00`). The machine Drive evidence is `MRS-012` (`1q2VyUhoBK-Yn7zHhlDTcXEfnWD5ZSaMpRAIPTbw8rWE`).

## Reconciled source boundary

- repository: `carmelouk-hub/airen`
- branch: `t20/security-certification-20260824`
- census input commit: `b435b35d07c0e448b874e4ef1d43d00dc63fa0e9`
- census input tree: `e6ad32f86aa3f9421b314c2b464c2e920f565c6a`
- T20-0 human authority: `17JADehm20AN9V6ew3IB-TwC64l8qq3UWzYM1nPTdK30`
- T20-0 machine authority: `1XLcmWw5dcQBeqETwCVfTfKmHNB_j3_Cj1zVCF5lbNZQ`
- PR #4: open, draft and unmerged at the live precheck
- RULE-DOC-21 result: `MATCH`; fail-closed remained active

## Present and reusable Foundation files

The following existing files provide reusable generic primitives. None is a Booking runtime implementation:

- `packages/identity/src/index.ts` — provider-neutral identity boundary
- `packages/authorization/src/index.ts` — permission and scope enforcement
- `packages/entitlements/src/index.ts` — generic entitlement enforcement
- `packages/platform-core/src/index.ts` — governed mutation transaction, authorization, audit and outbox sequence
- `packages/persistence-postgres/src/index.ts` — PostgreSQL adapters and transaction-scoped context support
- `apps/api/src/security-context.ts` — trusted hostname, Tenant, Location, membership, permission and entitlement resolution
- `db/migrations/0001_foundation_runtime_core.sql` — Tenant/Location, identity, authorization, entitlement, audit and outbox foundation
- `db/migrations/0002_request_context_contract.sql` — transaction-local trusted identity, Tenant, Location and correlation contract
- `db/migrations/0003_foundation_rls.sql` — Foundation RLS pattern
- `db/migrations/0004_authentication_bootstrap.sql` — narrow provider-subject authentication resolver
- `db/migrations/0005_runtime_role_grants.sql` — Foundation runtime database grants
- `tests/postgres/governed-command.test.ts` — generic governed Location mutation evidence

`packages/shared-contracts/src/index.ts`, `machine-context/t20-portable-booking-slice.json` and `machine-context/t20-security-certification-baseline.json` are also reusable contract/evidence surfaces, subject to the gaps below.

## Present only as reference

- `packages/ristoairen/README.md` describes a placeholder boundary.
- `packages/ristoairen/src/index.ts` contains type-only declarations; a runtime import exposes no exports.
- `apps/api/src/server.ts` has health/admin surfaces but no Booking route.
- `machine-context/permissions.initial.json` is explicitly incomplete and contains only `booking.read` and `booking.create` examples.
- `machine-context/entitlements.initial.json` is explicitly incomplete; its `risto.booking` example is not promoted to canonical authority by this census.
- `db/fixtures/t20/README.md` and `tests/t20/README.md` are placeholders without executable fixtures, cleanup, or tests.
- `tests/integration/foundation-runtime.test.ts` uses the noncanonical synthetic literals `booking.write` and `risto.booking`; these are generic test inputs, not target Booking authority.

## Canonical Booking contracts found

DOC-008 defines `RST-E003 Booking` as `LOCATION_SCOPED`, supplies its semantic target fields, same-Tenant/Location relationship rules, lifecycle, STELLA boundary and audit-sensitive changes. Its lifecycle is:

`REQUESTED -> PENDING -> CONFIRMED -> ARRIVED -> SEATED -> COMPLETED`, with `CANCELLED` and `NO_SHOW` alternatives.

DOC-009 names these permissions:

- `booking.read`
- `booking.create`
- `booking.update`
- `booking.status.update`

DOC-010 defines:

- `RST-F-BKG-001` — create Booking
- `RST-F-BKG-002` — update Booking
- `RST-F-BKG-003` — transition Booking status
- `RST-F-BKG-005` — public-safe availability slots/capacity DTO, explicitly without private Booking payload

The required mutation pipeline remains:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement when applicable -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

## Forensic evidence boundary

B44-FX-003 and B44-FX-004 register:

- `base44/entities/Booking.jsonc`
- `base44/functions/create-booking/entry.ts`
- `base44/functions/fetch-customer-bookings/entry.ts`
- `base44/functions/update-booking-details/entry.ts`
- `base44/functions/update-booking-status/entry.ts`

These are `TRANSFORM` semantics, not portable source authority. The registered functions use Base44 service-role behavior. The forensic private-read candidate lacks authentication and carries Corte/Base44 residue. It cannot be promoted into the canonical private Booking read contract.

The forensic source files are not materialized in the local repository used for this census. Only their Drive registers, recorded paths, flags and hashes were available.

## Blocking gaps

1. No canonical private Booking read/list function ID, DTO, filters or pagination was found.
2. DOC-010 leaves the exact `RST-F-BKG-003` permission unresolved between `booking.update` and a future `booking.status.update`.
3. DOC-009 provides Booking/CRM family levels `F/F/O` for tenant admin, manager and responsabile, but not exact grants for the four named permissions.
4. Booking entitlement applicability and canonical key are unresolved.
5. `packages/ristoairen/src/index.ts` imports `TenantContext`, but `packages/shared-contracts/src/index.ts` does not export it.
6. No Booking table, exact SQL types/nullability/constraints/FKs, or versioned Booking migration exists.
7. No Booking-specific idempotency contract or persistence exists; the generic mutation executor does not enforce it itself.
8. No typed/versioned Booking audit and outbox payload mapping exists.
9. No Booking persistence store or Booking RLS policy exists.
10. No private Booking API route or DTO surface exists.
11. No authenticated T20 role fixture, executable test, or verified cleanup implementation exists.
12. The forensic source files are not present locally.
13. No read authority assigns exact paths for new Booking implementation files.

## Read-only validation evidence

- `npm run test:foundation-runtime` — `11/11 PASS`
- `npm run test:platform-security-context` — `2/2 PASS`
- `npm run check:sql-runtime` — static SQL contract checks `PASS`
- portable vertical runtime export check — `ristoairenRuntimeExports: []`
- Booking runtime reference search — `ABSENT`
- Booking table search — `ABSENT`
- Booking permission migration search — `ABSENT`
- executable `tests/t20` and `db/fixtures/t20` files — `ABSENT`

These results demonstrate reusable Foundation behavior and absence findings. They do not demonstrate a Booking runtime and do not constitute a T20 certificate.

## T20 and change status

- all required T20 tests: `66`
- mapped to Slice-01: `32`
- remaining mandatory: `34`
- executed: `0`
- state of every test: `NOT_RUN`
- runtime code changes: `0`
- executable test changes: `0`
- schema or migration changes: `0`
- parity: `NOT_MEASURED_NO_RUNTIME`
- gap: `OPEN_BLOCKING`
- ADR impact: `NARROW_GOVERNANCE_AMENDMENT_REQUIRED`; no accepted ADR was changed

## Fail-closed decision

`implementation_authorized = false`

The next safe action is a narrow governance amendment that resolves the private-read contract, status permission, exact role grants, entitlement, context and idempotency questions before an implementation plan assigns any new file path. This is a proposed next governance action, not a newly invented canonical artifact ID.

