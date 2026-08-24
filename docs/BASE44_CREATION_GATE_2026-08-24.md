# Base44 Creation Gate — AIRenOS Control Plane & RistoAIRen

**Date:** 2026-08-24  
**Decision:** `GO_STAGING_SHELLS_ONLY`  
**Operational runtime:** `NO_GO_T20_INCOMPLETE`

## Purpose

Authorize the creation of two separate Base44 staging applications without changing Foundation authority, production data, the T20 contract, accepted ADRs, STELLA authority, or production cutover state.

## Applications

1. `airenos-control-plane-staging`
   - Administrative and relationship-intelligence experience.
   - Non-authoritative control plane and future governed BFF consumer.
   - May present projections and initiate governed requests only.

2. `ristoairen-staging`
   - Tenant/Location-scoped restaurant vertical.
   - May consume only accepted AIRenOS contracts.
   - Must not become the authority for Tenant, Location, roles, permissions, entitlements, audit, Booking, consent, or STELLA state.

## Mandatory boundary

Base44 may host the frontend, application navigation, non-authoritative UI state, staging demonstrations, and adapters to accepted APIs. Foundation core must not import the Base44 SDK or depend on Base44 entities, authentication, or service-role behavior.

Every future mutation must preserve the canonical pipeline:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

Client-supplied `tenant_id` or `location_id` is never authority. Unknown hosts fail closed. Tenant administrators are never platform administrators. STELLA never writes directly to an operational database. Provider secrets must not appear in Git, entity rows, logs, fixtures, or prompts.

## Current certification boundary

- T20 state: `INCOMPLETE`.
- Mandatory T20 tests executed: `0/66`.
- Portable Booking census: `CENSUS_COMPLETE_FAIL_CLOSED`.
- Blocking governance gaps remain open.
- Golden Restaurant E2E and production cutover are not authorized.

Therefore the staging shells may be created, branded, navigated, mocked with synthetic non-production fixtures, and built. Real Booking operations, production data, live tenant onboarding, authoritative permissions, operational STELLA actions, and production deployment remain prohibited.

## Initial technical choice

- Two separate Base44 projects.
- Template: `backend-and-client` for each project.
- Local boundary: `base44-apps/<project>`.
- No `--deploy` during creation.
- No entities, connectors, agents, provider secrets, or production fixtures in the creation step.
- AIRenOS official logo assets are consumed from `brand/airenos/` and must not be reinterpreted.

## API contract gate

No endpoint name, payload, permission, entitlement, or error contract is invented by this gate. Before an operational integration is implemented, each consumed AIRenOS API must have an accepted contract, typed request/result, trusted Tenant/Location resolution, idempotency behavior, audit/outbox mapping, tests, and governance provenance.

## Promotion criteria

Promotion beyond staging shells requires all applicable items below:

- accepted closure of blocking Booking governance decisions;
- versioned schema/migrations where required;
- T20 implementation and all mandatory tests passing;
- Golden Restaurant E2E passing;
- security and parity evidence;
- explicit governance approval for environment promotion and cutover.

## Evidence required from this milestone

- generated Base44 project configuration for both apps;
- remote application IDs recorded without secrets;
- successful local builds;
- evidence that no domain-authoritative Base44 entities or production fixtures were introduced;
- gap status and ADR impact recorded;
- Git commit and remote publication.

**Gap status:** `OPEN_T20_AND_GOLDEN_BLOCKING_OPERATIONAL_PROMOTION`  
**ADR impact:** `NONE`; no accepted ADR is changed by staging-shell creation.
