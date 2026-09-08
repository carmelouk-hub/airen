# AOS-PSR-RR-001 — Governed Registry Refresh / Rebind Protocol v0.1

Status: GOVERNED PROTOCOL IMPLEMENTED / NOT SELF-EXECUTING

Repository: `carmelouk-hub/airen`

Machine contract: `machine-context/airenos-platform-state-registry-refresh-rebind-protocol.v0.1.json`

Seed Registry: `AOS-PSR-001`

Seed commit: `2dfe06f7cdccc8e7ab38e4accb7a252e21a2d687`

Seed blob: `c644ea171f8e9df5471ee209403b02ac3029447b`

Seed SHA-256: `6aa8741183e8d703752c6ba6e4c8d12a54cfb17c05c4e7a177fbe068b672874d`

## 1. Purpose

This protocol defines how AIRenOS may refresh the machine-readable Platform State Registry and rebind presentation consumers such as AOS-NOVA without allowing the Registry, automation, Base44, CI, a browser client, or any other consumer to become authority.

The protocol exists to eliminate manual revision chasing while preserving the current AIRenOS governance model.

A refresh is a governed derivation of already-authoritative facts.

A rebind is a governed replacement of a consumer copy with bytes already registered as the current Registry snapshot.

Neither operation creates authority.

## 2. Non-negotiable authority boundary

The protocol:

- cannot certify a gate;
- cannot open a gate;
- cannot authorize production;
- cannot issue AIRenOS Session Authority;
- cannot issue an AIRenOS bearer;
- cannot enable Stripe LIVE;
- cannot authorize K5;
- cannot merge PR #4;
- cannot override the Platform Bible, canonical Handoff, RULE-DOC-20, RULE-DOC-21, protected GitHub boundaries, or any other designated human authority;
- cannot infer missing state;
- cannot rewrite certified history.

Conflict policy is always:

`FAIL_CLOSED_SOURCE_AUTHORITY_WINS`

Unknown policy is always:

`UNKNOWN_NOT_INFERRED`

## 3. Why the protocol is split into Refresh and Rebind

The Registry and its consumer are deliberately separated.

### Refresh

Refresh produces a new candidate Platform State Registry snapshot from fresh, reconciled canonical source facts.

The candidate is not authoritative merely because it exists in GitHub.

It becomes a registered governed snapshot only after:

1. fresh dual-source reconciliation;
2. candidate generation;
3. structural validation;
4. semantic diff classification;
5. a second fresh reconciliation immediately before publish;
6. candidate commit;
7. remote read-back of the exact committed bytes;
8. append-only registration in the canonical Handoff;
9. remote Handoff read-back and final cross-source reconciliation.

### Rebind

Rebind begins only after a Registry snapshot is already registered.

A consumer such as AOS-NOVA may then receive an exact byte-for-byte copy of that registered snapshot and update only the binding metadata that identifies the immutable source commit, blob and SHA-256.

The consumer remains presentation-only.

## 4. Refresh transaction model

Each refresh is a logical governed transaction.

Recommended transaction identifier:

`AOS-PSR-REFRESH-YYYYMMDD-HHMMSSZ`

Each transaction starts from the last registered Registry commit and uses an isolated governance candidate branch.

The candidate branch name is lineage only. It is not authority.

If any canonical source changes during the transaction, the transaction is aborted and restarted from fresh reconciliation.

Partial output must never be promoted.

## 5. Refresh pipeline

### R0 — PRECHECK

Before candidate generation:

- read the current canonical Handoff and its live revision;
- read the current Platform Bible and its live revision;
- read the last registered Registry bytes from the exact registered commit;
- verify Registry blob and SHA-256;
- perform fresh GitHub + Google Drive reconciliation;
- verify all relevant protected boundaries;
- verify PR #4 remains OPEN / DRAFT / UNMERGED;
- fail closed on mismatch, unavailable source, or incomplete evidence.

No write is allowed in R0.

### R1 — OBSERVE

Collect only facts explicitly supported by canonical human authorities and verified protected boundaries.

Forbidden:

