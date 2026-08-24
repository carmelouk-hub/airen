# T20 Portable Booking — Narrow Governance Amendment Proposal

**Artifact class:** `PROPOSAL_NOT_CANONICAL`

**State:** `DECISION_PACKET_READY_UNAPPROVED`

**Verdict:** `INCOMPLETE`

**Implementation authorized:** `false`

**Evidence date:** 2026-08-24

## Purpose

This packet converts the 13 blocking findings in the exact Booking file/contract census into explicit governance decisions. It does not amend DOC-008, DOC-009, DOC-010, an accepted ADR, or the T20 contract. It does not assign a new canonical contract ID, approve a file path, or authorize runtime, schema, migration, fixture, or executable-test work.

The governing repository checkpoint is commit `10d64077b7a78db91b071c0e1f20a8982789ac86`, tree `db0a0488931cb40cfe32d3ba0802a155d17b60a6`, on `t20/security-certification-20260824`.

The remote working evidence is the non-canonical Google Doc `T20 Portable Booking — Governance Amendment Decision Packet — PROPOSAL v0.1` (`1uv84obeoRaj7RVRaHFPIkj1o8gHxH8TFKVQev24fiNc`).

## Live authority reconciliation

- RULE-DOC-21 Drive authority is active and requires GitHub + Drive precheck, post-write read-back, reconciliation, and fail-closed behavior.
- DOC-008 still defines `RST-E003 Booking` as `LOCATION_SCOPED`, its target fields, lifecycle, same-Tenant/Location rules, public-projection prohibition, STELLA boundary, and audit-sensitive changes.
- DOC-009 still registers `booking.read`, `booking.create`, `booking.update`, and `booking.status.update`; its role matrix is only family-level (`F/F/O`) for tenant admin, manager, and responsabile.
- DOC-010 still defines `RST-F-BKG-001`, `RST-F-BKG-002`, `RST-F-BKG-003`, and public-safe `RST-F-BKG-005`, but no private Booking read/list contract.
- DOC-014 requires the mapped Booking read/create/update/transition proofs for tenant admin, manager, and responsabile.
- B44-FX-005 ADR-005, ADR-006, and ADR-008 preserve server authorization plus RLS, permission/entitlement separation, and the RISTOAIREN vertical boundary.
- T20-0 and MRS-011 remain design-frozen, not implemented, and incomplete.
- T20-0A-001 and MRS-012 remain `CENSUS_COMPLETE_FAIL_CLOSED`, with 13 blocking gaps and 0/66 tests executed.
- PR #4 remains open, draft, and unmerged.

Dual-source verification result: `MATCH`.

## Additional discrepancy found during amendment preparation

The live T20 human authority, MRS-011, DOC-009, DOC-014, and the security baseline use the canonical role key `responsabile`. The repository mirror `docs/T20-0_SECURITY_CERTIFICATION_SCOPE_FREEZE.md` and `machine-context/t20-portable-booking-slice.json` use `responsabile_cucina` in their fixture wording. No authority establishes these strings as aliases. The proposal therefore records a blocking role-key reconciliation instead of silently treating them as equivalent.

## Decision requests

### GAP-001 — Private Booking read/list contract

Authority proves only that a private read is required and that `RST-F-BKG-005` is a public-safe availability query. Governance must assign the private function ID and name, permission, input, output projection, filters, ordering, pagination, not-found/empty behavior, and Tenant/Location scope. No default ID, API route, DTO, filter, or pagination model is proposed.

Status: `BLOCKING_UNDECIDED_NO_DEFAULT`.

### GAP-002 — Exact permission for RST-F-BKG-003

DOC-010 says `booking.update` or future `booking.status.update`; the frozen slice already registers both keys. The evidence-backed least-privilege candidate is to bind `RST-F-BKG-003` to `booking.status.update` and keep `booking.update` for general Booking edits.

Status: `PROPOSED_UNAPPROVED`.

### GAP-003 — Exact grants for the four Booking permissions

DOC-009 supplies only family-level `F/F/O`; DOC-014 proves the required behaviors. The evidence-backed candidate matrix is:

| Role | booking.read | booking.create | booking.update | booking.status.update |
| --- | --- | --- | --- | --- |
| tenant_admin | allow | allow | allow | allow |
| manager | allow | allow | allow | allow |
| responsabile | allow | deny | deny | allow |

The responsabile row is deliberately limited to the operational read and transition proved by T20-R02/R03. The matrix is a recommendation, not a canonical grant.

Status: `PROPOSED_UNAPPROVED`.

### GAP-004 — Booking entitlement applicability and key

Accepted ADR-006 requires eligibility to remain separate from permission. The local `risto.booking` value comes from an explicitly incomplete example registry and cannot be promoted by inference. Governance must either assign a canonical entitlement key and applicability rules or explicitly declare entitlement not applicable to Slice-01.

Status: `BLOCKING_UNDECIDED_NO_DEFAULT`.

