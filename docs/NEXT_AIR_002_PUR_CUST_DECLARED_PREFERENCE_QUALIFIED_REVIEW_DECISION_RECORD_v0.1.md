# NEXT-AIR-002 — Declared Preference Qualified Review Decision Record v0.1

**Artifact class:** `GOVERNED_DESIGN_QUALIFIED_REVIEW_RECORD_TEMPLATE_NOT_LEGAL_ADVICE`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Candidate purpose:** `PUR-CUST-DECLARED-PREFERENCE-v0`

**Template state:** `FORM_READY_UNCOMPLETED`

**Qualified decision recorded:** `false`

**Purpose state:** `DISABLED`

**Lawful bases approved:** `0`

**Runtime implementation authorized:** `false`

## 1. Use of this record

This template records the evidence-backed decision of qualified legal and privacy reviewers for the exact candidate purpose and version identified above. It does not provide legal advice, preselect an outcome, activate processing, authorize implementation or replace the separate AIRenOS governance decision.

Before completing it, reviewers must read:

- `NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_LEGAL_PRIVACY_REVIEW_PACKET_v0.1.md`;
- `NEXT_AIR_002_PURPOSE_AUTHORIZATION_MATRIX_v0.1.md`;
- `NEXT_AIR_002_DPIA_SCREENING_AND_THREAT_MODEL_v0.1.md`;
- the exact evidence references entered in this record;
- applicable law and current authoritative guidance.

The blank template must remain unchanged. A completed review must be saved as a new versioned record with its own immutable identifier and evidence references. Names, dates, conclusions and signatures must be supplied by the actual reviewers; none may be inferred or generated from role titles.

## 2. Fail-closed completeness rule

The decision remains `NOT_RECORDED` if any required field is blank, `TBD`, unsupported by an evidence reference, internally inconsistent or signed by a person whose capacity has not been recorded.

Even a complete review cannot change the purpose from `DISABLED`. It may only recommend one of the outcomes in Section 13 for a separate AIRenOS governance decision.

## 3. Record identity

| Required field | Reviewer entry |
|---|---|
| completed record identifier | `TBD_REQUIRED` |
| template version used | `v0.1` |
| purpose id and version reviewed | `PUR-CUST-DECLARED-PREFERENCE-v0` |
| review start date | `TBD_REQUIRED` |
| review completion date | `TBD_REQUIRED` |
| governing jurisdiction and applicable law | `TBD_REQUIRED` |
| legal entity or entities in scope | `TBD_REQUIRED` |
| exact product, service journey and deployment context | `TBD_REQUIRED` |
| evidence bundle version or immutable reference | `TBD_REQUIRED` |
| change summary from prior review, if any | `TBD_OR_NOT_APPLICABLE_WITH_REASON` |

## 4. Reviewer identity, capacity and independence

Each reviewer completes a separate row. A role title without the accountable natural person is insufficient.

| Review domain | Name | Organization | Professional capacity | Independence or conflict statement | Signature method/reference | Date | Status |
|---|---|---|---|---|---|---|---|
| qualified legal | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| privacy / DPO where applicable | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| security | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| data governance | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |

The accountable controller determines whether DPO involvement is required and must document that determination. This template does not designate a DPO or assign a statutory role.

## 5. Evidence intake and verification

`RECEIVED` alone is not sufficient. Reviewers must record whether the evidence was verified and whether it supports the decision.

| Evidence item | Immutable reference | Owner | Verified by | Verification result | Gap or condition |
|---|---|---|---|---|---|
| exact service journey and intended outcome | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| field-level data-flow and trust-boundary diagram | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| proposed closed field taxonomy and classification | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| necessity and less-intrusive-alternative assessment | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| subject reasonable-expectation evidence | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| controller/processor factual role assessment | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| recipient, processor, sub-processor and transfer inventory | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| transparency notice and rights-handling design | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| retention, deletion and reconciliation schedule | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| DPIA and DPO advice where applicable | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| threat model, control owners and test evidence | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |
| record-of-processing linkage | `TBD_REQUIRED` | `TBD` | `TBD` | `NOT_VERIFIED` | `OPEN` |

Production personal data must not be copied into this record. Evidence references must use approved controlled locations and must not expose secrets.

## 6. Exact processing scope reviewed

The reviewer must replace the candidate descriptions with the verified final facts or reject the operation.