- promoting a gate from CI alone;
- treating Base44 as authority;
- treating the previous Registry value as source authority;
- silently carrying forward missing state unless a canonical source explicitly preserves it.

### R2 — CANDIDATE

Generate a complete candidate Registry document.

Required rules:

- same `registry_id`;
- compatible schema;
- `snapshot_version = previous + 1`;
- new `observed_at`;
- basis revisions equal the source revisions actually read;
- all deny flags remain false;
- `FAIL_CLOSED_SOURCE_AUTHORITY_WINS` remains unchanged;
- `UNKNOWN_NOT_INFERRED` remains unchanged;
- protected boundary identifiers remain present;
- certified history remains preserved.

The candidate is not yet registered authority.

### R3 — STRUCTURAL VALIDATION

The candidate must verify at minimum:

- Registry ID unchanged;
- schema compatible;
- snapshot monotonicity valid;
- `may_certify_gate = false`;
- `may_open_gate = false`;
- `may_authorize_production = false`;
- `may_override_source_authority = false`;
- conflict policy unchanged;
- unknown policy unchanged.

Any failure blocks the transaction.

### R4 — SEMANTIC DIFF

Every changed field must be classified.

Allowed classifications:

`PROVENANCE_ONLY`

A revision, timestamp, evidence pointer or equivalent provenance value changed without changing governed meaning.

`BOUNDARY_MOVEMENT`

A protected branch head, PR state or equivalent boundary changed. This requires direct source evidence and must not be interpreted as gate authorization unless a canonical authority says so.

`STATE_TRANSITION`

A governed state changed. This is allowed only when an explicit designated human authority already supports the transition.

`AUTHORITY_MODEL_CHANGE`

Forbidden during ordinary refresh. Requires a separate governance task.

`UNKNOWN_OR_UNSUPPORTED`

Fail closed.

### R5 — PRE-PUBLISH RECONCILIATION

Immediately before publishing the Registry candidate, perform another fresh GitHub + Drive reconciliation.

Every source revision and protected ref used by the candidate must still match.

If any input advanced concurrently, abort and restart.

PR #4 must still be OPEN / DRAFT / UNMERGED.

### R6 — PUBLISH SNAPSHOT

Commit the complete Registry candidate on its isolated governance branch.

Record:

- commit SHA;
- blob SHA;
- SHA-256 of exact bytes;
- snapshot version.

This commit is still only a candidate until canonical registration completes.

No protected branch mutation, production action, provider action, merge, Session Authority action, bearer issuance, Stripe LIVE action or K5 authorization is permitted.

### R7 — REMOTE READ-BACK

Read the committed file remotely from the exact commit.

Verify:

- bytes match candidate;
- commit matches expected commit;
- blob matches expected blob;
- SHA-256 matches computed SHA-256.

Mismatch fails closed.

### R8 — REGISTER SNAPSHOT

Append the new Registry snapshot evidence to the canonical Handoff using a fresh Google Docs revision lock.

The registration must preserve prior Registry registrations and must explicitly state that Registry registration does not certify a new product or runtime gate by itself.

The source revisions recorded inside the Registry remain input-basis provenance. They are not promises that the human authority will never advance after registration.

### R9 — POST-REGISTER RECONCILIATION

Remote read-back the Handoff registration and perform fresh GitHub + Drive reconciliation.

Only after PASS may the Registry refresh be classified:

`REGISTRY_REFRESH_REGISTERED`

## 6. State transition rule

A state transition may be reflected by the Registry only when a designated canonical authority already supports it.

The following alone are insufficient:

- CI PASS;
- Base44 checkpoint;
- local test PASS;
- runtime smoke PASS;
- source code existence;
- implementation completion;
- previous Registry state.

These may be evidence, but they do not substitute governance authority.

## 7. Rebind prerequisites

Rebind is permitted only when all of the following are true:

- the new Registry snapshot has remote read-back MATCH;
- the snapshot is registered in the canonical Handoff;
- post-registration cross-source reconciliation is PASS;
- the target consumer is presentation-only and non-authoritative;
- the consumer's current binding is readable and hashable.

## 8. Rebind pipeline

### B0 — PRECHECK

