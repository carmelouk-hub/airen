# NEXT-AIR-002 — Purpose & Authorization Matrix v0.1

**Artifact class:** `GOVERNED_DESIGN_NOT_CANONICAL`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Catalog status:** `CANDIDATE_DISABLED_PENDING_REVIEW`

**Lawful bases approved:** `0`

**Runtime implementation authorized:** `false`

## 1. Decision boundary

This matrix specifies candidate processing purposes and the authorization decision contract. It does not select a lawful basis, grant a permission, create an entitlement, approve a retention period or authorize processing.

Every candidate purpose is disabled until legal, privacy, security and AIRenOS governance review has approved its exact version.

The governing order remains:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement -> purpose authorization -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

Purpose is an additional constraint. It never replaces identity, trusted scope, permission, entitlement or domain authority.

## 2. Candidate actor classes

These are design labels, not accepted roles or permissions.

| Candidate actor class | Meaning | Authority ceiling |
|---|---|---|
| `SUBJECT_SELF_VERIFIED` | verified customer acting on their own scoped relationship material | self-service operations approved by a future contract only |
| `SUPPLIER_REP_VERIFIED` | verified natural person representing a supplier | supplier correction or document operations approved by a future contract only |
| `TENANT_OPERATOR_AUTHORIZED` | operator whose identity, Tenant, Location and permission are resolved by Foundation | minimized operations explicitly allowed by purpose and permission |
| `FOUNDATION_CERTIFIED_SERVICE` | certified producer or application service acting under a versioned service identity | typed events and governed application-service operations only |
| `STELLA_PROPOSAL_ONLY` | STELLA reading an authorized projection to formulate a proposal | no confirmation, permission expansion or direct write authority |
| `GOVERNANCE_REVIEWER_AUTHORIZED` | privacy, security or governance reviewer with separately approved access | review evidence only; no operational authority by role name alone |

Client-supplied role, Tenant, Location, purpose or actor identifiers are claims and never authority.

## 3. Candidate purpose catalog

All entries have effective status `DISABLED_PENDING_REVIEW`.

### `PUR-CUST-SERVICE-CONTINUITY-v0`

- **Outcome:** present a minimized, current service-context projection to an authorized operator during an active customer workflow.
- **Subject:** customer scoped to the trusted Tenant and Location workflow.
- **Candidate actors:** `TENANT_OPERATOR_AUTHORIZED`, `FOUNDATION_CERTIFIED_SERVICE`.
- **Candidate data classes:** confirmed declared preferences, certified operational references, active non-sensitive claims.
- **Candidate operations:** `READ_MINIMIZED_TWIN`, `PROPOSE_SERVICE_ACTION`.
- **Recipient boundary:** the same trusted Tenant/Location workflow only.
- **Human control:** every service action remains an operator decision.
- **Lawful basis:** `TBD_LEGAL_REVIEW`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_RETENTION_REVIEW`.

### `PUR-CUST-DECLARED-PREFERENCE-v0`

- **Outcome:** allow a verified customer or authorized operator to submit, read or correct an explicitly declared service preference.
- **Subject:** verified customer within the trusted Tenant relationship.
- **Candidate actors:** `SUBJECT_SELF_VERIFIED`, `TENANT_OPERATOR_AUTHORIZED`, `FOUNDATION_CERTIFIED_SERVICE`.
- **Candidate data classes:** personal declaration, provenance, confirmation and correction evidence.
- **Candidate operations:** `SUBMIT_DECLARATION`, `READ_OWN_DECLARATION`, `REQUEST_CORRECTION`, `SUPERSEDE_WITH_EVIDENCE`.
- **Recipient boundary:** verified subject and authorized same-Tenant service workflow.
- **Human control:** no declaration authorizes marketing or unrelated profiling.
- **Lawful basis:** `TBD_LEGAL_REVIEW`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_RETENTION_REVIEW`.

### `PUR-CUST-FEEDBACK-CORRECTION-v0`

