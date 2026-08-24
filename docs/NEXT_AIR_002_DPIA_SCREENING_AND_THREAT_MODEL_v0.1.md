# NEXT-AIR-002 — DPIA Screening and Threat Model v0.1

**Artifact class:** `GOVERNED_DESIGN_NOT_LEGAL_ADVICE`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Processing authorized:** `false`

**DPIA status:** `FULL_DPIA_REQUIRED_BEFORE_IMPLEMENTATION_REVIEW`

## 1. Screening conclusion

Relationship Intelligence proposes systematic interpretation of customer and supplier relationship data, including profiling-like claims and AI-assisted recommendations. The design also contemplates new technology, matching event histories and potentially sensitive safety data in a separate compartment.

The conservative AIRenOS decision is to require a full DPIA before any implementation review. This is a governance decision, not a final legal determination.

The European Commission explains that a DPIA is required where processing is likely to result in high risk, including systematic and extensive evaluation of personal aspects based on automated processing and profiling. The assessment must occur before processing and remain a living instrument. The EDPB has endorsed guidance on automated decision-making/profiling and DPIA high-risk criteria.

## 2. Intended processing under assessment

Candidate processing includes:

- ingesting minimized certified customer, feedback and supplier events;
- deriving expiring, evidence-backed claims;
- presenting purpose-specific Customer or Supplier Twin projections;
- proposing customer-service or procurement actions;
- receiving corrections, contestations and revocations;
- possible future selective portability through Relationship Passport.

No processing is active under this document.

## 3. Data subjects and stakeholders

- customers and prospective customers;
- supplier contacts and sole traders where information relates to a natural person;
- authorized Tenant and Location operators;
- restaurant or vertical administrators;
- platform security, privacy and governance personnel;
- downstream recipients explicitly authorized by a future purpose contract.

## 4. Necessity and proportionality questions

The full DPIA must answer, with evidence:

1. What specific service or procurement outcome requires each data category?
2. Can the outcome be achieved with fewer fields, shorter retention or aggregate data?
3. Which lawful basis applies to each purpose and who approved it?
4. Which operations require consent, and how can it be refused or withdrawn without dark patterns?
5. How are notice, access, correction, objection, portability and deletion requests handled?
6. How is solely automated decision-making prevented where legal or similarly significant effects are possible?
7. How are vulnerable subjects and power imbalances protected?
8. Which recipients, processors, sub-processors and transfer locations are involved?
9. How are model, rule and data changes re-assessed?
10. How is effectiveness of every mitigation tested?

## 5. Preliminary risk register

Scales are qualitative design labels only: likelihood and impact are `LOW`, `MEDIUM` or `HIGH`. Residual ratings remain provisional until the full DPIA validates controls.

| ID | Threat or harm | Initial risk | Required mitigation | Residual target | Status |
|---|---|---|---|---|---|
| RI-T01 | cross-Tenant or cross-Location disclosure | `HIGH/HIGH` | trusted scope resolution, deny-by-default policy, RLS plus field DTO minimization, negative isolation tests | `LOW/HIGH` | `OPEN` |
| RI-T02 | client-supplied Tenant treated as authority | `HIGH/HIGH` | ignore client authority claims; resolve scope server-side; typed denial | `LOW/HIGH` | `OPEN` |
| RI-T03 | purpose drift or secondary use | `HIGH/HIGH` | versioned purpose binding, allowed-field contract, expiry, audit and cache invalidation | `LOW/HIGH` | `OPEN` |
| RI-T04 | AI hypothesis promoted to fact | `MEDIUM/HIGH` | state machine, source/method provenance, confirmation separation, no self-approval | `LOW/HIGH` | `OPEN` |
| RI-T05 | prohibited sensitive inference from proxies | `MEDIUM/HIGH` | forbidden-inference catalog, prompt/output policy, adversarial tests, human escalation | `LOW/HIGH` | `OPEN` |
| RI-T06 | opaque customer or supplier scoring causes unfair treatment | `MEDIUM/HIGH` | no universal score, feature-level explanation, contestation, human decision | `LOW/HIGH` | `OPEN` |
| RI-T07 | identity collision or automatic cross-Tenant merge | `MEDIUM/HIGH` | scoped identifiers, no automatic merge, review-only match proposal | `LOW/HIGH` | `OPEN` |
| RI-T08 | correction does not propagate to projections | `MEDIUM/HIGH` | append correction, supersede graph, deterministic rebuild, recipient reconciliation tests | `LOW/MEDIUM` | `OPEN` |
| RI-T09 | revocation is ignored by cache, cursor or derived claim | `MEDIUM/HIGH` | policy version in cache key, fail-closed invalidation, future-use denial tests | `LOW/HIGH` | `OPEN` |
| RI-T10 | over-retention or undeletable profile | `MEDIUM/HIGH` | class-specific schedule, expiry jobs, deletion/anonymization evidence and legal-hold separation | `LOW/MEDIUM` | `OPEN` |
| RI-T11 | prompt, log or fixture leaks personal data or secrets | `MEDIUM/HIGH` | minimization, structured redaction, secret isolation, synthetic fixtures only, log tests | `LOW/HIGH` | `OPEN` |
| RI-T12 | poisoned or forged source events | `MEDIUM/HIGH` | certified producers, integrity reference, schema versioning, idempotency and anomaly review | `LOW/HIGH` | `OPEN` |
| RI-T13 | unauthorized operational action from a recommendation | `MEDIUM/HIGH` | proposal-only result, fresh application-service authorization, human approval threshold | `LOW/HIGH` | `OPEN` |
| RI-T14 | Relationship Passport overshares or cannot revoke | `HIGH/HIGH` | feature remains disabled; separate selective-disclosure protocol and threat model | `LOW/HIGH` | `BLOCKED_FEATURE` |
| RI-T15 | insider bulk access or silent export | `MEDIUM/HIGH` | least privilege, dual control for export, audit, anomaly detection and break-glass review | `LOW/HIGH` | `OPEN` |
| RI-T16 | provider lock-in weakens Foundation controls | `MEDIUM/MEDIUM` | provider-neutral core, adapter boundary, contract parity tests | `LOW/MEDIUM` | `OPEN` |
| RI-T17 | model or policy update changes outcomes silently | `MEDIUM/HIGH` | version pinning, evaluation gate, change audit, rollback and claim revalidation | `LOW/MEDIUM` | `OPEN` |
| RI-T18 | subject cannot understand or contest an adverse outcome | `MEDIUM/HIGH` | concise explanation, evidence view, correction channel, human contact and SLA | `LOW/MEDIUM` | `OPEN` |

