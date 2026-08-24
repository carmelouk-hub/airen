# Base44 Implementation Synchronization Gate v1

**Applies to:** AIRenOS and RistoAIRen Base44 applications

**Gate state:** `MANDATORY_FOR_EVERY_BASE44_IMPLEMENTATION`

**Production deployment authorized:** `false unless separately governed`

## Purpose

This gate prevents a local or GitHub implementation from being reported as received by Base44 without direct remote evidence. It also requires every new milestone to audit and reconcile prior in-scope changes that were not synchronized.

The gate distinguishes four states:

1. local workspace state;
2. GitHub repository state;
3. Base44 sandbox state;
4. Base44 published/production state.

None of these states proves another.

## Mandatory questions

| ID | Question | Required evidence | Fail-closed result |
|---|---|---|---|
| `B44-SG-01` | Is the change authorized for its exact design, sandbox, staging or runtime scope? | governing decision and explicit boundary | `BLOCK_UNAUTHORIZED_SCOPE` |
| `B44-SG-02` | Is the intended implementation complete and verified locally? | changed-file inventory, tests and build | `LOCAL_INCOMPLETE` |
| `B44-SG-03` | Is the exact local state committed and pushed to GitHub? | full commit SHA and remote-branch equality | `GITHUB_NOT_ALIGNED` |
| `B44-SG-04` | Has the correct Base44 app received the same in-scope files, including prior unsynchronized work? | app id, remote inventory and reconciliation manifest | `BASE44_NOT_SYNCHRONIZED` |
| `B44-SG-05` | Does remote evidence prove parity with the committed local state? | content hashes or exact verified readback for every synchronized file | `REMOTE_PARITY_UNPROVEN` |
| `B44-SG-06` | Do required tests and optimized build pass locally and in the Base44 sandbox? | command results from both environments | `VERIFICATION_FAILED` |
| `B44-SG-07` | Does the Base44 preview show the intended interface without browser or console errors? | preview URL, targeted UI assertions and console result | `PREVIEW_UNVERIFIED` |
| `B44-SG-08` | Were provider resources or publication state changed? | entity/function/agent/connector/auth/secret inventory and explicit publication state | `RESOURCE_OR_PUBLICATION_UNKNOWN` |
| `B44-SG-09` | Is there a recoverable checkpoint and complete evidence record? | checkpoint id/commit, parity status, gaps and ADR impact | `CHECKPOINT_OR_EVIDENCE_MISSING` |

## Historical reconciliation rule

When a milestone discovers earlier in-scope changes that are present locally or on GitHub but absent from Base44, the milestone must:

1. record the discrepancy before mutation;
2. identify the exact correct Base44 app id;
3. synchronize the complete safe review/staging slice, not only the newest file;
4. verify remote parity after the auto-commit;
5. run remote tests and build;
6. verify the Base44 preview;
7. create a named checkpoint;
8. preserve production publication as `NOT_PERFORMED` unless separately authorized.

## Prohibited shortcuts

- Do not treat a GitHub push as a Base44 synchronization.
- Do not treat a Base44 sandbox auto-commit as a production publication.
- Do not publish merely to prove that sandbox synchronization worked.
- Do not add backend resources, auth changes, secrets or connectors while synchronizing a frontend-only review shell.
- Do not overwrite an unexplained remote change; read and reconcile it first.
- Do not mark the gate complete when any answer is `UNKNOWN`, `MISSING`, `FAILED` or contradicted by remote evidence.

## Required milestone receipt

Every Base44 milestone receipt records:

- local repository path and commit SHA;
- Base44 app id;
- synchronized file manifest and parity proof;
- local and remote test/build results;
- preview verification result;
- remote resource delta;
- sandbox checkpoint id and commit hash;
- Base44 publication state;
- unresolved gaps and ADR impact.
