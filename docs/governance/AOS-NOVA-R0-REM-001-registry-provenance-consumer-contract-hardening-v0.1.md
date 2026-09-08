# AOS-NOVA-R0-REM-001 — Registry Provenance Semantics + Complete Consumer Contract Hardening — v0.1

**Date:** 2026-09-08  
**Scope:** AOS-NOVA Release 0 blocker R0-B3 only  
**Governance:** RULE-DOC-20 + RULE-DOC-21  
**Terminal state:** `AOS_NOVA_R0_REM_001 = CLOSED_VERIFIED_PASS`  
**Blocker state:** `R0_B3_REGISTRY_PROVENANCE_AND_CONSUMER_CONTRACT = CLOSED_REMEDIATED_PASS`  
**Release 0 readiness:** `NOT_READY`  
**Release 0 certification:** `FALSE`

## 1. Purpose

Remediate the Release 0 readiness audit blocker R0-B3 without creating a new Registry snapshot, without rewriting certified history, and without promoting Base44 into AIRenOS authority.

The remediation addresses two audited gaps:

1. historical certification labels in AOS-NOVA were factually supported by canonical Handoff evidence but were presented too broadly as if contained in AOS-PSR-001 v2;
2. the fail-closed Registry adapter did not assert every consumer-contract invariant carried by Registry v2.

During implementation, the same consumer contract exposed an additional semantic requirement: a stale governed snapshot may remain inspectable as evidence but must not continue feeding current governed state.

## 2. Governed basis

At the governed transaction boundaries used for this remediation:

- Canonical Handoff revision: `69`.
- Platform Bible revision: `119`.
- RULE-DOC-20 revision: `4`.
- RULE-DOC-21 revision: `3`.
- R0 readiness audit branch `governance/aos-nova-r0-readiness-audit-20260908`: `729d39ca1584c86a63a8bdd288e458ad5ccb7aee`.
- Registry v2 branch `governance/platform-state-registry-refresh-v2-20260908`: `eb7c443482e2bf6da6110b689a1c927fdb8e8eb8`.
- Identity protected head: `a5d86a321b5a881c68ad4830afa2244d2dd6af11`.
- R3 protected head: `3d32b53bde2191c7718606cf9d3fe3497ae3f626`.
- `main`: `b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c`.
- RBL: `d055fba86d938aa38cee648171425046c7d972a4`.
- K4: `ff97685ec4d427c8793c0c8b8bbceece5258fc8a`.
- PR #4: `OPEN / DRAFT / UNMERGED`.

## 3. Base44 implementation lineage

Application: `AIRenOS G2 / AOS-NOVA`, Base44 App ID `6a9fb39f662a14e7c3692df6`.

Pre-remediation source:

- commit `da52777072cb25fc533eff2685d794b24a7bdb8b`.

Implementation commits created by the Base44 source mutation path:

1. `a1c05f26d023d24226abec276a83064e805adc81`
   - parent `da52777072cb25fc533eff2685d794b24a7bdb8b`;
   - provenance/UI/adapter/test implementation.
2. `9981009b39bcf2cb7098e93685f0a578358dc9f6`
   - parent `a1c05f26d023d24226abec276a83064e805adc81`;
   - deterministic test-harness hardening only.

Final Base44 state:

- HEAD `9981009b39bcf2cb7098e93685f0a578358dc9f6`.
- working tree `CLEAN`.
- checkpoint ID `6aa06959d99ce9d9d154e916`.
- checkpoint name `AOS-NOVA — R0-REM-001 Registry provenance + consumer contract hardening — VERIFIED 2026-09-08`.

Final relevant blobs:

- `src/lib/platformStateRegistry.js`: `14013071238f861343332c9503d33c272e5c3a36`.
- `src/App.jsx`: `dd2de9788ec836730d83d4c0cff28dd0d2ba2c0c`.
- `scripts/verify-platform-state-registry-consumer.mjs`: `8c6c00ba1077aafc225f3952a49141d68e54584a`.

Registry consumer copy remained unchanged throughout the remediation:

- embedded Registry SHA-256 `c3f7590c83cb45056a6ce70c4a54cecaaf45ce40883949c11a0474b85dca6793`;
- embedded Registry blob `ab808ac3db5935219a7eb9279a328d9f34257ddb`;
- canonical Registry v2 branch remains `eb7c443482e2bf6da6110b689a1c927fdb8e8eb8`.

No Registry v3 was created.

## 4. Provenance semantics remediation

