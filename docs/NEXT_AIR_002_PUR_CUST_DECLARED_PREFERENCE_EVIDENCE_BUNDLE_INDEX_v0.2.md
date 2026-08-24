# NEXT-AIR-002 — Declared Preference Evidence Bundle Index v0.2

**Artifact class:** `GOVERNED_DESIGN_EVIDENCE_INDEX_NOT_LEGAL_ADVICE`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Candidate purpose:** `PUR-CUST-DECLARED-PREFERENCE-v0`

**Supersedes for future bundle assembly:** `NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_EVIDENCE_BUNDLE_INDEX_v0.1.md`

**Index state:** `INDEX_REFRESHED_EBI_R01_CAPTURE_READY`

**Evidence bundle complete:** `false`

**Qualified decision recorded:** `false`

**Purpose state:** `DISABLED`

**Runtime implementation authorized:** `false`

## 1. Version change and boundary

Version `v0.2` adds the EBI-R01 service-journey evidence capture record, refreshes integrity references for the Base44 evidence surface and test contract, adds the prior evidence-index Git commit, and records the Drive revisions verified for this refresh.

It does not claim that the exact journey is verified. It does not convert a design statement into operational evidence, select a lawful basis, assign legal roles, approve fields or authorize processing.

No production personal data, provider secret or confidential STELLA formula is included. Drive content is not copied into this index.

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| `PRESENT_VERIFIED` | the identified artifact, Git object or Drive document exists at the recorded locator |
| `REFERENCE_ONLY` | the artifact supplies authority or context but does not close the purpose-specific requirement |
| `PARTIAL` | relevant evidence exists, but required facts, decisions, owners or tests are incomplete |
| `MISSING` | no sufficient purpose-specific evidence was identified |
| `NOT_REVIEWED` | a source exists but qualified applicability has not been assessed |

Artifact existence or a valid digest does not prove legal sufficiency, implementation or approval.

## 3. Verification method

- local: repository path, existence and SHA-256 digest;
- Git: exact commit object, full commit id and subject;
- Drive: document id, title, revision id and tab topology from connector readback;
- requirement: comparison with the qualified-review record and the explicit EBI-R01 readiness rule;
- Base44 surface: synthetic design-boundary tests, optimized local build and browser readback.

## 4. Local evidence manifest

