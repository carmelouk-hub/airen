# NEXT-AIR-002 — Declared Preference Service Journey Evidence Record v0.1

**Artifact class:** `GOVERNED_DESIGN_EVIDENCE_CAPTURE_NOT_OPERATIONAL`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Candidate purpose:** `PUR-CUST-DECLARED-PREFERENCE-v0`

**Evidence requirement:** `EBI-R01`

**Record state:** `CAPTURE_READY_EVIDENCE_INCOMPLETE`

**EBI-R01 status:** `PARTIAL`

**Exact service journey verified:** `false`

**Runtime implementation authorized:** `false`

## 1. Purpose and evidence boundary

This record separates source-grounded design statements from the factual service evidence still required to describe the exact journey and intended outcome for `PUR-CUST-DECLARED-PREFERENCE-v0`.

It does not claim that the candidate journey is live, identify a product channel or deployment that has not been evidenced, invent a business owner, define a field taxonomy, select a lawful basis, allocate controller or processor roles, approve a recipient, set a retention period or authorize implementation.

The record contains no production personal data. A missing operational fact is recorded as `MISSING`, never completed by inference from the North Star or a candidate contract.

## 2. Evidence-state vocabulary

| State | Meaning |
|---|---|
| `SOURCE_VERIFIED_DESIGN_STATEMENT` | the statement is present in an identified versioned design source |
| `CANDIDATE_JOURNEY_ELEMENT` | the element is part of the governed design but is not verified as the exact real service journey |
| `MISSING_FACTUAL_EVIDENCE` | the required product, operational or user-context fact was not identified in the reviewed sources |
| `EXCLUDED_FROM_PURPOSE` | the governed sources expressly exclude the activity from this candidate purpose |

`SOURCE_VERIFIED_DESIGN_STATEMENT` proves what the design document says. It does not prove that the described service exists, is necessary, is legally valid or is implemented.

## 3. Sources reviewed

| Source id | Repository artifact | Relevant sections | Use in this record |
|---|---|---|---|
| `R01-S01` | `docs/NEXT_AIR_002_PURPOSE_AUTHORIZATION_MATRIX_v0.1.md` | Sections 2–6 | candidate outcome, actors, operations, recipients, human-control and authorization boundary |
| `R01-S02` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_LEGAL_PRIVACY_REVIEW_PACKET_v0.1.md` | Sections 1–3 and 6 | bounded review outcome, exclusions, conceptual authority flow and evidence gaps |
| `R01-S03` | `docs/NEXT_AIR_002_GOVERNED_DESIGN_CONTRACT_v0.1.md` | Sections 2, 5, 9 and 11 | provider-neutral trust boundary, correction semantics and action boundary |
| `R01-S04` | `docs/NEXT_AIR_002_RELATIONSHIP_INTELLIGENCE_OS_NORTH_STAR_PROPOSAL.md` | Customer Relationship Twin, STELLA boundary and trust invariants | working North Star context only |
| `R01-S05` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_EVIDENCE_BUNDLE_INDEX_v0.1.md` | Sections 8 and 11 | prior `EBI-R01` gap and fail-closed bundle result |

These are design and governance artifacts. No service log, user-research record, approved product specification, witnessed walkthrough, support procedure, deployment record or volume report was identified as evidence for the exact journey.

## 4. Source-grounded candidate boundary

