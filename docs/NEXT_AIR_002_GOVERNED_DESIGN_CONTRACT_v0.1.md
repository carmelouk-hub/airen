# NEXT-AIR-002 — Governed Design Contract v0.1

**Artifact class:** `GOVERNED_DESIGN_NOT_CANONICAL`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Runtime implementation authorized:** `false`

**Schema authorized:** `false`

## 1. Purpose

Define a provider-neutral, testable contract surface for Relationship Intelligence without creating operational resources or treating a design proposal as architecture authority.

This document defines invariants and candidate types. It does not define a database schema, route, Base44 entity, legal basis or production behavior.

## 2. Trust boundary

The relationship layer may consume only certified, typed domain events or governed projections. It may not read source-domain tables directly and may not write to Booking, Order, Feedback, PurchaseOrder, GoodsReceipt, customer, supplier or STELLA records directly.

Every mutation candidate must preserve the Foundation pipeline:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement -> purpose authorization -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

Missing or ambiguous authority produces a typed denial. There is no default Tenant, default Location, unknown-host fallback or client-supplied authority.

## 3. Semantic types

### Fact

A certified source-domain statement whose authority remains with the source domain. The relationship layer stores a reference or authorized projection, not a competing mutable truth.

### Observation

An append-oriented record of an authorized event or measurement. An observation never becomes a subject attribute automatically.

### Claim

A purpose-bound interpretation supported by evidence. A claim carries method/version, confidence when applicable, validity, provenance and status.

Candidate states are:

- `PROPOSED`
- `CONFIRMED`
- `CORRECTED`
- `REJECTED`
- `EXPIRED`
- `SUPERSEDED`

Only an authorized human or certified source rule may create a confirmed state. An AI-produced claim starts as `PROPOSED` and cannot confirm itself.

### Action proposal

An explainable recommendation with no direct execution authority. Execution must re-enter the governed application-service pipeline.

### Relationship Twin

A reconstructable, purpose-specific, minimized projection of currently usable claims. It is not a universal profile and is never a public raw-data projection.

## 4. Candidate contract envelopes

The following logical fields are required for design and tests. Names remain candidate names and are not schema authority.

### Certified observation envelope

| Field | Contract meaning |
|---|---|
| `event_id` | globally unique idempotency identity from a certified producer |
| `event_type` | versioned typed event name |
| `occurred_at` | source event time |
| `recorded_at` | trusted ingest time |
| `producer` | certified source service and version |
| `tenant_ref` | trusted opaque Tenant reference resolved server-side |
| `location_ref` | trusted opaque Location reference when required |
| `subject_ref` | scoped pseudonymous customer or supplier reference |
| `purpose_ref` | authorized processing purpose version |
| `correlation_id` | end-to-end trace reference |
| `payload_classification` | field-policy classification identifier |
| `payload` | minimized event-specific fields only |
| `integrity_ref` | integrity or provenance evidence reference |

### Evidence-backed claim envelope

| Field | Contract meaning |
|---|---|
| `claim_id` | immutable claim identity |
| `subject_ref` | scoped subject identity |
| `claim_type` | approved claim taxonomy member |
| `state` | candidate claim state |
| `value` | minimized typed value, never an unbounded profile blob |
| `evidence_refs` | one or more authorized evidence references |
| `method_ref` | deterministic rule or model/version reference |
| `confidence` | calibrated value when meaningful; never authority |
| `valid_from` / `valid_until` | explicit validity window |
| `purpose_ref` | purpose under which the claim may be used |
| `created_by_actor_ref` | trusted actor or certified producer reference |
| `supersedes_claim_ref` | prior claim reference for corrections |
| `contestation_state` | open, resolved or not contested |
| `audit_ref` | immutable decision provenance |

### Authorization decision result

| Field | Contract meaning |
|---|---|
| `decision` | `ALLOW` or `DENY`; default is `DENY` |
| `reason_code` | typed, non-secret explanation |
| `actor_ref` | resolved trusted actor |
| `tenant_ref` / `location_ref` | resolved trusted scope |
| `purpose_ref` | exact versioned purpose |
| `lawful_basis_ref` | reviewed basis record; no basis is assumed by this document |
| `permission_ref` | satisfied permission evidence |
| `entitlement_ref` | satisfied entitlement evidence when applicable |
| `allowed_fields` | minimized output field set |
| `expires_at` | authorization expiry |
| `policy_version` | evaluated policy version |
| `audit_ref` | immutable decision record |

## 5. Purpose and authorization model

A processing purpose is versioned, narrow and testable. It must define:

- intended outcome;
- subject category;
- data categories;
- allowed actors and recipients;
- allowed operations;
- lawful-basis record approved through legal governance;
- permission and entitlement requirements;
- retention and expiry;
- revocation consequences;
- forbidden uses;
- human-approval threshold;
- policy owner and version.

No lawful basis is selected in this design document. Legal review must determine it for every purpose. Consent is represented only where consent is actually the applicable basis.

Candidate purpose families for review, not approval:

- customer service continuity;
- customer-declared preference handling;
- feedback and correction handling;
- supplier delivery-quality review;
- supplier-document validity review;
- procurement scenario preparation.

Marketing, cross-Tenant enrichment, sensitive behavioral inference, universal scoring and sale of profile data are outside this candidate catalog and fail closed.

## 6. Field classification and minimization

| Class | Examples | Design rule |
|---|---|---|
| `PUBLIC_METADATA` | policy identifier, non-personal taxonomy | still purpose-bound when joined to a subject |
| `TENANT_CONFIDENTIAL` | supplier performance observation | Tenant-scoped, minimized, no public projection |
| `PERSONAL` | declared communication preference | subject-rights workflow and purpose required |
| `SENSITIVE_COMPARTMENT` | declared allergy safety datum | separate contract, minimum safety projection only |
| `DERIVED_CLAIM` | service preference hypothesis | evidence, method, confidence, expiry and contestability required |
| `SECURITY_METADATA` | authorization and audit references | access limited; secrets forbidden |

Unbounded notes, raw prompts, raw conversation history and unrestricted event payloads are not valid relationship fields.

## 7. Forbidden inference catalog

The following may not be inferred from orders, behavior, location, language or relationship history:

- health condition or disability;
- religion or philosophical belief;
- sexual orientation or sex life;
- racial or ethnic origin;
- political opinion or trade-union membership;
- genetic or biometric identity;
- economic vulnerability;
- emotional state;
- criminal propensity;
- social worth or universal person score.

Supplier logic must also prohibit opaque universal scores, automatic exclusion, undisclosed penalty and cross-Tenant reputation pooling.

## 8. Identity and subject boundaries

- Customer and supplier references are scoped to a trusted Tenant and, where required, Location.
- Automatic cross-Tenant identity merge is forbidden.
- Similarity or deduplication may create only a review proposal, never an identity fact.
- A subject-rights request must use a separately approved identity-verification process.
- Relationship Passport remains inactive and requires its own protocol, threat model and governance decision.

## 9. Correction and contestability

Corrections append evidence and create explicit supersede relationships. History is not silently overwritten.

The minimum workflow is:

`request -> identity/authority verification -> locate scoped material -> freeze affected automated use when required -> assess evidence -> confirm/reject/correct -> audit -> rebuild projections -> notify authorized recipients when required`

Supplier contestation receives the same provenance and non-retaliation guarantees as customer correction. A contested claim cannot produce an automated adverse action.

## 10. Retention, expiry and revocation

- every observation and claim class requires an approved retention policy before implementation;
- derived claims require explicit expiry and policy-driven reevaluation;
- revocation applies fail closed to future uses covered by the revoked authorization;
- revocation does not rewrite historical audit evidence;
- deletion, legal hold, anonymization and recipient reconciliation remain separate typed outcomes;
- expired or superseded claims are excluded from active Twin projections.

Exact durations are intentionally unresolved pending legal and business review.

## 11. Customer and supplier action boundary

Customer personalization, communication, supplier selection, procurement and commercial decisions are proposals only. Any execution requires a fresh server-side authorization decision and the full mutation pipeline.

No significant or adverse decision may be based solely on a claim, confidence value, model output or aggregate score.

## 12. Provider boundary

Base44 may host a review or future adapter experience, but it is not Foundation authority. Domain packages may not import a provider SDK. Provider details must remain in replaceable adapters outside the Foundation core.

## 13. Open design decisions

1. approved purpose catalog and lawful-basis matrix;
2. exact claim taxonomy and typed values;
3. retention schedule by field class and jurisdiction;
4. subject identity-verification procedure;
5. recipient reconciliation after revocation or correction;
6. human-approval thresholds by action class;
7. commercial entitlement ownership;
8. Relationship Passport protocol;
9. controller/processor roles and international-transfer analysis;
10. accepted ADR set and canonical document changes.

## 14. Promotion gate

This contract may be reviewed, revised or rejected. It cannot be implemented until all open decisions affecting the intended slice are closed, DPIA/legal review is complete, threat mitigations have owners and tests, and a separate explicit governance decision authorizes a bounded implementation milestone.
