# NEXT-AIR-002 — Governance Decision

**Decision ID:** `GOV-NEXT-AIR-002-20260824-A`

**Date:** `2026-08-24`

**Decision:** `OPTION_A_PROMOTE_TO_GOVERNED_DESIGN_PHASE_ONLY`

**Approver role:** `AIRen project owner`

**Approval evidence:** direct user response `procedi` after the coding agent requested explicit confirmation of Option A and stated that runtime, database and production would remain unauthorized.

**Effective state:** `GOVERNED_DESIGN`

**Artifact class:** `WORKING_FUTURE_PROPOSAL_NOT_CANONICAL`

## Decision

`NEXT-AIR-002` may proceed through a governed design phase. This decision authorizes the preparation and verification of design artifacts only.

It does not make the proposal canonical and does not authorize implementation.

## Authorized work

- purpose and processing-authorization contract design;
- data classification, minimization and forbidden-inference design;
- customer and supplier claim, evidence, correction and contestability contracts;
- candidate typed event and decision-result contracts;
- threat modelling and DPIA preparation;
- legal and governance questions for formal review;
- synthetic fixtures and non-operational contract-test specifications;
- read-only Base44 design-review representations.

## Explicitly unauthorized work

- runtime services or operational API behavior;
- Base44 entities, backend functions, agents, connectors or auth changes;
- database schemas or migrations;
- production or personal data;
- provider integration or secret handling;
- Relationship Passport activation;
- autonomous significant decisions;
- canonical specification changes;
- environment promotion or production deployment.

## Required authority boundaries

- Foundation core remains provider-neutral and has no Base44 SDK/entity/auth/service-role dependency.
- Tenant and Location authority must be resolved from trusted server context; client input is never authority.
- Permission and entitlement precede purpose evaluation.
- Consent, when applicable, never replaces permission, entitlement or trusted scope.
- Facts, observations, claims and action proposals retain distinct semantics and provenance.
- AI proposals cannot confirm themselves, broaden authority or execute significant decisions.
- STELLA has no direct relationship-record or operational-record write path.
- Unknown host, missing purpose, missing authority and ambiguous identity fail closed.
- Provider secrets and real production data are forbidden in Git, prompts, fixtures, logs and records.

## Required outputs before any implementation review

1. governed design contract with explicit trust boundaries;
2. purpose and authorization decision model;
3. field classification and forbidden-inference catalog;
4. identity, correction and subject-rights design;
5. retention, expiry, revocation and anonymization design;
6. customer and supplier contestability design;
7. DPIA screening and full-DPIA work plan;
8. threat model and mitigation ownership;
9. synthetic contract-test plan;
10. parity, gap and ADR-impact evidence.

## Governance effect

| Authority | Result |
|---|---|
| Governed design | `AUTHORIZED` |
| Canonical architecture | `NOT_AUTHORIZED` |
| Runtime implementation | `NOT_AUTHORIZED` |
| Schema or migration | `NOT_AUTHORIZED` |
| Base44 operational resources | `NOT_AUTHORIZED` |
| Production deployment | `NOT_AUTHORIZED` |

**ADR impact:** `NONE`. A future canonical proposal may require one or more ADRs, but this decision accepts none.

**Next decision:** a separate, explicit governance review is required before any canonical contract or implementation milestone can begin.
