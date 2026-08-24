# NEXT-AIR-002 — AIRen Relationship Intelligence OS

## North Star Proposal v0.1

**Artifact class:** `WORKING_FUTURE_PROPOSAL_NOT_CANONICAL`

**State:** `DESIGNING`

**Implementation authorized:** `false`

**Promotion authorized:** `false`

**Evidence date:** 2026-08-24

**Drive working specification:** `1ZOLUZjSsYbxC2GopMr-C0XPvH_jLbxRMKEHaS8Xd69Q`

**AIRenOS NEXT registry:** `1i3HLJIAItBnXC1MSKV55pscI6nTtdlpei3ndavuBrBM`

## Scope boundary

This proposal records a future North Star. It does not modify T20, Booking GAP-001, a canonical DOC, an accepted ADR, the executable roadmap, a database schema, Corte delle Stelle production, or any runtime implementation authority.

No claim is made that every individual component is unprecedented. The candidate innovation is the coherent, bidirectional combination of authorized memory, evidence, explainability, correction, selective portability, customer intelligence and supplier intelligence inside AIRenOS and its governed verticals.

## Grounded foundation

The proposal preserves the currently verified authorities:

- AIRenOS separates platform, vertical, Tenant and Location and requires server authority, RBAC, RLS, audit and governed AI.
- `CustomerProfile` is Tenant-scoped and is not shared automatically across Tenants.
- `CustomerAllergy` is sensitive PII; STELLA must not infer undeclared health conditions.
- `Supplier`, `SupplierItem`, `PurchaseOrder` and `GoodsReceipt` already exist as confidential target domains.
- STELLA knowledge carries provenance, evidence, confidence and feedback, while STELLA remains non-authoritative and has no direct Core write authority.
- `NEXT-RST-003` Supply Chain Intelligence is a complementary dependency and is not duplicated by this proposal.

## Problem

Conventional CRM systems commonly organize static records, segments and campaigns. That model can lose context, conflate observations with truth, obscure profile provenance and separate customer experience from operational and supplier intelligence.

AIRenOS instead needs a relationship memory that distinguishes facts, declarations, observations, hypotheses, permissions, purposes, expiry, corrections and decisions. The same discipline must govern customer and supplier relationships.

## Vision

AIRen Relationship Intelligence OS is a candidate dual-layer framework:

1. **AIRenOS Trust & Purpose Fabric** — shared primitives for purpose, lawful basis, authorization, consent when applicable, provenance, revocation, audit and selective portability.
2. **Vertical Relationship Twins** — vertical-specific interpretation of certified domain events without moving unnecessary operational details into the AIRenOS Control Plane.

A profile is not a definitive card. It is a versioned set of claims supported by evidence, each carrying purpose, provenance, method/version, confidence, validity and confirmation or contestation state.

## Candidate architecture

### Observation Ledger

Records authorized events and observations emitted by certified services. An observation is immutable or append-oriented, retains provenance and correlation, and never becomes a subject attribute automatically.

### Purpose & Authorization Graph

Every data use binds to a purpose, lawful basis, data category, authorized actor, recipient, duration, revocation policy and allowed operation. Consent is one possible lawful basis; it does not replace permission, entitlement or trusted scope.

### Evidence-backed Claim Graph

A derived preference or assessment is a claim, not a fact. Each claim links to evidence, method/version, confidence, validity and one of the candidate states `PROPOSED`, `CONFIRMED`, `CORRECTED`, `REJECTED`, `EXPIRED` or `SUPERSEDED`.

### Relationship Twin

The twin is a reconstructable, purpose-specific projection of active claims. It is not a universal table, is not freely readable and never becomes a raw public projection.

### Governed Action Orchestrator

Intelligence may propose personalization, contact, prediction or procurement actions. Execution still traverses an application service with permission, entitlement, trusted scope, transaction, domain validation, idempotency, audit, outbox and a typed result.

### Correction and Contestability Loop

Customers, suppliers and authorized operators may confirm, correct or contest claims and observations under policy. Corrections preserve provenance by adding evidence and explicit supersede semantics rather than silently rewriting history.

## Customer Relationship Twin

For an authorized purpose, the Customer Twin may represent:

- declared and confirmed preferences;
- observed operational patterns retained as expiring hypotheses;
- experience and feedback history;
- service and communication preferences;
- contextual relationship value without a universal person score;
- explainable recommended actions subject to human control.

The system must not infer health, religion, sexual orientation, economic condition, ethnicity, emotions or other protected characteristics from orders or behavior. Declared allergies remain in a separate sensitive compartment and propagate only through the minimum safety snapshot required by an authorized workflow.

## Supplier Relationship Twin

The Supplier Twin may use certified operational facts and authorized metadata to represent:

- delivery timeliness and completeness;
- documented variance, return and quality outcomes;
- declared and observed lead time;
- price history and stability without silent overwrites;
- verifiable documents, certifications and expiry;
- reliability by ingredient, Location and time period;
- explainable risk forecasts and alternatives.

No supplier is excluded, penalized or classified automatically by an opaque score. The system proposes scenarios; commercial decisions, approvals and PurchaseOrder sending remain governed and contestable.

## Relationship Passport — future candidate

The Relationship Passport is a deliberately future, explicit opt-in capability through which a subject may selectively share claims without sharing raw history.

- The customer selects the datum, recipient, purpose and duration.
- Revocation blocks future uses under policy and starts the required reconciliation.
- No global identity or automatic cross-Tenant merge is created.
- Supplier credentials may be shared as verifiable attestations, not as access to the complete internal profile.
- Portability never authorizes an additional purpose by implication.

## STELLA and AI boundary

STELLA may read authorized projections, formulate traceable hypotheses, explain evidence, propose actions and learn from validated feedback.