### GAP-005 — Application context contract

The accepted code exports `SecurityContext`; DOC-010 requires the same trusted actor, Tenant, Location, permission, entitlement, platform-role, assurance, and correlation concepts. `TenantContext` is not exported anywhere. The evidence-backed candidate is to use `SecurityContext` for `RistoApplicationService` rather than introduce a duplicate context type.

Status: `PROPOSED_UNAPPROVED`.

### GAP-006 — Booking SQL schema and migration

DOC-008 supplies semantic fields but not exact SQL types, nullability, constraints, indexes, foreign keys, or physical table name. Those details require a versioned implementation specification after the governing contract decisions are approved. No schema or migration name is assigned here.

Status: `IMPLEMENTATION_SPEC_BLOCKED_BY_GOVERNANCE`.

### GAP-007 — Booking idempotency

The required mutation pipeline includes idempotency, DOC-010 requires retry protection for public Booking creation, and accepted target code uses durable request-hash conflict/replay semantics. The candidate is to require durable idempotency for `RST-F-BKG-001`, `RST-F-BKG-002`, and `RST-F-BKG-003`, scoped by trusted Tenant, Location, command, and idempotency key; reuse with a different normalized request must return `IDEMPOTENCY_CONFLICT`.

Retention, exact storage schema, key syntax, in-progress retry behavior, and replay result shape remain decisions for the approved implementation specification.

Status: `PROPOSED_UNAPPROVED`.

### GAP-008 — Typed audit and outbox mapping

DOC-010 names `BOOKING_CREATED`, `BOOKING_UPDATED`, and `BOOKING_STATUS_CHANGED`; DOC-008 identifies the audit-sensitive Booking changes. Governance must approve the typed payload fields, payload version, redaction rules, and exact outbox event names. No outbox name or unlisted payload field is assigned here.

Status: `BLOCKING_UNDECIDED_PARTIAL_AUTHORITY`.

### GAP-009 — Booking persistence store and RLS

ADR-005 requires server authority plus RLS defense-in-depth. The exact store and policies depend on the approved schema, context, read contract, permission matrix, and entitlement decision. Implementation remains blocked; no policy or store path is assigned.

Status: `IMPLEMENTATION_SPEC_BLOCKED_BY_GOVERNANCE`.

### GAP-010 — Private Booking API and DTO

The private read/list function, DTO, filters, pagination, and API route remain unassigned. The API surface must be derived from the approved GAP-001 contract and trusted server context. No route is proposed.

Status: `IMPLEMENTATION_SPEC_BLOCKED_BY_GAP_001`.

### GAP-011 — Authenticated fixtures, tests, and cleanup

The authoritative topology is synthetic Tenant A with Locations A1/A2 and Tenant B with Location B1; all 66 tests remain mandatory and 32 are mapped to Slice-01. The candidate is to use the canonical role key `responsabile` unless governance explicitly creates and maps a different role. Real authenticated sessions, correlation/run IDs, audit evidence, deterministic cleanup, and orphan/residue checks remain mandatory.

Status: `PROPOSED_UNAPPROVED_ROLE_KEY_RECONCILIATION_REQUIRED`.

### GAP-012 — Local forensic source files

B44-FX-003/004 classify the registered Base44 Booking artifacts as transformation/reference evidence, not target portable source authority. The candidate is not to make local materialization a prerequisite for implementation; materialize only if a later parity investigation explicitly requires the source bytes and their registered hashes can be verified.

Status: `PROPOSED_UNAPPROVED`.

### GAP-013 — Canonical implementation file paths

Repository topology confirms the vertical, API, persistence, migration, fixture, and test boundaries, but no authority assigns exact new Booking paths. Paths must be approved in a post-amendment implementation plan. No path is invented here.

Status: `BLOCKING_UNDECIDED_NO_DEFAULT`.

## Approval boundary

This proposal can become an accepted governance amendment only when the governing authority explicitly resolves at least:

1. the full private Booking read/list contract;
2. the RST-F-BKG-003 permission;
3. the exact role grants and the `responsabile` versus `responsabile_cucina` discrepancy;
4. entitlement applicability and canonical key, or explicit non-applicability;
5. the application context contract;
6. idempotency scope and unresolved persistence semantics;
7. typed audit/outbox payloads and exact outbox names;
8. whether forensic source materialization is required;
9. the implementation-plan authority that will assign exact file paths.

Until those decisions are accepted and read back, `implementation_authorized=false`, the verdict remains `INCOMPLETE`, and every T20 test remains `NOT_RUN`.

## Change boundary

- runtime code: unchanged
- schema/migration: unchanged
- executable T20 tests/fixtures: unchanged
- accepted ADRs: unchanged
- canonical DOC-008/009/010/T20 contracts: unchanged
- proposal evidence only: this document and its machine-readable companion
- parity: `NOT_MEASURED_NO_RUNTIME`
- gap: `OPEN_GOVERNANCE_DECISIONS_REQUIRED`