- **Outcome:** receive feedback, correction, contestation or revocation and rebuild affected projections with preserved provenance.
- **Subject:** verified customer or authorized representative under a future verification policy.
- **Candidate actors:** `SUBJECT_SELF_VERIFIED`, `TENANT_OPERATOR_AUTHORIZED`, `FOUNDATION_CERTIFIED_SERVICE`.
- **Candidate data classes:** feedback, evidence references, contestation state, audit reference.
- **Candidate operations:** `SUBMIT_FEEDBACK`, `REQUEST_CORRECTION`, `CONTEST_CLAIM`, `REQUEST_REVOCATION`, `READ_CASE_STATUS`.
- **Recipient boundary:** authorized case-handling workflow only.
- **Human control:** contested claims cannot cause an automated adverse action.
- **Lawful basis:** `TBD_LEGAL_REVIEW`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_RETENTION_AND_LEGAL_HOLD_REVIEW`.

### `PUR-SUP-DELIVERY-QUALITY-v0`

- **Outcome:** review evidence-backed delivery timeliness, completeness and documented variance within one Tenant.
- **Subject:** supplier organization and, only where necessary, verified supplier contacts.
- **Candidate actors:** `TENANT_OPERATOR_AUTHORIZED`, `SUPPLIER_REP_VERIFIED`, `FOUNDATION_CERTIFIED_SERVICE`, `STELLA_PROPOSAL_ONLY`.
- **Candidate data classes:** Tenant-confidential delivery observations, evidence references and expiring proposed claims.
- **Candidate operations:** `READ_EVIDENCE`, `PROPOSE_QUALITY_CLAIM`, `CONTEST_SUPPLIER_CLAIM`, `PROPOSE_REVIEW_ACTION`.
- **Recipient boundary:** same-Tenant procurement and supplier-review workflow.
- **Human control:** no universal score, automatic exclusion or automatic penalty.
- **Lawful basis:** `TBD_LEGAL_REVIEW_WHERE_PERSONAL_DATA_APPLIES`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_RETENTION_REVIEW`.

### `PUR-SUP-DOCUMENT-VALIDITY-v0`

