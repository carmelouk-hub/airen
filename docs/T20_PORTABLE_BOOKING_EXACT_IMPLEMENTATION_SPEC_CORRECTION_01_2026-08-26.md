# T20 Portable Booking — Exact Implementation Specification — Correction 01

Date: 2026-08-26
State: CORRECTION_ACCEPTED_FOR_RUNTIME_PRECONDITION
Artifact class: GOVERNANCE_CORRECTION_NOT_RUNTIME_EVIDENCE

## Scope

This correction resolves one canonical mismatch found during the live RULE-DOC-21 pre-runtime reconciliation between the accepted Exact Implementation Specification and the existing AIRenOS Foundation PostgreSQL security-context implementation.

No runtime code, schema migration, Base44 runtime, production publication, Corte delle Stelle data, certified R3 branch or main branch is changed by this correction.

## Mismatch

The accepted Exact Implementation Specification used PostgreSQL session settings under the namespace `app.*`:

- `app.identity_id`
- `app.tenant_id`
- `app.location_id`
- `app.correlation_id`

The existing Foundation implementation already uses and enforces the canonical runtime namespace `airen.*` in trusted request scopes and mutation transactions:

- `airen.identity_id`
- `airen.tenant_id`
- `airen.location_id`
- `airen.correlation_id`

Creating a second `app.*` namespace would introduce parallel authority semantics and is prohibited.

## Corrected canonical rule

For T20 Portable Booking Slice-01, all PostgreSQL RLS/session-context references MUST use the existing Foundation namespace:

- identity: `airen.identity_id`
- tenant: `airen.tenant_id`
- location: `airen.location_id`
- correlation: `airen.correlation_id`

The Booking RLS policy therefore derives trusted scope from `current_setting('airen.tenant_id')` and `current_setting('airen.location_id')` and MUST NOT introduce `app.*` settings.

## Preservation

All other accepted Exact Implementation Specification decisions remain unchanged, including server-derived SecurityContext, Foundation authority, fail-closed behavior, Booking permissions, lifecycle, idempotency, audit/outbox, environment isolation, bounded write manifest and production blocks.

This correction is a narrow reconciliation amendment and does not itself authorize schema execution or production publication.
