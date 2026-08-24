# NEXT-AIR-002 — Declared Preference Evidence Bundle Index v0.1

**Artifact class:** `GOVERNED_DESIGN_EVIDENCE_INDEX_NOT_LEGAL_ADVICE`

**Authority:** `GOV-NEXT-AIR-002-20260824-A`

**Candidate purpose:** `PUR-CUST-DECLARED-PREFERENCE-v0`

**Index state:** `INDEX_READY`

**Evidence bundle complete:** `false`

**Qualified decision recorded:** `false`

**Purpose state:** `DISABLED`

**Runtime implementation authorized:** `false`

## 1. Purpose and boundary

This index identifies evidence that actually exists, records how it was verified and states what it can and cannot prove for the qualified legal and privacy review.

It does not convert a design artifact into operational evidence, treat a reference document as purpose-specific approval, select a lawful basis, assign controller or processor roles, complete a DPIA, identify a reviewer, create a signature or authorize processing.

No production personal data, provider secret or confidential STELLA formula is included. Drive documents are referenced by controlled identity and revision; their contents are not copied into this repository by this index.

## 2. Status vocabulary

| Status | Meaning |
|---|---|
| `PRESENT_VERIFIED` | the identified artifact, Git object or Drive document exists and its recorded locator was verified |
| `REFERENCE_ONLY` | the artifact provides governing or contextual authority but does not prove the purpose-specific review requirement |
| `PARTIAL` | relevant evidence exists, but required facts, decisions, owners or tests are incomplete |
| `MISSING` | no sufficient purpose-specific evidence was identified in the reviewed sources |
| `NOT_REVIEWED` | a source exists but its substantive applicability has not been assessed by the qualified reviewer |

`PRESENT_VERIFIED` describes provenance, not legal sufficiency or approval.

## 3. Verification method

- local artifacts: exact repository path, file existence and SHA-256 digest;
- Git evidence: exact commit object, full commit id and subject from the local repository;
- Drive evidence: exact Google document id, title, revision id and tab topology from connector readback;
- regulatory guardrails: official publisher URL, without claiming that this index replaces current-law verification by the reviewer;
- requirement status: comparison against Section 5 of the qualified-review decision record.

Verification was read-only. No source file, Drive structure, permission or sharing state was changed while building this index.

## 4. Local evidence manifest