- **Outcome:** present the validity, provenance and expiry of a supplier document or certification without exposing unrelated material.
- **Subject:** supplier organization and verified document representative where personal data is present.
- **Candidate actors:** `TENANT_OPERATOR_AUTHORIZED`, `SUPPLIER_REP_VERIFIED`, `FOUNDATION_CERTIFIED_SERVICE`, `STELLA_PROPOSAL_ONLY`.
- **Candidate data classes:** document metadata, verification evidence, validity and expiry.
- **Candidate operations:** `SUBMIT_DOCUMENT_REFERENCE`, `READ_VALIDITY`, `PROPOSE_EXPIRY_ALERT`, `CONTEST_VALIDITY`.
- **Recipient boundary:** same-Tenant authorized compliance or procurement workflow.
- **Human control:** alerts are proposals and never suspend a supplier automatically.
- **Lawful basis:** `TBD_LEGAL_REVIEW_WHERE_PERSONAL_DATA_APPLIES`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_DOCUMENT_AND_LEGAL_HOLD_REVIEW`.

### `PUR-SUP-PROCUREMENT-SCENARIO-v0`

- **Outcome:** produce an explainable, non-executable procurement scenario from authorized supplier evidence.
- **Subject:** supplier organization; natural-person data excluded unless separately justified.
- **Candidate actors:** `TENANT_OPERATOR_AUTHORIZED`, `FOUNDATION_CERTIFIED_SERVICE`, `STELLA_PROPOSAL_ONLY`.
- **Candidate data classes:** minimized price history, lead-time evidence, availability facts and proposed risk claims.
- **Candidate operations:** `READ_MINIMIZED_SUPPLIER_TWIN`, `PROPOSE_PROCUREMENT_SCENARIO`, `EXPLAIN_PROPOSAL`.
- **Recipient boundary:** same-Tenant authorized procurement workflow.
- **Human control:** PurchaseOrder creation, approval and sending remain separate governed actions.
- **Lawful basis:** `TBD_LEGAL_REVIEW_WHERE_PERSONAL_DATA_APPLIES`.
- **Permission and entitlement:** `TBD_CANONICAL_RBAC_AND_COMMERCIAL_REVIEW`.
- **Retention:** `TBD_RETENTION_REVIEW`.

## 4. Explicit exclusions

The following purposes are not registered and must return `DENY_UNKNOWN_OR_FORBIDDEN_PURPOSE`:

- generic or bundled marketing;
- sale or brokerage of profile data;
- cross-Tenant enrichment or reputation pooling;
- automatic identity merge;
- inference of health, religion, ethnicity, political opinion, sexual orientation, economic vulnerability or emotional state;
- universal customer or supplier scoring;
- fully automated exclusion, penalty, procurement or significant decision;
- training an external model on relationship data without a separate approved contract;
- public or unrestricted Relationship Twin access.

Declared allergy or health-safety data is not covered by this catalog. It remains in a separate sensitive compartment and requires a dedicated Article 9/legal review, data contract, permission and minimum safety-projection design.

## 5. Authorization input contract

Every future decision request must contain or resolve:

| Input | Source of authority | Missing or invalid result |
|---|---|---|
| actor identity and service identity | trusted authentication and service context | `DENY_ACTOR_UNRESOLVED` |
| Tenant and Location | trusted server routing and membership context | `DENY_SCOPE_UNRESOLVED` |
| subject relationship | scoped identity-resolution service | `DENY_SUBJECT_SCOPE` |
| permission | canonical RBAC decision | `DENY_PERMISSION` |
| entitlement | canonical plan/capability decision when applicable | `DENY_ENTITLEMENT` |
| purpose id and version | approved purpose registry | `DENY_PURPOSE` |
| operation | approved purpose-operation binding | `DENY_OPERATION` |
| requested fields | field policy and minimization contract | `DENY_FIELD_POLICY` |
| lawful-basis record | legally reviewed, versioned record | `DENY_LAWFUL_BASIS` |
| consent grant when applicable | verifiable consent record | `DENY_CONSENT` |
| retention and expiry policy | approved field/purpose policy | `DENY_RETENTION_POLICY` |
| human-approval requirement | significant-decision policy | `DENY_HUMAN_APPROVAL_REQUIRED` |
| policy and model/rule version | approved release registry | `DENY_POLICY_VERSION` |

An `ALLOW` result is possible only when every required decision is affirmative for the exact actor, trusted scope, purpose version, operation and minimized field set.

## 6. Decision order

1. validate syntax and supported version;
2. resolve trusted actor and service identity;
3. resolve trusted Tenant and Location without fallback;
4. resolve the scoped subject relationship;
5. evaluate permission;
6. evaluate entitlement when applicable;
7. load the exact approved purpose version;
8. verify that the requested operation belongs to that purpose;
9. verify the lawful-basis record and, only when applicable, consent state;
10. minimize fields using the purpose-field policy;
11. evaluate retention, expiry, revocation and contestation state;
12. evaluate human-approval and significant-decision constraints;
13. issue a short-lived typed `ALLOW` or typed `DENY` decision;
14. audit the decision without secrets or excessive personal data.

Evaluation is fail-closed. A later step cannot repair or override a prior denial.

## 7. Typed decision result

Candidate result:

```text
PurposeAuthorizationDecision {
  decision: ALLOW | DENY
  reason_code: typed denial or allow reason
  actor_ref: trusted opaque reference
  tenant_ref: trusted opaque reference
  location_ref: trusted opaque reference | not_applicable
  subject_ref: scoped opaque reference
  purpose_ref: id + version
  operation: approved operation
  allowed_fields: exact minimized field identifiers
  lawful_basis_ref: approved record reference
  consent_ref: approved grant reference | not_applicable
  permission_ref: evaluated permission evidence
  entitlement_ref: evaluated entitlement evidence | not_applicable
  policy_version: evaluated policy version
  expires_at: short-lived decision expiry
  human_approval: required | satisfied | not_applicable
  audit_ref: immutable decision evidence
}
```

`not_applicable` is an explicit evaluated state. It is not equivalent to missing data and cannot be used to bypass a required check.

## 8. Consent boundary

- consent is used only when a qualified review selects it as the lawful basis for the exact purpose;
- consent must be specific, informed, unambiguous and demonstrable under the applicable policy;
- refusal or withdrawal cannot be hidden through dark patterns;
- withdrawal blocks future covered uses and triggers reconciliation according to policy;
- consent does not grant Tenant access, permission, entitlement or a new purpose;
- bundled consent across unrelated purposes is invalid for this design;
- this matrix approves no consent wording or user-interface flow.

## 9. Cache, cursor and projection binding

Every derived cache, cursor or Twin projection must bind at least to:

- trusted Tenant and Location scope;
- scoped subject reference;
- purpose id and version;
- operation and allowed-field policy version;
- authorization-policy version;
- claim/evidence projection version;
- revocation and contestation watermark;
- expiry.

A change to any binding invalidates the derived artifact. A cache hit never replaces authorization evaluation.

## 10. Design acceptance tests

| ID | Scenario | Expected result |
|---|---|---|
| `RI-PA-001` | valid syntax but unresolved actor | `DENY_ACTOR_UNRESOLVED` |
| `RI-PA-002` | client changes Tenant | trusted scope wins or `DENY_SCOPE_UNRESOLVED` |
| `RI-PA-003` | unknown host | denial; no default Tenant |
| `RI-PA-004` | permission absent | `DENY_PERMISSION` |
| `RI-PA-005` | entitlement absent | `DENY_ENTITLEMENT` |
| `RI-PA-006` | candidate purpose remains disabled | `DENY_PURPOSE` |
| `RI-PA-007` | operation not listed for approved purpose | `DENY_OPERATION` |
| `RI-PA-008` | requested field exceeds minimization contract | field omitted and `DENY_FIELD_POLICY` for the excess request |
| `RI-PA-009` | lawful-basis record absent | `DENY_LAWFUL_BASIS` |
| `RI-PA-010` | consent is required but absent or withdrawn | `DENY_CONSENT` |
| `RI-PA-011` | consent is not applicable and all other checks pass | consent remains `not_applicable`; no consent bypass claim |
| `RI-PA-012` | purpose version changes | prior caches, cursors and decisions invalidate |
| `RI-PA-013` | claim is contested | adverse automated action denied |
| `RI-PA-014` | significant action lacks human approval | `DENY_HUMAN_APPROVAL_REQUIRED` |
| `RI-PA-015` | STELLA proposes an allowed scenario | proposal returned without write or execution authority |
| `RI-PA-016` | sensitive field requested under ordinary purpose | `DENY_SENSITIVE_CONTRACT_REQUIRED` |
| `RI-PA-017` | supplier score attempts cross-Tenant pooling | `DENY_UNKNOWN_OR_FORBIDDEN_PURPOSE` |
| `RI-PA-018` | revoked authorization is reused | future use denied and reconciliation evidence required |

These are specifications, not executed runtime tests.

## 11. Open approvals

Before any purpose can move from disabled to active, governance must identify:

1. accountable controller and processor roles;
2. exact lawful basis and documented necessity for each operation;
3. special-category condition where applicable;
4. canonical permissions and entitlements;
5. exact field allowlist;
6. retention and deletion schedule;
7. subject notice and rights handling;
8. human-approval threshold;
9. DPIA risks and accepted mitigations;
10. policy owner, approver, effective version and rollback plan.

## 12. External legal guardrails

- GDPR Articles 5, 6 and 9: `https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng`
- EDPB Guidelines 05/2020 on consent: `https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en`
- EDPB guidance on automated decision-making and profiling: `https://www.edpb.europa.eu/documents/guideline/automated-decision-making-and-profiling_en`

These sources are guardrails. This matrix is not legal advice and makes no final legal-basis determination.

## 13. Gate result

**Candidate purposes specified:** `6`

**Enabled purposes:** `0`

**Lawful bases approved:** `0`

**Runtime processing:** `BLOCKED`

**Next design step:** qualified legal/privacy review of one narrowly bounded purpose before any activation proposal.