Residual target is not acceptance. Each control needs an owner, test and evidence before the risk can be accepted.

## 6. Abuse cases

### Purpose laundering

An operator requests a broad service purpose to obtain marketing or unrelated behavioral data. Expected result: `DENY_PURPOSE_OPERATION_NOT_ALLOWED`.

### Tenant hopping

A client changes `tenant_id` or host data to access another Tenant. Expected result: trusted server scope wins; ambiguity or unknown host returns a typed denial.

### AI self-confirmation

A model produces a high-confidence preference and attempts to mark it confirmed. Expected result: claim remains `PROPOSED`; confirmation requires independent authorized evidence.

### Supplier black box

A composite score is used to exclude a supplier without traceable evidence. Expected result: action blocked; evidence-level explanation and authorized human review required.

### Sensitive proxy inference

Order history is used to infer health, religion, ethnicity, economic condition or emotion. Expected result: generation and storage blocked, event audited and policy review triggered.

### Revoked Passport reuse

A recipient attempts a new use after revocation. Expected result: authorization denies future use; reconciliation and audit paths start according to policy.

## 7. Required security and privacy evidence

- threat owners and mitigation owners;
- data-flow diagram with trust boundaries and recipients;
- record of processing activities linkage;
- lawful-basis and purpose matrix approved by qualified legal/privacy reviewers;
- DPO advice where one is designated;
- negative cross-Tenant and cross-Location tests;
- subject-rights end-to-end tests;
- retention, expiry, anonymization and legal-hold tests;
- model/rule evaluation including forbidden-inference adversarial cases;
- human-oversight and significant-decision classification;
- incident response, breach assessment and rollback plan;
- processor, sub-processor and international-transfer assessment;
- residual-risk acceptance by the accountable authority.

## 8. AI Act screening boundary

The EU AI Act uses a risk-based approach and prohibits practices including social scoring and certain manipulative or sensitive biometric uses. It also emphasizes traceability, documentation, human oversight, robustness and transparency for covered systems.

This document does not classify AIRen Relationship Intelligence under the AI Act. Classification depends on the exact intended purpose, actors, deployment context and effects, all of which remain incomplete. A qualified legal review must make that determination before implementation.

## 9. External authorities

- Regulation (EU) 2016/679, Article 35 and related recitals: `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679`
- European Commission, DPIA obligations: `https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/obligations/when-data-protection-impact-assessment-dpia-required_en`
- EDPB, automated decision-making and profiling guidance: `https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en`
- European Commission, AI Act overview: `https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai`

## 10. Gate result

**Full DPIA:** `REQUIRED_BEFORE_IMPLEMENTATION_REVIEW`

**Legal review:** `REQUIRED`

**Residual-risk acceptance:** `NOT_STARTED`

**Runtime implementation:** `BLOCKED`

**Production processing:** `BLOCKED`