| Evidence id | Repository artifact | SHA-256 | What it supports | Limitation | Status |
|---|---|---|---|---|---|
| `EBI-L01` | `docs/NEXT_AIR_002_GOVERNANCE_DECISION_2026-08-24.md` | `86a6026cb1ca59bc61c946bc54e76e18bfc4e4c21877bcde71eaa4366573325b` | governed-design authority and runtime boundary | not a legal decision for this purpose | `PRESENT_VERIFIED` |
| `EBI-L02` | `docs/NEXT_AIR_002_GOVERNED_DESIGN_CONTRACT_v0.1.md` | `58897e86a0e26599d1666f265a2dec0ec888a0aee40d29fb6b5c4306ef2c3762` | architecture, authority and design invariants | not an accepted runtime contract | `PRESENT_VERIFIED` |
| `EBI-L03` | `docs/NEXT_AIR_002_PURPOSE_AUTHORIZATION_MATRIX_v0.1.md` | `5654abc5989b893dc54d3db64205df9bc062715bedaa6b833f40e5b3883f9771` | candidate purposes, operations and fail-closed decision contract | all purposes and lawful bases remain unapproved | `PRESENT_VERIFIED` |
| `EBI-L04` | `docs/NEXT_AIR_002_DPIA_SCREENING_AND_THREAT_MODEL_v0.1.md` | `99aa9fdad47012b15401c91097f56386fbb42d40a1db7b352dc38cc0989152c2` | conservative screening, preliminary risks and mitigations | full DPIA, owners, test evidence and residual acceptance are absent | `PARTIAL` |
| `EBI-L05` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_LEGAL_PRIVACY_REVIEW_PACKET_v0.1.md` | `abbce7942709da246cc718f14e7ad35f58c21b8762164afecbf16dd70e3cf2e9` | bounded review questions and required decisions | contains no qualified conclusions or approvals | `PRESENT_VERIFIED` |
| `EBI-L06` | `docs/NEXT_AIR_002_PUR_CUST_DECLARED_PREFERENCE_QUALIFIED_REVIEW_DECISION_RECORD_v0.1.md` | `bf57fe22beb9e9ec11efd9a36d4645d4cbd1c33b4aae63a0e58c064ef0d8022e` | blank versioned record for actual reviewers | incomplete template; zero signatories and no decision | `PRESENT_VERIFIED` |
| `EBI-L07` | `docs/NEXT_AIR_002_GOVERNED_DESIGN_TEST_PLAN_v0.1.md` | `4a6094da7c51c69336ca043fa63874080d58296bb25375c0bbde6eb623751bba` | future synthetic contract-test plan | planned cases are not runtime execution evidence | `REFERENCE_ONLY` |
| `EBI-L08` | `docs/BASE44_RELATIONSHIP_DESIGN_REVIEW_EVIDENCE_2026-08-24.md` | `fac5251b8c86e2cf851bbb6e79238224ded71042b8187c5952b4806bfba496b1` | Base44 read-only review surface and prior verification results | proves only the non-operational design shell | `PRESENT_VERIFIED` |
| `EBI-L09` | `base44-apps/airenos-control-plane-staging/tests/relationship-design-boundary.test.js` | `6afa835156e212bdfba159031702f9f123b895d29f9409f35da90b0c9986be95` | executable design-boundary assertions through the evidence-index milestone | not privacy, isolation, rights or runtime security proof | `PRESENT_VERIFIED` |

Digests in this manifest identify the source state used to create the index. Later edits require a new index version or an explicit integrity refresh; they must not be silently treated as the same evidence.

## 5. Git evidence manifest

| Evidence id | Commit | Subject | What it anchors | Status |
|---|---|---|---|---|
| `EBI-G01` | `12ae8dee3d6aceae93a3f4f913d781955ee20e75` | `docs(next): register relationship intelligence North Star` | North Star registration | `PRESENT_VERIFIED` |
| `EBI-G02` | `e2db609a99ffb9561dea1c0b984d4fc5a0416d8b` | `docs: define purpose authorization matrix` | six disabled purposes and authorization matrix | `PRESENT_VERIFIED` |
| `EBI-G03` | `4ff423e713ab96df604faa9bdb9c01d0933e2419` | `docs: prepare declared preference privacy review` | legal/privacy review packet | `PRESENT_VERIFIED` |
| `EBI-G04` | `8c6e4f64394a737ac0cb4fa478c68b1ea75ece38` | `docs: add qualified privacy decision record` | blank qualified-review record | `PRESENT_VERIFIED` |

Git publication proves versioned provenance. It does not prove legal validity, reviewer competence, evidence sufficiency or runtime safety.

## 6. Controlled Drive authority manifest

| Evidence id | Google document | Document id | Revision id | Review use | Limitation | Status |
|---|---|---|---|---|---|---|
| `EBI-D01` | `AIRenOS Platform Bible — Analisi Funzionale, Architettura e Product Operating Model — v0.1` | `1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA` | `AIroW37TwxibjMLB8s5wjd_9_1ZHJWMwnMghwtMZJt7me-wq22hhOAH_ieWRklNHXYvivH-GJox7RVYS3bmFKMv2w9dqZTFs0_NmEKbga0Y` | platform authority and operating-model context | purpose-specific applicability remains for reviewer assessment | `REFERENCE_ONLY` |
| `EBI-D02` | `08 — RISTOAIREN Entity & Data Dictionary — v0.1` | `16d_ItmtJgDktWxYQXbZB7FzTJMVIKFSVzYfF5xd8ZLc` | `AIroW352ULZULDlCmgUDodRpm6CHnZF1gkjQ2v8vZ41hsxGHpQ16AOoqOLGaS0kKPecEQ5441fzcAiHaoCkIm4rG4K950Y4OYl44FT_IGo4` | existing vertical data-dictionary context | does not approve a new declared-preference taxonomy | `REFERENCE_ONLY` |
| `EBI-D03` | `09 — RISTOAIREN RBAC & RLS Matrix — v0.1` | `1MhfahuVL7M_1APUnzqXZY_9sCBu-1veToHxTBGGw8mY` | `AIroW35_lIWcc5hZ2gKPH9awWFfTRbWp4333Zkiwajxl_p5SFIup-j9EuKPkKm9VZes3Rj9A8ecrrQ2HQECCYAxCDjfvTQDncqz4gcfC1ys` | existing access-control context | no permission for this candidate purpose is inferred | `REFERENCE_ONLY` |
| `EBI-D04` | `10 — RISTOAIREN Backend Function Catalog — v0.1` | `1686W-gU6L0Pin_xjUg4V2khyeItJ-9PtnRgMlH3Npmw` | `AIroW342UEW4kTDnzRY2_lg7bYx29xpCO0J4VmA3u7CyxwmJuZipUVU1G9jo1jMAK2EH4RjE5gjV6C30N0MU1l8CFDbXZB7oDi3X1I8DcHE` | existing application-service context | no new function or route is authorized | `REFERENCE_ONLY` |
| `EBI-D05` | `AIRenOS NEXT — Future Innovation & Implementation Registry — v0.1` | `1i3HLJIAItBnXC1MSKV55pscI6nTtdlpei3ndavuBrBM` | `AIroW34h1Ek9vXDGoKmVSOV9gIKSNSYozwgS0CSbz0QKbeezYQn57hUyinN0jLbSlilFPU2K_nvBxzyuYXV5pHe0o4SJq2AUQ-P8oP7gmls` | future-work registry context | registration is not promotion or implementation authority | `REFERENCE_ONLY` |
| `EBI-D06` | `09 — Review & Approval Working Area — Promotion Policy — v1.0` | `1eMTdVlapxR5nsTfCMBiec1q6GgEkQP0S8S00b-CtNwk` | `AIroW37bNs_sx-KmlSKNsLGO1-e8jkpLp2ncLX1FnxTHVulQ3x4tsKwIBZl-S2U4PTGWD6b4NTrakit4O6xTwm2f7o8rwCWoyypGjRYMtTs` | promotion-governance context | does not itself approve this purpose | `REFERENCE_ONLY` |
| `EBI-D07` | `NEXT-AIR-002 — AIRen Relationship Intelligence OS — North Star Proposal — v0.1` | `1ZOLUZjSsYbxC2GopMr-C0XPvH_jLbxRMKEHaS8Xd69Q` | `AIroW34h7s_PLOOiEJN-0sHw1q5n7E2tQrHF8OGsg35lcd595cDQ19U1ioJ8b6aeHhb0EThKxblixAr6wQ-z1i2id4QdRn50KujkfjNQMkA` | current governed-design state and non-confidential milestone evidence | working proposal, not canonical authority | `PRESENT_VERIFIED` |

Each listed Drive document exposed one root tab, `t.0`, during the metadata verification. Revision ids are evidence locators and may change when the source is edited. The completed reviewer bundle must record the revision actually reviewed.

## 7. Official external guardrails

| Evidence id | Official source | URL | Use | Status |
|---|---|---|---|---|
| `EBI-X01` | Regulation (EU) 2016/679 | `https://eur-lex.europa.eu/eli/reg/2016/679/2016-05-04/eng` | primary GDPR text | `REFERENCE_ONLY` |
| `EBI-X02` | EDPB-endorsed WP29 DPIA Guidelines, WP248 rev.01 | `https://www.edpb.europa.eu/documents/guideline/data-protection-impact-assessments-high-risk-processing_en` | high-risk and DPIA review guardrail | `REFERENCE_ONLY` |
| `EBI-X03` | EDPB-endorsed WP29 DPO Guidelines, WP243 rev.01 | `https://www.edpb.europa.eu/documents/guideline/data-protection-officer_en` | DPO role and involvement guardrail | `REFERENCE_ONLY` |
| `EBI-X04` | EDPB Guidelines 2/2019 | `https://www.edpb.europa.eu/documents/guideline/guidelines-22019-on-the-processing-of-personal-data-under-article-61b-gdpr-in_en` | Article 6(1)(b) assessment guardrail | `REFERENCE_ONLY` |
| `EBI-X05` | EDPB Guidelines 05/2020 | `https://www.edpb.europa.eu/documents/guideline/guidelines-052020-on-consent-under-regulation-2016679_en` | consent assessment guardrail | `REFERENCE_ONLY` |
| `EBI-X06` | EDPB-endorsed WP29 transparency Guidelines, WP260 rev.01 | `https://www.edpb.europa.eu/documents/guideline/article-29-working-party-guidelines-on-transparency-under-regulation-2016679_en` | transparency assessment guardrail | `REFERENCE_ONLY` |

