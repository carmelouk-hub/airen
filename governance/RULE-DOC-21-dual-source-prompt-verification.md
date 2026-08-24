# RULE-DOC-21 — Dual-Source Prompt Verification Protocol

**Project:** AIRenOS / RISTOAIREN  
**Version:** 1.0 — 2026-08-24  
**Status:** ACTIVE / PERMANENT GOVERNANCE RULE  
**Canonical Drive authority:** `1GyG1PdBZ3q1maqCva_ohS_PYgRovYXZD_tZ-Rj4jkNE`

## Binding rule

Every governed AIRenOS / RISTOAIREN prompt MUST perform a live dual-source verification against both canonical authorities before its operational conclusion:

- **GitHub** — current governed repository/branch/HEAD, PR #4 when applicable, and directly affected files or commits.
- **Google Drive / AIRenOS Platform Bible** — current human authority, machine authority, registry, specification or evidence relevant to the prompt.

Conversation memory and prior summaries are working context only and MUST NOT override a fresher GitHub or Drive read-back.

## Pre-action verification

Before any governed write or state promotion, verify at minimum:

- active repository and branch;
- current HEAD SHA;
- governed PR state and head SHA when applicable;
- relevant Drive authority and latest state/revision;
- relevant MRS / machine specification and current `nextAction`;
- absence of unresolved GitHub ↔ Drive divergence.

Any material divergence triggers **RECONCILIATION STOP**.

## Write intent

Before a write, identify:

- GitHub files expected to be created or modified;
- Drive documents, sheets, registries or evidence expected to be created or modified;
- expected resulting state;
- protected artifacts and boundaries that MUST NOT change.

RULE-DOC-15 remains fully applicable.

## Post-write GitHub read-back

A successful write response is not sufficient. Verify remotely, as applicable:

- resulting commit SHA;
- tree SHA;
- blob SHA and/or exact file content;
- changed-file set/diff;
- branch HEAD;
- PR state/head;
- CI run and artifacts when a gate pipeline is triggered.

No GitHub update may be declared complete without this read-back.

## Post-write Google Drive read-back

A successful Drive write response is not sufficient. Verify remotely, as applicable:

- Google Doc revision and persisted text/range;
- Google Sheet persisted cells/ranges;
- raw JSON/ZIP/evidence size and hash when applicable;
- file/folder parent placement;
- latest registry row/state.

For critical raw evidence, re-download and compare SHA-256 whenever technically possible.

## Cross-source reconciliation

Before a governed prompt is considered complete, reconcile GitHub and Drive for all applicable fields, including:

- milestone/state;
- branch/commit/tree;
- file census;
- CI run/conclusion;
- artifact ID/digest;
- Drive evidence ID/hash;
- PASS/CLOSED/PENDING/FAILURE classification;
- `nextAction`.

PASS/CLOSED promotion is forbidden when either source is stale or contradictory.

## Verification outcomes

Every governed prompt resolves internally to one of:

- `MATCH` — both sources agree and requested updates are verified;
- `NO_CHANGE_VERIFIED` — read-only/no-write prompt; both sources checked and no update required;
- `MISMATCH_STOP` — divergence detected; stop until reconciled;
- `SOURCE_UNAVAILABLE_STOP` — a required source cannot be verified; never substitute memory or assumption.

Read-only prompts still require the minimum GitHub + Drive check.

## Certified closure protection

RULE-DOC-21 does **not** authorize documentation-only changes to an already certified source tree. Governance mirrors created after closure MUST use a separate governance/docs branch or another mechanism that leaves the certified branch/tree untouched unless a new formal authorization explicitly changes that boundary.

## Fail-closed behavior

If verification fails:

- do not invent missing state;
- do not assume a previous write persisted;
- do not declare PASS/CLOSED;
- do not advance to a new gate;
- preserve relevant divergence/failure evidence;
- reconcile before continuing.

## Relationship to existing governance

RULE-DOC-21 integrates and strengthens RULE-DOC-15 through RULE-DOC-20. When controls overlap, the more restrictive fail-closed control prevails.

## Machine-readable activation

```text
rule_id=RULE-DOC-21
state=ACTIVE_PERMANENT
scope=AIRENOS_RISTOAIREN_ALL_GOVERNED_PROMPTS
pre_prompt_github_check=MANDATORY
pre_prompt_drive_check=MANDATORY
post_write_github_readback=MANDATORY
post_write_drive_readback=MANDATORY
cross_source_reconciliation=MANDATORY
failure_mode=STOP_FAIL_CLOSED
no_memory_override=TRUE
pass_closed_requires_dual_match=TRUE
```

This GitHub file is the governed code-history mirror. The Google Drive document identified above remains the canonical governance authority.