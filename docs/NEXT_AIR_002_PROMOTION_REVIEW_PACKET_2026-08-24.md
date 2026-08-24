# NEXT-AIR-002 — Relationship Intelligence OS Promotion Review Packet

**Date:** 2026-08-24

**Current class:** `WORKING_FUTURE_PROPOSAL_NOT_CANONICAL`

**Current state:** `DESIGNING`

**Implementation authorized:** `false`

**Promotion authorized:** `false`

**Decision state:** `AWAITING_EXPLICIT_GOVERNANCE_DECISION`

## Purpose

Provide an explicit decision surface for promoting, revising, deferring or rejecting `NEXT-AIR-002` without silently turning a North Star proposal or a Base44 interface prototype into architecture authority.

## Evidence available for review

- North Star proposal v0.1 with customer and supplier Relationship Twin boundaries.
- Base44 AIRenOS Design Review Workspace using synthetic, non-persistent review scenarios only.
- Explicit separation between Base44 experience and provider-neutral Foundation authority.
- No Base44 entity, agent, connector, secret, operational API or production fixture introduced.
- UI representations preserve claim provenance, proposal versus confirmation, correction/supersede semantics, forbidden inference boundaries and fail-closed promotion.

## Decision options

### Option A — Promote to governed design phase

**Recommended.** Authorize contract and governance design only. This option would permit:

- purpose and lawful-basis catalog design;
- allowed/forbidden inference catalog design;
- field classification and minimization design;
- customer/supplier correction and contestability policy;
- threat model, DPIA preparation and legal review;
- typed contract proposals, synthetic fixtures and executable contract tests in a non-operational environment.

It would **not** authorize runtime implementation, schema/migrations, production data, operational Base44 entities, production integration, automated significant decisions, Relationship Passport activation or environment promotion.

### Option B — Revise and return

Return the proposal for changes while preserving its non-canonical status. Required revisions must be recorded explicitly before another review.

### Option C — Defer

Keep the proposal in the NEXT backlog without further implementation or promotion work.

### Option D — Reject

Close the proposal without promotion. Preserve evidence and provenance; remove it from the active design path through the established governance process.

## Open decisions that remain mandatory

1. shared AIRenOS primitives versus vertical logic;
2. purpose catalog and lawful-basis matrix;
3. identity, deduplication and subject-rights model;
4. field classification and forbidden-inference catalog;
5. retention, expiry, revocation and anonymization;
6. Relationship Passport trust and portability protocol;
7. human-approval thresholds and significant decisions;
8. supplier correction and contestability policy;
9. entitlements, quotas, plans and commercial ownership;
10. DPIA, legal review and threat model.

## Non-negotiable boundaries under every option

- Foundation core remains provider-neutral and cannot depend on Base44 SDK/entity/auth/service-role behavior.
- Client-supplied Tenant or Location values are never authority.
- Facts, observations and claims retain provenance and distinct semantics.
- AI proposals never confirm themselves or execute significant decisions autonomously.
- Sensitive behavioral inference is prohibited.
- STELLA has no direct operational or relationship-record write path.
- Private raw data never becomes public or cross-Tenant by default.
- Provider secrets never enter Git, prompts, fixtures, logs or records.

## Decision record

No option is selected by this packet. An explicit governance decision must identify the chosen option, approver, date, scope, conditions and any affected canonical artifacts.

**Recommended decision:** `OPTION_A_PROMOTE_TO_GOVERNED_DESIGN_PHASE_ONLY`

**Current effective decision:** `NONE`

**Runtime implementation:** `BLOCKED`

**ADR impact:** `PENDING_DECISION`; no accepted ADR is changed by this packet.