The qualified reviewer must verify current law, current guidance status and applicable national requirements. The EDPB DPIA template published for public consultation in 2026 is not included as final authority.

## 8. Required-evidence completeness matrix

| Requirement id | Required evidence from decision record | Identified support | What is still required | Status |
|---|---|---|---|---|
| `EBI-R01` | exact service journey and intended outcome | candidate purpose boundary in `EBI-L03` and `EBI-L05` | verified final journey, context, actors, frequency and consequences | `PARTIAL` |
| `EBI-R02` | field-level data-flow and trust-boundary diagram | conceptual authority flow in `EBI-L05` | exact fields, systems, stores, recipients, transfers, encryption and deletion paths | `MISSING` |
| `EBI-R03` | proposed closed field taxonomy and classification | candidate data classes only in `EBI-L03` and `EBI-L05` | exact closed taxonomy, field classification and schema version | `MISSING` |
| `EBI-R04` | necessity and less-intrusive-alternative assessment | blank operation worksheet in `EBI-L05` | evidence-backed completed assessment per operation and field | `PARTIAL` |
| `EBI-R05` | subject reasonable-expectation evidence | no sufficient purpose-specific evidence identified | approved research or equivalent evidence for the exact context | `MISSING` |
| `EBI-R06` | controller/processor factual role assessment | blank role worksheet in `EBI-L05` and `EBI-L06` | factual purposes/means analysis and qualified conclusion for every participant | `MISSING` |
| `EBI-R07` | recipient, processor, sub-processor and transfer inventory | provider names are not treated as role evidence | exact inventory, locations, contracts, safeguards and transfer assessment | `MISSING` |
| `EBI-R08` | transparency notice and rights-handling design | requirement checklist in `EBI-L05` and `EBI-L06` | approved notice, applicability matrix, owners, procedures and tests | `MISSING` |
| `EBI-R09` | retention, deletion and reconciliation schedule | blank record-class worksheet in `EBI-L05` and `EBI-L06` | justified periods, triggers, legal-hold separation and test evidence | `MISSING` |
| `EBI-R10` | full DPIA and DPO advice where applicable | screening and preliminary risk register in `EBI-L04` | completed full DPIA, advice, risk-owner decisions and review trigger | `PARTIAL` |
| `EBI-R11` | threat model, control owners and test evidence | preliminary threats in `EBI-L04`; design-boundary shell tests in `EBI-L09` | named owners, implemented controls and purpose-specific negative/runtime tests | `PARTIAL` |
| `EBI-R12` | record-of-processing linkage | no sufficient purpose-specific linkage identified | accountable ROPA reference for the exact processing | `MISSING` |