AOS-NOVA now separates three provenance classes explicitly:

- `REGISTRY_CURRENT_STATE` — current-state display derived from the bound AOS-PSR-001 snapshot only while that snapshot is fresh;
- `HISTORICAL_HANDOFF_EVIDENCE` — historical certification supported by canonical Handoff evidence but not claimed to be contained in Registry v2;
- `EXPLICIT_GOVERNANCE_LOCK` — preserved authority locks such as Session Authority and AIRenOS bearer that Base44 cannot promote.

Historical milestones AOS-01, AOS-02, AOS-03, AB-01→AB-05, AB-GATE-E and AP-01 are now labeled `CERTIFIED HISTORY` and explicitly attributed to canonical Handoff evidence.

They are no longer described as milestones contained in the verified Registry v2 snapshot.

Product cards no longer use `CERTIFIED REGISTRY`. They use `GOVERNED IDENTITY` and explicitly state that identity provenance comes from governed history, not AOS-PSR-001 v2. Runtime availability is not inferred.

The Evolution summary now distinguishes historical certified milestones from entries whose current state is read from AOS-PSR-001.

Each roadmap row exposes its provenance class in the UI.

## 5. Complete consumer-contract fail-closed validation

`validatePlatformStateRegistry()` now asserts all seven consumer-contract invariants carried by Registry v2:

1. `display_current_state_only_when_verified_against_sources = true`;
2. `stale_snapshot_must_be_labeled = true`;
3. `basis_revision_must_not_be_rendered_as_live_revision = true`;
4. `base44_is_authority = false`;
5. `client_may_self_promote_state = false`;
6. `missing_state_behavior = SHOW_UNKNOWN_OR_NOT_VERIFIED`;
7. `automatic_gate_promotion = false`.

Any weakening fails closed with an explicit validation reason.

## 6. Stale snapshot current-state withholding

A valid but stale snapshot remains inspectable as governed evidence:

- classification: `STALE_SNAPSHOT`;
- `isUsable = true` for bounded evidence inspection.

However it is no longer usable as current governed state:

- `isCurrentStateUsable = false`;
- `getGovernedState(...)` returns `null` for stale snapshots;
- AOS-NOVA current governed-state rows are withheld rather than falling back to stale values.

This enforces the existing Registry v2 contract `display_current_state_only_when_verified_against_sources = true` together with `stale_snapshot_must_be_labeled = true`.

## 7. Verification evidence

Persistent verification command:

`npm run verify:registry-consumer`

Final result:

- `REGISTRY_CONSUMER_NEGATIVE_TESTS=PASS cases=7`;
- `STALE_CURRENT_STATE_WITHHOLDING=PASS`.

Additional validation:

- `npm run build` = PASS;
- `npm run lint` = PASS;
- global `npm run typecheck` = non-zero with exactly `57` existing error lines;
- target files `src/App.jsx` + `src/lib/platformStateRegistry.js` = `0` typecheck error lines.

The global 57-error auth/UI debt is unchanged from the preceding R0 readiness audit and remains blocker R0-B2. REM-001 neither masks nor promotes it.

## 8. Blocker disposition

Closed by this remediation:

`R0_B3_REGISTRY_PROVENANCE_AND_CONSUMER_CONTRACT = CLOSED_REMEDIATED_PASS`

Still open/deferred outside this remediation:

- `R0_B1_REAL_AUTH_PROVIDER_EVIDENCE = DEFERRED_EVIDENCE_BLOCKED_NOT_FAILED`;
- `R0_B2_AUTH_SURFACE_TYPECHECK_DEBT = REMEDIATION_REQUIRED`.

Therefore:

`AOS_NOVA_RELEASE_0_READINESS = NOT_READY`

`AOS_NOVA_RELEASE_0_CERTIFIED = FALSE`

REM-001 does not open the Release 0 certification gate.

## 9. Explicit non-effects

This remediation does not authorize or execute:

- Base44 site deployment;
- provider or production deployment;
- real authenticated Base44 runtime acceptance;
- Release 0 certification;
- PR #4 merge;
- mutation of `main`, R3, Identity, RBL or K4;
- Session Authority activation;
- AIRenOS bearer issuance;
- Stripe LIVE or real-money operation;
- K5;
- Registry v2 byte mutation or Registry v3 creation;
- deletion of quarantined forensic synthetic evidence;
- rewriting of certified history.

**END AOS-NOVA-R0-REM-001 v0.1**
