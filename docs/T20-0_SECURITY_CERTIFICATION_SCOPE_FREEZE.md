# T20-0 — Security Certification Scope Freeze

**State:** `DESIGN_FROZEN`

**Verdict:** `INCOMPLETE`

**Certification claim:** `false`

**Date:** 2026-08-24

**Controlled branch:** `t20/security-certification-20260824`

## Purpose

This artifact closes the T20-0 scope-definition step without claiming implementation or certification. It binds the 66 mandatory T20 tests to the first portable security slice and preserves the certified R3 baseline as the source boundary.

The human Drive authority is `T20-0-001` (`17JADehm20AN9V6ew3IB-TwC64l8qq3UWzYM1nPTdK30`). The machine Drive authority is `MRS-011` (`1XLcmWw5dcQBeqETwCVfTfKmHNB_j3_Cj1zVCF5lbNZQ`). The detailed repository companion is `machine-context/t20-portable-booking-slice.json`.

## Frozen source boundary

- repository: `carmelouk-hub/airen`
- R3 certified baseline commit: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`
- R3 certified baseline tree: `d1855a0a8e28f67342cf401e589f433277af10f3`
- T20 opening commit: `0da21040f1d113dab2da6a30eeeed459b03fc33e`
- PR #4 remains open, draft and unmerged
- `main`, Corte production, Base44, Golden Restaurant E2E and production cutover remain unchanged and unauthorized

## First portable vertical security slice

`T20-S01-PORTABLE-BOOKING` is frozen around `RST-E003 Booking`, with trusted tenant and location resolution and the following canonical permissions:

- `booking.read`
- `booking.create`
- `booking.update`
- `booking.status.update`

The canonical mutation contracts are:

- `RST-F-BKG-001` — create Booking
- `RST-F-BKG-002` — update Booking
- `RST-F-BKG-003` — transition Booking status

Every mutation must follow the required pipeline:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement when applicable -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

No `tenant_id` or `location_id` supplied by the client is authority. Unknown hosts must fail closed. Tenant administrators never gain platform-administrator authority. Domain code must remain provider-neutral and cannot import Base44 or provider SDKs.

## Test binding

All 66 DOC-014 tests remain mandatory and `NOT_RUN`. The slice maps 32 tests for its future controlled runtime:

- tenant admin: `T20-A01`–`T20-A03`, `T20-A12`–`T20-A15`, `T20-A20`–`T20-A22`, `T20-A27`
- manager: `T20-M01`–`T20-M03`, `T20-M10`–`T20-M15`, `T20-M19`–`T20-M20`
- responsabile cucina: `T20-R01`–`T20-R03`, `T20-R09`, `T20-R11`–`T20-R15`, `T20-R18`

The remaining 34 tests are neither removed nor waived. They stay outside Slice-01 until their canonical verticals and controlled runtime exist.

## Explicit canonical gap

DOC-010 defines the Booking mutation contracts but does not identify a canonical private Booking read/query function. Slice implementation must not invent that contract. The next evidence step must resolve the exact existing file/contract mapping or return a narrow governance amendment before code is written.

## Evidence and cleanup rules

Certification requires real authenticated sessions for `tenant_admin`, `manager` and `responsabile_cucina`, a temporary synthetic fixture with at least two tenants and distinct locations, allow/deny and cross-boundary runtime evidence, audit/outbox evidence where applicable, and verified cleanup. Production data cannot be used as fixture data.

At this freeze point:

- implementation started: `false`
- runtime tests executed: `0/66`
- cleanup executed: `false`
- parity status: `DESIGN_ONLY_NOT_MEASURED`
- gap status: `OPEN_PRIVATE_BOOKING_READ_CONTRACT`
- ADR impact: `NONE_AT_FREEZE`

## Exact artifact census

This design-freeze change is limited to:

- created: `docs/T20-0_SECURITY_CERTIFICATION_SCOPE_FREEZE.md`
- created: `machine-context/t20-portable-booking-slice.json`
- modified: `machine-context/t20-security-certification-baseline.json`
- modified: `tests/t20/README.md`

No runtime code, schema, migration or executable T20 test is introduced by this step.

## Next action

`RULE_DOC_15_EXACT_PORTABLE_BOOKING_SECURITY_SLICE_FILE_CENSUS`

The next step is an exact, read-only census of the files and contracts required to implement Slice-01. Only after that census is reconciled with DOC-008, DOC-009, DOC-010, B44-FX-004 and accepted ADRs may an implementation plan be authorized.