| Evidence item | Source-grounded statement | Source | State | What it does not prove |
|---|---|---|---|---|
| `R01-E01` | The proposed outcome is to allow a verified customer, or a separately authorized same-Tenant operator, to submit, read or correct an explicitly declared non-sensitive service preference. | `R01-S01`, `R01-S02` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | the final product journey, channel, frequency or necessity |
| `R01-E02` | Candidate actor labels are `SUBJECT_SELF_VERIFIED`, `TENANT_OPERATOR_AUTHORIZED` and `FOUNDATION_CERTIFIED_SERVICE`; the labels create no authority. | `R01-S01`, `R01-S02` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | the actual identity-verification method, role holder or permission |
| `R01-E03` | Candidate operations are `SUBMIT_DECLARATION`, `READ_OWN_DECLARATION`, `REQUEST_CORRECTION` and `SUPERSEDE_WITH_EVIDENCE`. | `R01-S01`, `R01-S02` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | which operations are required by the real service or how often they occur |
| `R01-E04` | The candidate recipient boundary is the verified subject and an authorized same-Tenant service workflow. | `R01-S01` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | the factual recipient, processor, system or transfer inventory |
| `R01-E05` | No declaration authorizes marketing or unrelated profiling. | `R01-S01` | `EXCLUDED_FROM_PURPOSE` | the transparency wording or the legal assessment |
| `R01-E06` | Allergy, health, disability, other special-category data, inferred preferences, behavioral profiling and cross-Tenant use are excluded. | `R01-S02` | `EXCLUDED_FROM_PURPOSE` | that an implemented interface can prevent every prohibited input |
| `R01-E07` | The conceptual mutation path is fail-closed and preserves trusted actor/scope resolution, permission, entitlement where applicable, purpose authorization, validation, transaction, domain validation, idempotency, audit, outbox and typed result. | `R01-S01`, `R01-S02`, `R01-S03` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | an implemented route, system topology, field flow or runtime control |
| `R01-E08` | Corrections must preserve provenance and explicit supersession rather than silently overwriting history. | `R01-S02`, `R01-S03` | `SOURCE_VERIFIED_DESIGN_STATEMENT` | the real correction service, owner, timeline or recipient reconciliation |

## 5. Candidate journey skeleton — not verified as the exact service journey

| Stage | Source-grounded candidate element | Evidence state | Required factual confirmation |
|---|---|---|---|
| `J00` | a service need or subject request precedes the candidate operation | `MISSING_FACTUAL_EVIDENCE` | exact trigger, service context, product/vertical, entry channel and initiating event |
| `J01` | a verified customer or separately authorized same-Tenant operator initiates one candidate operation | `CANDIDATE_JOURNEY_ELEMENT` | actual actor, identity method, assisted-service conditions and user-facing surface |
| `J02` | Foundation resolves trusted actor, Tenant, Location where required and subject relationship | `CANDIDATE_JOURNEY_ELEMENT` | exact authoritative systems and deployment context |
| `J03` | permission, entitlement where applicable and the exact purpose version are evaluated fail-closed | `CANDIDATE_JOURNEY_ELEMENT` | accepted permission, entitlement and policy owners; none are approved by this record |
| `J04` | the selected candidate operation is validated against an approved minimized field policy | `CANDIDATE_JOURNEY_ELEMENT` | exact field taxonomy and field-by-field necessity evidence |
| `J05` | an accepted future implementation would preserve transaction, domain validation, idempotency, audit, outbox and a typed result | `CANDIDATE_JOURNEY_ELEMENT` | actual application service, system sequence, errors, support path and test evidence |
| `J06` | reading returns only an authorized minimized own-subject projection | `CANDIDATE_JOURNEY_ELEMENT` | exact presentation, recipient, refresh behavior and user comprehension evidence |
| `J07` | correction or supersession appends evidence, preserves history and rebuilds affected projections under policy | `CANDIDATE_JOURNEY_ELEMENT` | actual correction owner, service levels, notification, reconciliation and consequences |
| `J08` | the journey ends with an explained service result or denial | `MISSING_FACTUAL_EVIDENCE` | exact success outcome, denial handling, human contact and operational consequence |

This skeleton is deliberately not labelled a user flow, implemented process or approved service blueprint.

## 6. Intended-outcome evidence

### Source-grounded candidate outcome

`Allow a verified customer, or an operator separately authorized within the trusted same-Tenant relationship, to submit, read or correct an explicitly declared non-sensitive service preference.`

**Provenance:** `R01-S01` and `R01-S02`.

**Evidence state:** `SOURCE_VERIFIED_DESIGN_STATEMENT`.

### Factual outcome still required

The reviewed sources do not establish:

- the exact customer problem or service failure this purpose is intended to address;
- the concrete service result that the customer and service team must observe;
- whether the journey is new, replaces an existing process or supports an existing assisted workflow;
- the accountable service owner and product/vertical in scope;
- the operational consequence if the declaration is unavailable, stale, wrong or misapplied;
- measurable acceptance criteria, frequency, volume or evidence of user expectation;
- whether all four candidate operations are necessary for the exact service context.