### Completeness result

**Required evidence slots:** `12`

**Ready for qualified review:** `0`

**Partial:** `4`

**Missing:** `8`

The index is ready; the evidence bundle is not. `0/12 READY` is a fail-closed result, not a progress score or risk rating.

## 9. Sign-off and decision gaps

| Gap | Current value | Required next evidence |
|---|---|---|
| qualified legal reviewer identity and capacity | `UNASSIGNED` | actual accountable reviewer entry |
| privacy/DPO reviewer or applicability determination | `UNASSIGNED` | actual reviewer or reasoned applicability record |
| security reviewer | `UNASSIGNED` | actual accountable reviewer entry |
| data-governance reviewer | `UNASSIGNED` | actual accountable reviewer entry |
| completed attestations | `0` | attestations made by the actual reviewers |
| qualified outcome | `NOT_SELECTED` | one reasoned outcome with evidence and conditions |
| lawful bases approved | `0` | operation-level qualified decision |
| AIRenOS governance decision | `NOT_STARTED` | separate decision after qualified review completion |

No person, email, signature, date or professional capacity is inferred by this index.

## 10. Bundle assembly and integrity rule

Before delivery to qualified reviewers:

1. create a controlled bundle version and immutable bundle identifier;
2. record the exact local file digests, Git commits and Drive revisions actually delivered;
3. include only the minimum relevant source material or controlled links;
4. assign access according to the source's classification; do not broaden Drive or repository permissions;
5. exclude production personal data, secrets and unrelated confidential material;
6. copy the blank decision-record template to a new versioned completion record;
7. preserve reviewer dissent, unavailable evidence and conditions;
8. invalidate or refresh the bundle when a source hash, Drive revision or purpose boundary changes.

This index does not create the controlled reviewer workspace or change access permissions.

## 11. Current gate result

**Index prepared:** `true`

**Evidence bundle complete:** `false`

**Evidence readiness:** `0/12 READY · 4 PARTIAL · 8 MISSING`

**Qualified reviewers assigned:** `0`

**Qualified decision recorded:** `false`

**Purpose enabled:** `false`

**Runtime implementation:** `BLOCKED`

**Next safe action:** prepare `EBI-R01`, the verified exact service journey and intended-outcome evidence, without defining fields, legal roles or a lawful basis by assumption.
