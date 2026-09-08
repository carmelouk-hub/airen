# AOS-PSR-RR-001 — Governed Registry Refresh / Rebind Protocol v0.1.1

Status: GOVERNED LIFECYCLE HARDENING IMPLEMENTED / NOT SELF-EXECUTING

Repository: `carmelouk-hub/airen`

Machine contract: `machine-context/airenos-platform-state-registry-refresh-rebind-protocol.v0.1.1.json`

Supersedes protocol v0.1 without rewriting it.

Seed Registry remains `AOS-PSR-001`, snapshot version 1, commit `2dfe06f7cdccc8e7ab38e4accb7a252e21a2d687`, blob `c644ea171f8e9df5471ee209403b02ac3029447b`, SHA-256 `6aa8741183e8d703752c6ba6e4c8d12a54cfb17c05c4e7a177fbe068b672874d`.

## 1. Purpose of this patch

The governed no-change dry-run exposed one semantic ambiguity in v0.1: the seed Registry uses `status = INITIAL_GOVERNED_SNAPSHOT`, but v0.1 did not define the required internal `status` for snapshot version 2 and later.

This patch closes only that gap.

It does not execute a Registry refresh or consumer rebind and does not alter any product/runtime gate.

## 2. Snapshot lifecycle rule

The Registry `status` field classifies the origin/lifecycle generation of the snapshot. It does not assert that the snapshot has already been registered in the canonical Handoff.

The rules are now explicit:

- `snapshot_version = 1` requires `status = INITIAL_GOVERNED_SNAPSHOT`;
- `snapshot_version >= 2` requires `status = GOVERNED_REFRESH_SNAPSHOT`;
- `INITIAL_GOVERNED_SNAPSHOT` is forbidden for versions greater than 1;
- `GOVERNED_REFRESH_SNAPSHOT` does not certify a gate, does not claim live authority and does not by itself assert Handoff registration.

## 3. Why registration remains external

The refresh pipeline commits snapshot bytes at R6 and registers that immutable commit in the canonical Handoff at R8.

Therefore a candidate cannot truthfully encode a final `REGISTERED` assertion inside its bytes before R8 occurs.

The transaction states remain external evidence:

- before R8: `CANDIDATE_UNREGISTERED`;
- after R8 plus R9 PASS: `REGISTRY_REFRESH_REGISTERED`.

The committed snapshot bytes must not be rewritten after registration merely to change lifecycle vocabulary.

This avoids circular mutation and preserves immutable provenance.

## 4. Structural validation hardening

Future Registry refreshes must now additionally verify:

- `SNAPSHOT_STATUS_MATCHES_VERSION_LIFECYCLE`;
- `INITIAL_STATUS_ONLY_VERSION_ONE`;
- `REFRESH_STATUS_REQUIRED_VERSION_TWO_PLUS`;
- `SNAPSHOT_STATUS_DOES_NOT_ASSERT_HANDOFF_REGISTRATION`.

A lifecycle mismatch is fail-closed.

A premature registered assertion inside snapshot bytes is fail-closed.

## 5. Semantic diff classification

The first normal transition from:

`snapshot_version = 1 / INITIAL_GOVERNED_SNAPSHOT`

to:

`snapshot_version = 2 / GOVERNED_REFRESH_SNAPSHOT`

is expected lifecycle metadata. It is not, by itself, a product gate, runtime gate, entitlement or production state transition.

Any actual governed-state change inside the snapshot still requires explicit designated human authority exactly as in v0.1.

## 6. Preserved authority boundary

This patch cannot:

- certify or open a gate;
- authorize production;
- issue Session Authority or AIRenOS bearer;
- enable Stripe LIVE;
- authorize K5;
- merge PR #4;
- override canonical source authority;
- infer missing state;
- rewrite certified history;
- make Base44 or another consumer authoritative.

Conflict policy remains `FAIL_CLOSED_SOURCE_AUTHORITY_WINS`.

Unknown policy remains `UNKNOWN_NOT_INFERRED`.

## 7. Explicit non-effects of v0.1.1

`REGISTRY_REFRESH_EXECUTED = FALSE`

`REGISTRY_REBIND_EXECUTED = FALSE`

No Registry v2 is created by this patch.

No AOS-NOVA rebind is executed by this patch.

No protected GitHub boundary, production surface, provider, billing state, identity authority or certified history is modified.

## 8. Completion state

Successful implementation of this hardening patch is classified:

`AOS_PSR_RR_001_V0_1_1_LIFECYCLE_HARDENING_IMPLEMENTED`

Future successful Registry refresh remains:

`REGISTRY_REFRESH_REGISTERED`

Future successful consumer rebind remains:

`CONSUMER_REBIND_REGISTERED`