Therefore the intended outcome is source-grounded as a **candidate design objective**, but not verified as the final factual service outcome.

## 7. Factual evidence capture ledger

The accountable source owner must complete this ledger with evidence references. `TBD`, unsupported prose or a role title without an accountable person does not close the requirement.

| Required fact | Current value | Acceptable evidence examples | Status |
|---|---|---|---|
| accountable service owner | `UNASSIGNED` | named owner and dated attestation or approved product record | `MISSING` |
| exact product and vertical | `NOT_VERIFIED` | approved product specification or controlled roadmap reference | `MISSING` |
| deployment context | `NOT_VERIFIED` | environment and system-boundary record | `MISSING` |
| current or planned service trigger | `NOT_VERIFIED` | witnessed walkthrough, service blueprint or approved process record | `MISSING` |
| customer/operator entry channel | `NOT_VERIFIED` | controlled interface specification or observed workflow evidence | `MISSING` |
| actual actor and verification method | `NOT_VERIFIED` | identity and assisted-service process evidence | `MISSING` |
| intended customer-visible result | `CANDIDATE_STATEMENT_ONLY` | approved outcome statement plus acceptance evidence | `PARTIAL` |
| intended operational result | `NOT_VERIFIED` | service-owner evidence and measurable acceptance criteria | `MISSING` |
| operation-by-operation necessity | `NOT_VERIFIED` | service evidence for each retained operation | `MISSING` |
| frequency and expected volume | `NOT_VERIFIED` | approved forecast or observed non-production-safe aggregate | `MISSING` |
| consequence of absence, error or stale data | `NOT_VERIFIED` | risk/workflow assessment with concrete scenarios | `MISSING` |
| denial, correction and human-support path | `CANDIDATE_BOUNDARY_ONLY` | approved service procedure and witnessed walkthrough | `PARTIAL` |
| factual recipients and downstream use | `NOT_VERIFIED` | system/recipient inventory and service walkthrough | `MISSING` |
| supporting user-expectation evidence | `NOT_VERIFIED` | approved research or equivalent purpose-specific evidence | `MISSING` |

No production personal data is required to complete this ledger. Evidence must be minimized, controlled and suitable for the source classification.

## 8. Operation-level status

| Candidate operation | Candidate outcome available | Exact service context verified | Frequency/consequence verified | EBI-R01 status |
|---|---|---|---|---|
| `SUBMIT_DECLARATION` | `YES_SOURCE_GROUNDED` | `NO` | `NO` | `PARTIAL` |
| `READ_OWN_DECLARATION` | `YES_SOURCE_GROUNDED` | `NO` | `NO` | `PARTIAL` |
| `REQUEST_CORRECTION` | `YES_SOURCE_GROUNDED` | `NO` | `NO` | `PARTIAL` |
| `SUPERSEDE_WITH_EVIDENCE` | `YES_SOURCE_GROUNDED` | `NO` | `NO` | `PARTIAL` |

## 9. Readiness rule

`EBI-R01` may change to `READY` only when a controlled evidence version identifies and verifies, at minimum:

1. accountable service owner, product/vertical and deployment context;
2. exact trigger, entry channel, actual actors and identity/assistance conditions;
3. retained operations and their operation-specific intended outcomes;
4. sequence from initiation through result, denial, correction and human support;
5. frequency or expected volume and foreseeable consequences of absence, error or stale use;
6. factual recipients and downstream service uses at journey level;
7. dated evidence references and verification by the accountable source owner;
8. an explicit statement that the evidence describes the exact proposed service version reviewed.

Field-level flow, taxonomy, lawful basis, legal roles, retention and full DPIA remain separate evidence requirements. Closing `EBI-R01` alone cannot activate the purpose.

## 10. Current result

**Capture structure prepared:** `true`

**Source-grounded candidate boundary recorded:** `true`

**Exact service journey verified:** `false`

**Factual evidence owner assigned:** `false`

**EBI-R01 status:** `PARTIAL`

**Purpose enabled:** `false`

**Runtime implementation:** `BLOCKED`

**Next safe action:** obtain `EBI-R01-A`, a dated service-owner evidence entry covering the exact product context, trigger, channel, actors, intended results, frequency and consequences, with controlled supporting references. Do not add field definitions, legal conclusions or operational authority to that entry.