| Operation | Exact actor and trusted scope | Exact outcome | Exact fields/taxonomy version | Recipients | Frequency | Decision scope status |
|---|---|---|---|---|---|---|
| `SUBMIT_DECLARATION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `UNVERIFIED` |
| `READ_OWN_DECLARATION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `UNVERIFIED` |
| `REQUEST_CORRECTION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `UNVERIFIED` |
| `SUPERSEDE_WITH_EVIDENCE` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `UNVERIFIED` |

Confirmed exclusions must include special-category data, free text unless separately justified, inference, marketing, cross-Tenant use, universal scoring, model training, significant solely automated decisions and direct STELLA writes.

**Exclusions verified:** `false`

**Evidence reference:** `TBD_REQUIRED`

## 7. Lawful-basis decision by operation

One generic feature-level basis is insufficient. Each approved operation requires a documented decision tied to verified facts.

| Operation | Article 6 basis selected | Necessity test reference | Additional conditions | Rejected alternatives and reason | Reviewer conclusion |
|---|---|---|---|---|---|
| `SUBMIT_DECLARATION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_OR_NOT_APPLICABLE_WITH_REASON` | `TBD_REQUIRED` | `NOT_DECIDED` |
| `READ_OWN_DECLARATION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_OR_NOT_APPLICABLE_WITH_REASON` | `TBD_REQUIRED` | `NOT_DECIDED` |
| `REQUEST_CORRECTION` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_OR_NOT_APPLICABLE_WITH_REASON` | `TBD_REQUIRED` | `NOT_DECIDED` |
| `SUPERSEDE_WITH_EVIDENCE` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_OR_NOT_APPLICABLE_WITH_REASON` | `TBD_REQUIRED` | `NOT_DECIDED` |

If consent is selected, attach the granular consent, refusal, withdrawal and reconciliation assessment. If legitimate interests are selected, attach the purpose, necessity and balancing assessment and objection handling. If Article 6(1)(b) is selected, attach the objective contractual-necessity analysis. Any other basis must cite the exact applicable legal provision.

**Special-category condition required:** `TBD_REVIEWER_DECISION`

If `true`, this ordinary declared-preference purpose must be rejected or narrowed because its approved boundary excludes Article 9 data.

## 8. Accountability and role allocation decision

Roles must follow the verified factual allocation of purposes and essential means; they cannot be assigned from product names alone.

| Participant | Verified processing activity | Role conclusion | Legal and contractual basis | Required agreement/control | Reviewer status |
|---|---|---|---|---|---|
| AIRenOS platform authority | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `NOT_DECIDED` |
| Tenant legal entity | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `NOT_DECIDED` |
| vertical application | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `NOT_DECIDED` |
| Base44, if retained in the accepted design | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_DPA_AND_TRANSFER_REVIEW` | `NOT_DECIDED` |
| each other provider or recipient | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD_REQUIRED` | `NOT_DECIDED` |

## 9. Transparency and rights decision

| Requirement | Approved design/evidence reference | Applicable operations | Owner | Test evidence | Status |
|---|---|---|---|---|---|
| Articles 12–14 information | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| access | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| rectification and contestation | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| erasure and restriction where applicable | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| portability where applicable | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| objection where applicable | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| consent withdrawal where applicable | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |
| complaint and human-contact path | `TBD_REQUIRED` | `TBD_REQUIRED` | `TBD` | `TBD` | `OPEN` |

**Transparency and rights conclusion:** `NOT_DECIDED`

## 10. Retention, deletion and reconciliation decision

| Record class | Start trigger | Active duration | Superseded duration | Deletion/anonymization rule | Legal-hold separation | Evidence/test | Status |
|---|---|---|---|---|---|---|---|
| current declaration | `TBD` | `TBD` | `N/A` | `TBD` | `TBD` | `TBD` | `OPEN` |
| superseded declaration | `TBD` | `N/A` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| correction evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| authorization evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |
| audit and outbox evidence | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `OPEN` |

**Retention schedule approved:** `false`

## 11. DPIA, residual risk and prior consultation

The governing screening result is `FULL_DPIA_REQUIRED_BEFORE_IMPLEMENTATION_REVIEW`.

| Required decision | Reviewer entry |
|---|---|
| full DPIA identifier and version | `TBD_REQUIRED` |
| DPO advice reference where applicable | `TBD_REQUIRED_OR_REASON_NOT_APPLICABLE` |
| risk-owner approvals | `TBD_REQUIRED` |
| unresolved high risks | `TBD_REQUIRED` |
| residual-risk decision and accountable authority | `TBD_REQUIRED` |
| Article 36 prior consultation required | `TBD_REVIEWER_DECISION` |
| prior-consultation evidence or reason not required | `TBD_REQUIRED` |
| DPIA review/expiry trigger | `TBD_REQUIRED` |

If high risk remains in the absence of measures that mitigate it, the reviewer must record the required supervisory-authority consultation decision before recommending progression. This record cannot perform that consultation.

## 12. Security and Foundation boundary decision

| Control | Evidence reference | Owner | Test result | Reviewer conclusion |
|---|---|---|---|---|
| trusted actor and subject resolution | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| trusted Tenant/Location resolution and unknown-host denial | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| permission and entitlement before purpose authorization | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| closed field allowlist and sensitive-data separation | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| idempotency, audit, outbox and typed result | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| correction, revocation and cache/projection reconciliation | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| cross-Tenant negative isolation tests | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| proposal-only STELLA and no direct writes | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |
| processor, transfer, logging and secret controls | `TBD_REQUIRED` | `TBD` | `NOT_RUN` | `OPEN` |

**Security review outcome:** `NOT_DECIDED`

## 13. Qualified review outcome

Select exactly one outcome and explain it with evidence:

- `APPROVE_FOR_SEPARATE_CANONICAL_DESIGN_PROPOSAL_WITH_CONDITIONS`;
- `REVISE_AND_RESUBMIT`;
- `DEFER_PENDING_EVIDENCE`;
- `REJECT`.

**Selected outcome:** `NOT_SELECTED`

**Reasoned conclusion:** `TBD_REQUIRED`

**Mandatory conditions:** `TBD_REQUIRED_OR_NONE_WITH_REASON`

**Rejected or excluded elements:** `TBD_REQUIRED_OR_NONE_WITH_REASON`

**Expiry or mandatory re-review trigger:** `TBD_REQUIRED`

**Consolidated evidence references:** `TBD_REQUIRED`

## 14. Final attestations

Each accountable reviewer must attest only to their own review domain.

| Attestation | Reviewer entry |
|---|---|
| facts and evidence reviewed are identified and versioned | `NOT_ATTESTED` |
| assumptions and unavailable evidence are explicit | `NOT_ATTESTED` |
| conclusions are limited to the exact purpose/version and deployment context | `NOT_ATTESTED` |
| required conditions and dissenting views are preserved | `NOT_ATTESTED` |
| no signature or approval was generated on behalf of another person | `NOT_ATTESTED` |
| the outcome does not itself activate processing or implementation | `NOT_ATTESTED` |

**Qualified legal sign-off reference:** `TBD_REQUIRED`

**Privacy/DPO advice or sign-off reference where applicable:** `TBD_REQUIRED_OR_REASON_NOT_APPLICABLE`

**Security sign-off reference:** `TBD_REQUIRED`

**Record completion status:** `INCOMPLETE`

## 15. AIRenOS governance handoff

A completed record is evidence input to governance, not governance authority.

| Governance field | Current value |
|---|---|
| qualified review decision | `NOT_RECORDED` |
| recommended next state | `NONE` |
| canonical-design proposal authorized | `false` |
| schema or migration authorized | `false` |
| Base44 resource or deployment authorized | `false` |
| runtime implementation authorized | `false` |
| production processing authorized | `false` |
| separate AIRenOS governance decision required | `true` |

After qualified completion, AIRenOS governance must validate record identity, reviewer capacity, evidence references, conditions, dissent, DPIA status and change scope. Any later purpose, field, actor, recipient, provider, model, retention or deployment-context change triggers a new review or an explicitly documented non-material-change determination by the competent reviewers.

## 16. Official guardrails

- Regulation (EU) 2016/679, including Articles 5, 6, 7, 12–14, 24, 25, 28, 30, 35–39: `https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng`
- EDPB-endorsed WP29 DPIA Guidelines, WP248 rev.01: `https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/data-protection-impact-assessments-high-risk-processing_en`
- EDPB-endorsed WP29 DPO Guidelines, WP243 rev.01: `https://www.edpb.europa.eu/documents/guideline/data-protection-officer_en`
- EDPB Guidelines 2/2019 on Article 6(1)(b): `https://www.edpb.europa.eu/documents/guideline/guidelines-22019-on-the-processing-of-personal-data-under-article-61b-gdpr-in_en`
- EDPB Guidelines 05/2020 on consent: `https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en`
- EDPB-endorsed WP29 transparency Guidelines, WP260 rev.01: `https://www.edpb.europa.eu/documents/guideline/article-29-working-party-guidelines-on-transparency-under-regulation-2016679_en`

The EDPB DPIA template published for public consultation in 2026 is not treated in this record as final adopted authority. Qualified reviewers must verify current status and applicable national requirements when completing the record.

## 17. Current gate result

**Decision form:** `READY`

**Decision recorded:** `false`

**Completed signatories:** `0`

**Purpose enabled:** `false`

**Lawful bases approved:** `0`

**Runtime implementation:** `BLOCKED`

**Next safe action:** provide this blank record and its evidence packet to the actual qualified reviewers; do not prefill their identity, conclusions or signatures.