STELLA must not:

- write directly to operational or relationship records;
- promote its own inference to confirmed truth;
- broaden purpose, permission, entitlement or scope;
- infer prohibited sensitive categories;
- approve its own proposal;
- create hidden social scoring, dark patterns or manipulation;
- merge data across Tenants or verticals without explicit authority.

## Non-negotiable trust and safety invariants

- Purpose limitation and data minimization apply to every projection.
- Tenant and Location are resolved through trusted server context; client `tenant_id` is never authority.
- Field-level DTO minimization complements RBAC and RLS.
- Facts, observations and claims require provenance.
- Inferences require confidence, validity and expiry.
- Sensitive inference from behavioral proxies is forbidden.
- Access, correction, contestation, revocation and retention are governed and testable.
- Decisions with significant effect are not executed solely through automation.
- Private raw data never becomes public.
- Provider secrets never enter records, logs, prompts, fixtures or Git.

## Boundary with T20 and Booking GAP-001

This North Star does not enlarge the private Booking contract and does not approve GAP-001. Booking remains a minimum safe operational projection.

Once canonical contracts are approved, Booking, Order, Feedback, PurchaseOrder and GoodsReceipt may emit typed audit/outbox facts. Relationship Intelligence consumes only governed events and projections. It does not read operational tables directly and does not write into source domains directly.

T20 remains `INCOMPLETE`, `implementation_authorized=false`, and all 66 mandatory tests remain `NOT_RUN`.

## Candidate data concepts — not canonical

- `ProcessingPurpose`
- `LawfulBasisRecord`
- `ConsentGrant`, only when consent is the applicable basis
- `DataUseAuthorization`
- `RelationshipSubjectRef`
- `RelationshipObservation`
- `RelationshipEvidence`
- `RelationshipClaim`
- `RelationshipFeedbackOrCorrection`
- `RelationshipActionProposal`
- `CustomerRelationshipTwin` projection
- `SupplierRelationshipTwin` projection
- `PortableRelationshipPassport`, future

No name, schema, field, enum, permission, entitlement, route or file path in this list becomes authorized merely by inclusion in the working backlog.

## Acceptance foundation before promotion

Any promoted design must prove at least:

1. every claim is traceable to evidence and the method/version that produced it;
2. an AI claim is never returned as a confirmed fact;
3. revocation is applied fail-closed to future uses defined by policy;
4. cross-Tenant data stays invisible, including to STELLA;
5. a changed purpose or normalized filter invalidates derived cursors and caches;
6. sensitive data has a dedicated contract and permission;
7. correction and contestation generate audit and verifiable supersede behavior;
8. customer and supplier actions use governed application services;
9. no significant decision executes only from a score;
10. a Passport shares only selected, revocable claims;
11. retention, anonymization and export are testable;
12. tests use synthetic fixtures only.

## Commercial model candidate

The Trust & Purpose Fabric may become a shared platform capability. Customer Intelligence and Supplier Intelligence may become separate vertical modules or entitlements. Pricing, quotas, plans, usage billing and availability remain TBD until an explicit promotion updates DOC-003.

## Dependencies

- AIRenOS Platform Bible.
- DOC-008 Entity & Data Dictionary.
- DOC-009 RBAC & RLS Matrix.
- DOC-010 Backend Function Catalog.
- DOC-012 STELLA governance, to be verified during formal design.
- NEXT-RST-003 Supply Chain Intelligence.
- T20 Security Certification and Golden Restaurant E2E.
- GDPR, EDPB profiling guidance and the EU AI Act as external guardrails; legal review and a DPIA remain required before implementation.

## Open governance decisions

1. exact boundary between shared AIRenOS primitives and vertical logic;
2. purpose catalog and lawful-basis matrix;
3. identity, deduplication and subject-rights model without automatic cross-Tenant merge;
4. field classification and allowed/forbidden inference catalog;
5. retention, expiry, revocation and deletion/anonymization;
6. Relationship Passport trust and portability protocol;
7. human-approval thresholds and significant-decision categories;
8. supplier contestation and correction policy;
9. entitlements, quotas, plans and commercial ownership;
10. DPIA, legal review and threat model.

## Sources and provenance

Internal authorities and working governance:

- AIRenOS Platform Bible: Drive `1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA`.
- DOC-008: Drive `16d_ItmtJgDktWxYQXbZB7FzTJMVIKFSVzYfF5xd8ZLc`.
- DOC-009: Drive `1MhfahuVL7M_1APUnzqXZY_9sCBu-1veToHxTBGGw8mY`.
- DOC-010: Drive `1686W-gU6L0Pin_xjUg4V2khyeItJ-9PtnRgMlH3Npmw`.
- AIRenOS NEXT registry: Drive `1i3HLJIAItBnXC1MSKV55pscI6nTtdlpei3ndavuBrBM`.
- Review & Approval Promotion Policy: Drive `1eMTdVlapxR5nsTfCMBiec1q6GgEkQP0S8S00b-CtNwk`.
- T20 Booking governance proposal: Drive `1uv84obeoRaj7RVRaHFPIkj1o8gHxH8TFKVQev24fiNc`.

External guardrails:

- GDPR, Regulation (EU) 2016/679: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679`.
- EDPB, Automated individual decision-making and Profiling: `https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en`.
- European Commission, AI Act overview: `https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai`.

These external sources are regulatory guardrails, not a substitute for legal advice, a DPIA or AIRenOS governance decisions.

## Governance state

`NEXT-AIR-002` remains `DESIGNING` in the working backlog. It is not architecture authority, does not authorize implementation and changes no canonical specification.

Next safe action: review and explicitly promote, revise, defer or reject the North Star through the section 09 Promotion Policy.
