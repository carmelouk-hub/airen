# NEXT-AIR-002 — Declared Preference Legal & Privacy Review Packet v0.1

**Artifact class:** `GOVERNED_DESIGN_REVIEW_PACKET_NOT_LEGAL_ADVICE`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Candidate purpose:** `PUR-CUST-DECLARED-PREFERENCE-v0`

**Review packet state:** `PACKET_READY_FOR_QUALIFIED_REVIEW`

**Purpose state:** `DISABLED_PENDING_QUALIFIED_REVIEW`

**Lawful basis selected:** `NONE_TBD`

**Controller/processor allocation:** `TBD`

**Runtime implementation authorized:** `false`

## 1. Decision requested

This packet asks qualified legal and privacy reviewers to decide whether a narrowly bounded declared-preference purpose can proceed to a future canonical-design proposal, under which exact lawful basis, role allocation and safeguards.

It does not request or authorize activation, implementation, production processing, a consent flow, a Base44 data resource or canonical promotion. A completed review can only produce a recommendation for a separate AIRenOS governance decision.

The default and current result is denial:

`PURPOSE_DISABLED -> DENY_PURPOSE`

## 2. Candidate purpose boundary

### Proposed outcome

Allow a verified customer, or an operator separately authorized within the trusted same-Tenant relationship, to submit, read or correct an explicitly declared non-sensitive service preference.

### Candidate operations

| Operation | Candidate actor | Candidate effect | Current state |
|---|---|---|---|
| `SUBMIT_DECLARATION` | `SUBJECT_SELF_VERIFIED` or separately authorized same-Tenant operator | append a typed declaration with provenance | `DISABLED` |
| `READ_OWN_DECLARATION` | `SUBJECT_SELF_VERIFIED` | return only the subject's authorized minimized projection | `DISABLED` |
| `REQUEST_CORRECTION` | `SUBJECT_SELF_VERIFIED` | open a correction request without silently overwriting history | `DISABLED` |
| `SUPERSEDE_WITH_EVIDENCE` | separately authorized application service or operator | append reviewed evidence and mark the prior version superseded | `DISABLED` |

Actor labels are design candidates. They do not create a role or permission. Identity, Tenant, Location, subject relationship, permission and entitlement must be resolved from trusted Foundation context.

### Candidate data classes

- a value selected from a future legally and canonically approved non-sensitive preference taxonomy;
- exact taxonomy and schema version;
- trusted opaque subject and scope references;
- declaration source and timestamp;
- confirmation, correction and supersession evidence references;
- purpose, policy and authorization decision references;
- minimum audit and outbox evidence required by Foundation.

No concrete preference taxonomy or field allowlist is approved by this packet. Free text is excluded from the candidate minimum because its necessity and sensitive-data exposure have not been justified.

### Explicit exclusions

- allergy, health, disability or any special-category data;
- inferred preferences or behavioral profiling;
- marketing, advertising or unrelated personalization;
- cross-Tenant merging, enrichment, comparison or disclosure;
- universal customer scoring or public profile creation;
- solely automated decisions with legal or similarly significant effects;
- model training on relationship data;
- direct STELLA writes or any action executed solely from a STELLA proposal;
- client-supplied Tenant, Location, actor, purpose or subject identifiers used as authority.

Declared allergy and health-safety information remains outside this purpose and requires its own Article 9 and safety-contract review.

## 3. Necessity and proportionality worksheet

The reviewer must complete every row with evidence. `TBD` is not approval.

| Operation | Exact user or service outcome | Why each proposed field is necessary | Less intrusive alternative tested | Reasonable expectation evidence | Decision |
|---|---|---|---|---|---|
| `SUBMIT_DECLARATION` | `TBD` | `TBD_FIELD_BY_FIELD` | `TBD` | `TBD` | `TBD` |
| `READ_OWN_DECLARATION` | `TBD` | `TBD_FIELD_BY_FIELD` | `TBD` | `TBD` | `TBD` |
| `REQUEST_CORRECTION` | `TBD` | `TBD_FIELD_BY_FIELD` | `TBD` | `TBD` | `TBD` |
| `SUPERSEDE_WITH_EVIDENCE` | `TBD` | `TBD_FIELD_BY_FIELD` | `TBD` | `TBD` | `TBD` |

Required evidence includes the exact service journey, field-level data-flow map, alternative design assessment, user-research or equivalent expectation evidence, recipients, frequency, retention and foreseeable consequences of error.

## 4. Lawful-basis assessment

No lawful basis is preferred or selected by this packet. Reviewers must assess the exact operation and processing context rather than assigning one basis to the feature name.

### Article 6(1)(b) — contract or pre-contractual steps

The reviewer must document:

1. the valid contract or the data subject's specific pre-contractual request;
2. the contract's objective and fundamental purpose;
3. why the exact processing is objectively necessary to perform that contract or requested step;
4. why a realistic, less intrusive means cannot achieve the same contractual objective;
5. which candidate operations, if any, satisfy this test independently.