Perform fresh RULE-DOC-21 reconciliation and resolve the exact registered Registry commit/blob/hash selected for rebind.

### B1 — FETCH REGISTERED BYTES

Fetch the Registry from the exact immutable registered commit.

Never use an unpinned branch tip as the rebind source.

### B2 — VERIFY SOURCE BYTES

Compute SHA-256 before touching the consumer.

If the digest does not match the registered Handoff evidence, abort.

### B3 — COPY BYTE-IDENTICAL

Replace the consumer Registry data copy with exact registered bytes only.

No transformation, normalization or semantic rewriting is permitted.

### B4 — UPDATE BINDING METADATA

Update only provenance binding metadata such as:

- `registryId`;
- `schema`;
- `sourceRepository`;
- `sourcePath`;
- `sourceCommit`;
- `sourceBlob`;
- `sourceSha256`.

Governed semantic values must continue to come from the Registry document itself.

### B5 — CONSUMER VALIDATION

Required behavior:

- valid recent snapshot → `VERIFIED_SNAPSHOT_NOT_LIVE`;
- valid expired snapshot → `STALE_SNAPSHOT`;
- invalid authority flags → `UNKNOWN_NOT_VERIFIED`;
- missing coordinate → `null` or equivalent unknown-not-inferred behavior;
- `isLive` always remains false.

Required technical validation where supported:

- build;
- lint;
- target typecheck;
- fail-closed adapter tests;
- freshness classification tests;
- preview HTTP smoke.

Existing unrelated baseline debt must be preserved honestly and must not be mislabeled as target PASS.

### B6 — CHECKPOINT

Create a consumer checkpoint only after target validation PASS.

The checkpoint is presentation evidence only.

### B7 — REMOTE READ-BACK

Read the consumer Registry copy, adapter and binding remotely.

Verify the byte hash and checkpoint commit.

### B8 — REGISTER REBIND

Append rebind evidence to the canonical Handoff with a fresh revision lock.

### B9 — FINAL RECONCILIATION

Remote read-back the registration and perform final cross-source reconciliation including the consumer.

Only after PASS may the rebind be classified:

`CONSUMER_REBIND_REGISTERED`

## 9. Staleness policy

A consumer snapshot is never live authority.

Default maximum age: 24 hours.

Expired snapshot classification:

`STALE_SNAPSHOT`

Invalid snapshot classification:

`UNKNOWN_NOT_VERIFIED`

Staleness must not automatically trigger a rebind and must never modify canonical governed state.

## 10. Abort conditions

The protocol fails closed when any of the following occurs:

- canonical source unavailable;
- Drive revision changes during transaction;
- protected GitHub ref changes during transaction;
- PR #4 is no longer OPEN / DRAFT / UNMERGED;
- Registry digest mismatch;
- unsupported state transition;
- authority-model drift;
- candidate schema invalid;
- consumer copy is not byte-identical;
- consumer fail-closed tests fail;
- any step attempts to open a gate or authorize production from protocol output.

## 11. Explicit non-effects

Implementation of AOS-PSR-RR-001 does not cause or authorize:

- production cutover;
- merge;
- Session Authority activation;
- AIRenOS bearer issuance;
- Stripe LIVE enablement;
- K5 authorization;
- provider deployment;
- Base44 decommission;
- rewrite of certified history.

## 12. Completion vocabulary

Protocol implementation complete:

`AOS_PSR_REFRESH_REBIND_PROTOCOL_IMPLEMENTED`

Successful future Registry refresh:

`REGISTRY_REFRESH_REGISTERED`

Successful future consumer rebind:

`CONSUMER_REBIND_REGISTERED`

Blocked transaction:

`FAIL_CLOSED_BLOCKED`

## 13. Current implementation boundary

This v0.1 establishes the governed process and machine contract only.

It does not execute a Registry refresh, because the currently registered Registry snapshot remains the seed snapshot and no new governed state transition is being introduced by this protocol task.

It does not execute an AOS-NOVA rebind, because no new registered Registry snapshot exists to bind.

That separation is intentional: protocol implementation must never create artificial work or a false state change merely to prove that the protocol exists.
