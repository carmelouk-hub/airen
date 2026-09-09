# AOS-NOVA-R0-CERT-001 — Release 0 Certification — v0.1

**Date:** 2026-09-09  
**Scope:** AIRenOS G2 / AOS-NOVA Release 0 governed certification baseline only  
**Governance:** RULE-DOC-20 + RULE-DOC-21 + PCO-03 Dual-Operator Program Control  
**User authorization:** explicit — “completiamo AOS-NOVA Release 0”  
**Certification evidence decision:** `PASS_CANDIDATE_PENDING_MANDATORY_POST_WRITE_READBACK`  
**Production authorization:** `FALSE`

## 1. Purpose and authority boundary

This gate certifies the current governed AOS-NOVA Release 0 baseline only if the mandatory post-write remote read-back and final RULE-DOC-21 reconciliation remain clean.

The certification concerns the evidence-backed Release 0 baseline represented by the current AOS-NOVA source, the governed Registry v2 binding, the already-closed real-authenticated private Base44 runtime evidence, and the remediation/readiness chain registered before this gate.

This gate does **not** deploy or authorize AIRenOS production, public customer traffic, a production/custom domain cutover, PR #4 merge/closure, mutation of protected platform boundaries, AIRenOS Session Authority activation, AIRenOS bearer issuance, Stripe LIVE, K5, Registry v3, or Base44-role promotion into AIRenOS platform authority.

## 2. Fresh pre-certification authority reconciliation

### Drive authorities

- Canonical Handoff: `CHAT-HANDOFF-20260830-02`, Drive `1cLTVhQDg9Zkv9ZklwU7PGbTBYsOLAg5x4_1aA2yVZNA`, current numeric revision `78`.
- Platform Bible: Drive `1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA`, revision `119`.
- RULE-DOC-20: Drive `1L2yqy6XiKVsdbXe6vrVmlvFXRJCUFoXncnXeu7Bbpos`, revision `4`.
- RULE-DOC-21: Drive `1GyG1PdBZ3q1maqCva_ohS_PYgRovYXZD_tZ-Rj4jkNE`, revision `3`.
- Program Control: `AIRenOS_PROGRAM_CONTROL_MASTER_v0.1`, session lock `AOS-R0-CERT-20260909-1404` active for this gate.

### GitHub protected/reference boundaries

Repository: `carmelouk-hub/airen`.

- Identity `foundation/airenos-identity-f26-keycloak-render-staging-20260906` = `a5d86a321b5a881c68ad4830afa2244d2dd6af11`.
- R3 `r3/control-plane-20260822` = `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- `main` = `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`.
- RBL `rbl/ristoairen-real-baseline-01-20260827` = `d055fba86d938aa38cee648171425046c7d972a4`.
- K4 `kairos/k4-interactive-map-base44-20260830` = `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`.
- Registry v2 `governance/platform-state-registry-refresh-v2-20260908` = `eb7c443482e2bf6da6110b689a1c927fdb8e8eb8`.
- RULE-DOC-21 mirror `governance/rule-doc-21-20260824` = `51e5e409e404067a34979d811ae4028962ed3e40`.
- PR #4 = `OPEN / DRAFT / UNMERGED`, head `r3/control-plane-20260822` at `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.

No mismatch was observed at the pre-certification boundary.

## 3. Readiness chain entering certification

The gate inherits, but does not blindly assume, the governed readiness chain:

- `AOS-NOVA-R0-READINESS-001` identified three blocker classes and closed as remediation-required.
- `R0_B1_REAL_AUTH_PROVIDER_EVIDENCE = CLOSED_VERIFIED_REAL_AUTH_PASS`.
- `R0_B2_AUTH_SURFACE_TYPECHECK_DEBT = CLOSED_REMEDIATED_PASS`.
- `R0_B3_REGISTRY_PROVENANCE_AND_CONSUMER_CONTRACT = CLOSED_REMEDIATED_PASS`.
- `AOS_NOVA_R0_READINESS_002 = CLOSED_REASSESSMENT_READY_FOR_SEPARATE_CERTIFICATION_GATE`.
- `AOS_NOVA_RELEASE_0_READINESS = READY_FOR_SEPARATE_CERTIFICATION_GATE` before this gate.
- `AOS_NOVA_RELEASE_0_CERTIFIED = FALSE` before this gate.

Readiness reassessment authority:

- branch `governance/aos-nova-r0-readiness-reassessment-20260909`;
- commit `1dbd26d70aced576ccfdb0f72a7518a2292534f5`;
- file `docs/governance/AOS-NOVA-R0-READINESS-002-release-0-readiness-reassessment-v0.1.md`.

## 4. Fresh AOS-NOVA source and validation evidence

Base44 application:

- Name: `AIRenOS G2 / AOS-NOVA`.
- App ID: `6a9fb39f662a14e7c3692df6`.
- Private provider runtime: `https://ubiquitous-nova-core-link.base44.app`.

Fresh source verification during this certification gate:

- AOS-NOVA source HEAD = `4a16bf1e3bd47482a12fa3924eebbb5e969cfb82`.
- working tree = `CLEAN`.
- embedded Registry v2 SHA-256 = `c3f7590c83cb45056a6ce70c4a54cecaaf45ce40883949c11a0474b85dca6793`.
- `npm run typecheck` = PASS / exit `0`.
- `npm run lint` = PASS / exit `0`.
- `npm run verify:registry-consumer` = PASS / exit `0`.
- `REGISTRY_CONSUMER_NEGATIVE_TESTS = PASS`, cases `7`.
- `STALE_CURRENT_STATE_WITHHOLDING = PASS`.
- `npm run build` = PASS / exit `0`.

The only build observation is the non-failing Browserslist/caniuse-lite maintenance-age warning already classified as non-blocking by the readiness reassessment.

No AOS-NOVA source mutation was required or performed by this certification gate.

## 5. Provider/authentication evidence preservation

Fresh anonymous provider probe:

- runtime root = HTTP `302` to `/login`;
- `/login` = HTTP `200`;
- provider surface remains authentication-gated/private.

Fresh Base44 application census:

- registered users = `1`;
- existing user Base44 role = `admin`.

That Base44 role remains Base44 application authority only. It is not AIRenOS `platform_super_admin`, Session Authority, tenant authority, or any other AIRenOS server authority.

The canonical Handoff already closes the seam-free real-authenticated provider acceptance as:

- `AOS_NOVA_R0_B1_EXEC_002 = CLOSED_VERIFIED_REAL_AUTH_PASS`;
- `AOS_NOVA_R0_B1 = CLOSED_VERIFIED_REAL_AUTH_PASS`;
- `R0_B1_REAL_AUTH_PROVIDER_EVIDENCE = CLOSED_VERIFIED_REAL_AUTH_PASS`;
- `R0_B1_PROVIDER_UNBLOCK_PATH = CLOSED_EXECUTED_PRIVATE_RUNTIME_PASS`.

The current AOS-NOVA source HEAD and Registry SHA-256 are unchanged from the B1/readiness closure coordinates, and the private login boundary remains reachable. No drift was found that invalidates the governed B1 result.

## 6. Certification acceptance matrix

| ID | Acceptance condition | Result |
|---|---|---|
| R0-C01 | Canonical Handoff, Platform Bible and RULE-DOC-20/21 freshly available and reconciled | PASS |
| R0-C02 | Identity, R3, main, RBL, K4 and Registry v2 heads match governed coordinates | PASS |
| R0-C03 | PR #4 remains OPEN / DRAFT / UNMERGED | PASS |
| R0-C04 | Readiness 002 is closed and all three prior blocker classes are governed PASS | PASS |
| R0-C05 | AOS-NOVA source HEAD matches governed baseline and working tree is CLEAN | PASS |
| R0-C06 | Global typecheck, lint and build pass | PASS |
| R0-C07 | Registry consumer verification, negative tests and stale withholding pass fail-closed checks | PASS |
| R0-C08 | Embedded Registry v2 SHA-256 matches the governed binding | PASS |
| R0-C09 | Private runtime remains reachable and redirects anonymous access to real login | PASS |
| R0-C10 | B1 real authenticated runtime evidence remains valid with no source/hash drift | PASS |
| R0-C11 | Base44 `admin` is not promoted into AIRenOS authority | PASS |
| R0-C12 | No production/provider/source/protected-boundary mutation is required by certification | PASS |
| R0-C13 | GitHub artifact remote read-back + final Drive/GitHub reconciliation | PENDING_POST_WRITE |

## 7. Certification decision before mandatory post-write control

All substantive Release 0 acceptance conditions available before the governed write are PASS. No new Release 0 blocker was found.

Therefore this artifact records:

`AOS_NOVA_R0_CERT_001_EVIDENCE = PASS`

`AOS_NOVA_R0_CERT_001_DECISION = PASS_CANDIDATE_PENDING_MANDATORY_POST_WRITE_READBACK`

The canonical terminal promotion to `AOS_NOVA_RELEASE_0_CERTIFIED = TRUE` MUST occur only after this file and branch are remotely read back, R0-C13 passes, the protected boundaries remain unchanged, and the Canonical Handoff is appended and read back under RULE-DOC-21.

## 8. Certification meaning after canonical promotion

If R0-C13 and the canonical Handoff post-write controls pass, `AOS-NOVA Release 0` is certified as the current **governed non-production Release 0 baseline**.

Certification means that the Release 0 artifact/evidence set satisfies the acceptance boundary defined by the readiness chain and current Platform Bible constraints at the time of certification.

Certification does not mean deployment to AIRenOS production, public availability, customer go-live, merger into protected branches, provider production cutover, or activation of authority/security subsystems that have their own gates.

## 9. Explicit non-effects / hard stops

This certification gate does not authorize or execute:

- AIRenOS production deployment or public customer traffic;
- production/custom-domain cutover;
- PR #4 merge or closure;
- mutation of `main`, R3, Identity, RBL or K4;
- AIRenOS Session Authority activation;
- AIRenOS bearer issuance;
- Stripe LIVE or real-money operation;
- K5;
- Registry v3;
- Base44 branch merge;
- Base44 role promotion into AIRenOS authority;
- rewriting certified history.

Any future one of those actions requires its own governed gate and explicit authorization where required.

**END AOS-NOVA-R0-CERT-001 v0.1 — EVIDENCE PASS / CANONICAL POST-WRITE PROMOTION PENDING**