Convenience, product improvement, contractual wording alone or a general connection with the service is insufficient evidence. Result: `TBD_QUALIFIED_REVIEW`.

### Articles 6(1)(a) and 7 — consent

If consent is considered, the reviewer must establish and evidence that it is freely given, specific, informed, unambiguous and demonstrable; separated from unrelated purposes; expressed by a clear affirmative action; and as easy to withdraw as to give. The consequences of refusal and withdrawal, including downstream reconciliation, must be specified without dark patterns or service detriment that would invalidate freedom of choice.

Consent would authorize only the exact covered purpose. It would not grant identity, scope, permission, entitlement, field access or operational authority. This packet approves no wording, interface or consent record. Result: `TBD_QUALIFIED_REVIEW`.

### Article 6(1)(f) — legitimate interests

If legitimate interests are considered, the reviewer must complete a documented three-part test:

1. identify a lawful, precisely articulated and present interest;
2. demonstrate necessity for the exact processing and assess less intrusive alternatives;
3. balance the interest against the subject's rights, freedoms, reasonable expectations, data nature, context, impact and safeguards.

The applicable right to object, its handling and the effect on future processing must be designed and tested. The EDPB Guidelines 1/2024 located during preparation are consultation material, not a final adopted authority; they may inform questions but cannot be represented here as final guidance. Result: `TBD_QUALIFIED_REVIEW`.

### Other Article 6 bases

Any proposed legal obligation, vital-interest task, public-interest task or official authority must cite the exact applicable law and demonstrate its operation-specific scope. None is identified or assumed here. Result: `NOT_ASSESSED`.

### Selection record

| Operation | Selected basis | Evidence reference | Reviewer | Decision date | Status |
|---|---|---|---|---|---|
| `SUBMIT_DECLARATION` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| `READ_OWN_DECLARATION` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| `REQUEST_CORRECTION` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| `SUPERSEDE_WITH_EVIDENCE` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |

## 5. Accountability and role allocation

The controller, joint-controller, processor and sub-processor roles cannot be inferred from the product names or hosting relationship. Qualified review must map factual purposes and means for each participant.

| Participant or layer | Factual processing activity | Determines purposes? | Determines essential means? | Candidate role | Contract/evidence | Status |
|---|---|---|---|---|---|---|
| AIRenOS platform authority | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| Tenant legal entity | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| Vertical application | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| Base44 service, if retained in an accepted architecture | `TBD` | `TBD` | `TBD` | `TBD` | `TBD_DPA_TRANSFER_REVIEW` | `OPEN` |
| Other providers or recipients | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |

No vendor or participant is assigned a legal role by this document.

## 6. Conceptual data flow and authority boundary

This is a review model, not an implemented flow:

`verified interface -> Foundation application service -> trusted actor and scope resolution -> permission -> entitlement if applicable -> exact purpose authorization -> validated transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

- Base44 may present a future accepted experience but cannot be identity, Tenant, permission or purpose authority.
- Foundation remains provider-neutral and accepts only typed, governed contracts.
- STELLA may only receive a purpose-authorized minimized projection and formulate a proposal; it cannot write directly or expand authority.
- Every cache, cursor and projection must bind to trusted scope, subject, purpose/version, allowed-field policy, authorization policy, revocation/contestation watermark and expiry.
- Unknown or ambiguous host and scope resolve to denial, never to a default Tenant.

Before review closure, the conceptual flow must be replaced by a field-level diagram naming systems, storage, processors, recipients, transfer locations, encryption boundaries and deletion paths.

## 7. Transparency and subject rights

Before any future implementation proposal, reviewers must approve:

- layered, concise and intelligible Articles 12–14 information for the exact purpose;
- identity and contact details of the accountable controller and DPO where applicable;
- purpose, selected lawful basis, legitimate interests if applicable, recipients and transfers;
- retention criteria or exact periods;
- access, rectification, erasure, restriction, portability and complaint handling as applicable;
- objection handling where Article 6(1)(e) or (f) applies;
- withdrawal handling where consent applies;
- any automated-decision information required by the final design;
- a correction and contestation path that preserves provenance and propagates to recipients and projections.

The rights applicability matrix and service-level targets remain `TBD`. The interface must not claim a right has been fulfilled merely because a request button exists.

## 8. Retention, deletion and reconciliation

No retention duration is approved. Reviewers must separately determine and justify:

| Record class | Start trigger | Active duration | Superseded duration | Deletion/anonymization rule | Legal hold separation | Status |
|---|---|---|---|---|---|---|
| current declaration | `TBD` | `TBD` | `N/A` | `TBD` | `TBD` | `OPEN` |
| superseded declaration | `TBD` | `N/A` | `TBD` | `TBD` | `TBD` | `OPEN` |
| correction evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| purpose authorization evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| audit and outbox evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |

The future design must prove expiry, deletion or anonymization, cache invalidation, Twin rebuild and recipient reconciliation with synthetic tests.

## 9. Minimum privacy and security controls

- closed, versioned field taxonomy and server-side allowlist;
- no free text until separately justified and controlled;
- explicit separation of sensitive and special-category data;
- trusted actor, Tenant, Location and subject resolution;
- least-privilege permission and entitlement checks before purpose authorization;
- exact purpose/version and operation binding with fail-closed typed denials;
- provenance, confirmation and explicit supersession rather than silent overwrite;
- encryption, access logging and data-minimized audit evidence;
- correction, objection or withdrawal propagation according to the selected basis;
- cross-Tenant, unknown-host, excessive-field, revoked-use and contested-claim negative tests;
- proposal-only STELLA boundary and fresh human/application-service authorization for actions;
- versioned migrations for any future schema change;
- synthetic fixtures only; no production data in tests, prompts or logs;
- no provider secrets in Git, operational rows, fixtures, logs or prompts.

## 10. DPIA and AI boundary

The governing DPIA screening result remains `FULL_DPIA_REQUIRED_BEFORE_IMPLEMENTATION_REVIEW`. This packet contributes one bounded purpose assessment but does not complete the DPIA, residual-risk acceptance, record-of-processing linkage, processor assessment, transfer assessment or AI Act classification.

The candidate purpose excludes inference and significant automated decisions. Any future expansion would be a new purpose/version requiring fresh legal, DPIA, security and governance review; it cannot inherit this packet.

## 11. Required sign-offs

Every decision must name an accountable natural person and evidence reference. Role titles alone do not constitute approval.

| Review domain | Required decision | Reviewer | Conditions/evidence | Status |
|---|---|---|---|---|
| qualified legal | operation-level lawful basis and legal conditions | `TBD` | `TBD` | `OPEN` |
| privacy/DPO where applicable | necessity, proportionality, rights, DPIA advice | `TBD` | `TBD` | `OPEN` |
| security | threat controls and verification plan | `TBD` | `TBD` | `OPEN` |
| data governance | field taxonomy, retention and deletion | `TBD` | `TBD` | `OPEN` |
| AIRenOS architecture | Foundation boundary and typed contracts | `TBD` | `TBD` | `OPEN` |
| AIRenOS governance | separate canonical-design decision | `TBD` | `TBD` | `OPEN` |

Permitted review outcomes are:

- `APPROVE_FOR_SEPARATE_CANONICAL_DESIGN_PROPOSAL_WITH_CONDITIONS`;
- `REVISE_AND_RESUBMIT`;
- `DEFER_PENDING_EVIDENCE`;
- `REJECT`.

No outcome in this packet activates processing or authorizes implementation.

## 12. Reviewer decision form

The operational blank record is maintained separately in `NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_QUALIFIED_REVIEW_DECISION_RECORD_v0.1.md`. It must be copied to a new versioned record and completed by the actual qualified reviewers; the blank template cannot be treated as a decision.

**Outcome:** `TBD`

**Approved exact purpose/version:** `TBD`

**Approved operations:** `TBD`

**Selected lawful basis per operation:** `TBD`

**Approved field taxonomy/version:** `TBD`

**Approved recipients and transfers:** `TBD`

**Approved retention schedule/version:** `TBD`

**Mandatory conditions:** `TBD`

**Rejected or excluded elements:** `TBD`

**Evidence references:** `TBD`

**Reviewer name, capacity and date:** `TBD`

**Separate AIRenOS governance decision required:** `true`

## 13. Official sources used as review guardrails

- Regulation (EU) 2016/679, especially Articles 5, 6, 7, 12–14, 16, 17, 18, 20, 21, 22, 25, 28, 30 and 35: `https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng`
- EDPB Guidelines 2/2019 on Article 6(1)(b) in online services, final version: `https://www.edpb.europa.eu/documents/guideline/guidelines-22019-on-the-processing-of-personal-data-under-article-61b-gdpr-in_en`
- EDPB Guidelines 05/2020 on consent: `https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en`
- WP29 Guidelines on transparency under Regulation 2016/679, WP260 rev.01, endorsed by the EDPB: `https://www.edpb.europa.eu/documents/guideline/article-29-working-party-guidelines-on-transparency-under-regulation-2016679_en`
- EDPB automated decision-making and profiling guidance: `https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en`
- EDPB Guidelines 1/2024 on legitimate interests, public-consultation version only: `https://www.edpb.europa.eu/public-consultations/guidelines-12024-on-processing-of-personal-data-based-on-article-61f-gdpr_en`

These authorities frame the questions; a qualified reviewer must apply them to the verified facts and applicable law. This packet is not legal advice.

## 14. Gate result

**Review packet:** `READY`

**Qualified review completed:** `false`

**Purpose enabled:** `false`

**Lawful bases approved:** `0`

**Controller/processor roles approved:** `0`

**Full DPIA completed:** `false`

**Canonical proposal authorized:** `false`

**Runtime implementation:** `BLOCKED`

**Next safe action:** route this packet to qualified legal and privacy reviewers; record their evidence-backed decision without changing the disabled runtime state.