| ID | Repository artifact | SHA-256 | Status | Limitation |
|---|---|---|---|---|
| `EBI-L01` | `docs/NEXT_AIR_002_GOVERNANCE_DECISION_2026-08-24.md` | `86a6026cb1ca59bc61c946bc54e76e18bfc4e4c21877bcde71eaa4366573325b` | `PRESENT_VERIFIED` | governed-design authority, not a legal decision |
| `EBI-L02` | `docs/NEXT_AIR_002_GOVERNED_DESIGN_CONTRACT_v0.1.md` | `58897e86a0e26599d1666f265a2dec0ec888a0aee40d29fb6b5c4306ef2c3762` | `PRESENT_VERIFIED` | candidate contract, not runtime authority |
| `EBI-L03` | `docs/NEXT_AIR_002_PURPOSE_AUTHORIZATION_MATRIX_v0.1.md` | `5654abc5989b893dc54d3db64205df9bc062715bedaa6b833f40e5b3883f9771` | `PRESENT_VERIFIED` | all purposes and lawful bases remain unapproved |
| `EBI-L04` | `docs/NEXT_AIR_002_DPIA_SCREENING_AND_THREAT_MODEL_v0.1.md` | `99aa9fdad47012b15401c91097f56386fbb42d40a1db7b352dc38cc0989152c2` | `PARTIAL` | full DPIA, owners, tests and residual decisions absent |
| `EBI-L05` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_LEGAL_PRIVACY_REVIEW_PACKET_v0.1.md` | `abbce7942709da246cc718f14e7ad35f58c21b8762164afecbf16dd70e3cf2e9` | `PRESENT_VERIFIED` | contains questions, not qualified conclusions |
| `EBI-L06` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_QUALIFIED_REVIEW_DECISION_RECORD_v0.1.md` | `bf57fe22beb9e9ec11efd9a36d4645d4cbd1c33b4aae63a0e58c064ef0d8022e` | `PRESENT_VERIFIED` | blank template; no decision or signatory |
| `EBI-L07` | `docs/NEXT_AIR_002_GOVERNED_DESIGN_TEST_PLAN_v0.1.md` | `4a6094da7c51c69336ca043fa63874080d58296bb25375c0bbde6eb623751bba` | `REFERENCE_ONLY` | planned cases are not runtime evidence |
| `EBI-L08` | `docs/BASE44_RELATIONSHIP_DESIGN_REVIEW_EVIDENCE_2026-08-24.md` | `16d6761a4ff83b5bbc4b3742b1a8e35212db8f337ae14cbc0a06fa3c8f45cb26` | `PRESENT_VERIFIED` | proves only the non-operational review surface |
| `EBI-L09` | `base44-apps/airenos-control-plane-staging/tests/relationship-design-boundary.test.js` | `a353fbb074415de2a8607031095b671deb3633ba97977fc4c099c76da6b89fcb` | `PRESENT_VERIFIED` | design assertions are not privacy or runtime-security proof |
| `EBI-L10` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_SERVICE_JOURNEY_EVIDENCE_RECORD_v0.1.md` | `4c16afab36e0ba8f7722d42e26083f5885e47696d24de5b402d029ed9e57ae51` | `PARTIAL` | candidate skeleton recorded; exact journey and factual owner remain unverified |

Digests identify the source state used for this index version. Later source edits require another version or explicit integrity refresh.

## 5. Git evidence manifest

| ID | Commit | Subject | Status |
|---|---|---|---|
| `EBI-G01` | `12ae8dee3d6aceae93a3f4f913d781955ee20e75` | `docs(next): register relationship intelligence North Star` | `PRESENT_VERIFIED` |
| `EBI-G02` | `e2db609a99ffb9561dea1c0b984d4fc5a0416d8b` | `docs: define purpose authorization matrix` | `PRESENT_VERIFIED` |
| `EBI-G03` | `4ff423e713ab96df604faa9bdb9c01d0933e2419` | `docs: prepare declared preference privacy review` | `PRESENT_VERIFIED` |
| `EBI-G04` | `8c6e4f64394a737ac0cb4fa478c68b1ea75ece38` | `docs: add qualified privacy decision record` | `PRESENT_VERIFIED` |
| `EBI-G05` | `d09432f8995750708067dada3d9e4e905dccd848` | `docs: index declared preference review evidence` | `PRESENT_VERIFIED` |

Git provenance does not prove reviewer competence, legal validity, sufficiency or runtime safety.

## 6. Controlled Drive authority manifest

| ID | Google document | Document id | Revision id | Status | Limitation |
|---|---|---|---|---|---|
| `EBI-D01` | AIRenOS Platform Bible | `1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA` | `AIroW37TwxibjMLB8s5wjd_9_1ZHJWMwnMghwtMZJt7me-wq22hhOAH_ieWRklNHXYvivH-GJox7RVYS3bmFKMv2w9dqZTFs0_NmEKbga0Y` | `REFERENCE_ONLY` | platform context, not purpose approval |
| `EBI-D02` | DOC-008 Entity & Data Dictionary | `16d_ItmtJgDktWxYQXbZB7FzTJMVIKFSVzYfF5xd8ZLc` | `AIroW352ULZULDlCmgUDodRpm6CHnZF1gkjQ2v8vZ41hsxGHpQ16AOoqOLGaS0kKPecEQ5441fzcAiHaoCkIm4rG4K950Y4OYl44FT_IGo4` | `REFERENCE_ONLY` | no declared-preference taxonomy approved |
| `EBI-D03` | DOC-009 RBAC & RLS Matrix | `1MhfahuVL7M_1APUnzqXZY_9sCBu-1veToHxTBGGw8mY` | `AIroW35_lIWcc5hZ2gKPH9awWFfTRbWp4333Zkiwajxl_p5SFIup-j9EuKPkKm9VZes3Rj9A8ecrrQ2HQECCYAxCDjfvTQDncqz4gcfC1ys` | `REFERENCE_ONLY` | no permission inferred |
| `EBI-D04` | DOC-010 Backend Function Catalog | `1686W-gU6L0Pin_xjUg4V2khyeItJ-9PtnRgMlH3Npmw` | `AIroW342UEW4kTDnzRY2_lg7bYx29xpCO0J4VmA3u7CyxwmJuZipUVU1G9jo1jMAK2EH4RjE5gjV6C30N0MU1l8CFDbXZB7oDi3X1I8DcHE` | `REFERENCE_ONLY` | no new function or route authorized |
| `EBI-D05` | AIRenOS NEXT registry | `1i3HLJIAItBnXC1MSKV55pscI6nTtdlpei3ndavuBrBM` | `AIroW34h1Ek9vXDGoKmVSOV9gIKSNSYozwgS0CSbz0QKbeezYQn57hUyinN0jLbSlilFPU2K_nvBxzyuYXV5pHe0o4SJq2AUQ-P8oP7gmls` | `REFERENCE_ONLY` | registry entry is not promotion |
| `EBI-D06` | Review & Approval Promotion Policy | `1eMTdVlapxR5nsTfCMBiec1q6GgEkQP0S8S00b-CtNwk` | `AIroW37bNs_sx-KmlSKNsLGO1-e8jkpLp2ncLX1FnxTHVulQ3x4tsKwIBZl-S2U4PTGWD6b4NTrakit4O6xTwm2f7o8rwCWoyypGjRYMtTs` | `REFERENCE_ONLY` | does not approve this purpose |
| `EBI-D07` | NEXT-AIR-002 North Star Proposal | `1ZOLUZjSsYbxC2GopMr-C0XPvH_jLbxRMKEHaS8Xd69Q` | `AIroW36D2LXbtlMzOj5e3yIhtbH5waXK7CcHtqjY93h3plJ_m0qmh8qa5QcqC8TN8NmFk2ABuRtufMnTmcenjfVvRnwdsiIsnzJ-8LouzT0` | `PRESENT_VERIFIED` | working proposal, not canonical authority |

All seven documents exposed one root tab, `t.0`, during this refresh. Revisions are immutable evidence locators for this index version; later edits do not rewrite the recorded source state.

## 7. Official guardrails

Version `v0.2` retains the six official-source references recorded in `v0.1`: the GDPR and the EDPB materials on DPIA, DPO involvement, Article 6(1)(b), consent and transparency. They remain `REFERENCE_ONLY` and do not replace current-law verification or qualified advice.

## 8. Required-evidence completeness matrix

| Requirement | Current support | Remaining requirement | Status |
|---|---|---|---|
| `EBI-R01` exact service journey and intended outcome | `EBI-L03`, `EBI-L05`, `EBI-L10` record a source-grounded candidate boundary and capture ledger | accountable owner, exact product/deployment context, trigger, channel, actors, retained operations, frequency, consequences, factual recipients and supporting evidence | `PARTIAL` |
| `EBI-R02` field-level data flow and trust boundary | conceptual authority flow only | exact fields, systems, stores, recipients, transfers, encryption and deletion paths | `MISSING` |
| `EBI-R03` closed field taxonomy and classification | candidate data classes only | exact approved taxonomy, classification and version | `MISSING` |
| `EBI-R04` necessity and alternatives | blank operation worksheet | evidence-backed operation/field assessment | `PARTIAL` |
| `EBI-R05` reasonable-expectation evidence | none sufficient | approved research or equivalent exact-context evidence | `MISSING` |
| `EBI-R06` factual role assessment | blank worksheet | factual purposes/means analysis and qualified conclusions | `MISSING` |
| `EBI-R07` recipient, processor and transfer inventory | none sufficient | inventory, locations, contracts, safeguards and transfers | `MISSING` |
| `EBI-R08` transparency and rights design | requirements only | approved notice, applicability, owners, procedures and tests | `MISSING` |
| `EBI-R09` retention, deletion and reconciliation | blank schedule | justified periods, triggers, legal hold and tests | `MISSING` |
| `EBI-R10` full DPIA and DPO advice | screening and preliminary risks | full DPIA, advice, owners, decisions and review trigger | `PARTIAL` |
| `EBI-R11` threat model, owners and tests | preliminary model and design-shell tests | named owners, controls and purpose-specific runtime/negative tests | `PARTIAL` |
| `EBI-R12` ROPA linkage | none sufficient | accountable record-of-processing reference | `MISSING` |

## 9. Completeness and gate result

**Required evidence slots:** `12`

**Ready:** `0`

**Partial:** `4`

**Missing:** `8`

**EBI-R01 capture structure prepared:** `true`

**EBI-R01 exact journey verified:** `false`

**Qualified reviewers assigned:** `0`

**Qualified decision recorded:** `false`

**Purpose enabled:** `false`

**Runtime implementation:** `BLOCKED`

`0/12 READY` remains the fail-closed result. A prepared capture form is not evidence completion.

## 10. Next controlled evidence action

Obtain `EBI-R01-A`, a dated service-owner evidence entry covering the exact product/vertical, deployment context, trigger, entry channel, actual actors, retained operations, customer-visible and operational outcomes, frequency, foreseeable consequences, factual recipients and controlled supporting references.

Do not include production personal data. Do not define fields, legal roles, a lawful basis, retention or implementation authority by assumption. After source-owner verification, refresh the bundle index; `EBI-R01` remains `PARTIAL` until every readiness condition in `EBI-L10` is met.
