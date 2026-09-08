# AOS-NOVA-BASE44-STAGING-AUTH-001 — Base44 Staging Runtime Authorization Contract — v0.1

**Status:** IMPLEMENTED_GOVERNED_NOT_EXECUTED  
**Date:** 2026-09-08  
**Scope:** AOS-NOVA / Base44 / non-production authenticated runtime evidence only

## Purpose

This contract authorizes only the minimum non-production Base44 runtime needed to reproduce a real authenticated AOS-NOVA application session and verify the Registry v2 consumer without test seams.

It does **not** authorize production, Release 0 certification, PR #4 merge, K5, AIRenOS Session Authority, AIRenOS bearer issuance, Stripe LIVE, provider production cutover, or any mutation of protected AIRenOS branches.

## Preconditions

Before any execution under this contract:

1. Perform a fresh RULE-DOC-21 dual-source reconciliation against GitHub + Google Drive.
2. Read the current Canonical Handoff and Platform Bible.
3. Verify Registry v2, Identity, R3, `main`, RBL and K4 protected coordinates.
4. Verify PR #4 remains OPEN / DRAFT / UNMERGED.
5. Verify AOS-NOVA source matches the registered governed checkpoint and Registry v2 binding.
6. Fail closed on any mismatch, unavailable authority, or incomplete evidence.

## Narrowly authorized execution

A later governed execution may:

- create or enable a **non-production staging-only** Base44 runtime for AOS-NOVA;
- use an already registered Base44 user to perform a real application login;
- verify that `base44.auth.me()` succeeds for that authenticated session;
- render the protected AOS-NOVA Control Plane without a test seam or mock;
- verify Registry v2 commit/blob/SHA-256 binding and non-live/read-only semantics;
- collect runtime evidence;
- make source changes only if strictly required for staging-runtime compatibility, followed by normal Base44 checkpoint/read-back/reconciliation;
- append the governed result to the Canonical Handoff.

## Explicitly denied

This contract does not authorize:

- production deploy or production feature enablement;
- Release 0 certification;
- merge or closure of PR #4;
- mutation of `main`, R3, Identity, RBL or K4;
- K5 activation;
- AIRenOS Session Authority activation;
- AIRenOS bearer issuance;
- Stripe LIVE;
- provider production cutover;
- treating a Base44 user or Base44 role as AIRenOS authority;
- using a test seam, mock user, intercepted `User/me`, or fabricated token for the final authenticated acceptance;
- inventing credentials, creating replacement credentials, or resetting a user's password without a separate explicit authorization;
- automatic promotion of any governance gate.

## Runtime invariants

- Environment class: `NON_PRODUCTION_STAGING_ONLY`.
- Base44 remains presentation/implementation infrastructure, not AIRenOS authority.
- A Base44 `admin` role is not an AIRenOS platform role.
- The Platform State Registry remains a governed non-live snapshot.
- The Registry consumer remains read-only.
- Final acceptance requires a real Base44 application-authenticated session and successful `base44.auth.me()`.
- Final acceptance must not use the visual test seam used by the earlier independent rendering test.
- Only existing registered Base44 users may be used unless a separate governed authorization explicitly permits otherwise.
- Credentials, tokens and secrets must never be committed to GitHub, written to Drive, or printed into governed evidence.

## Required acceptance evidence

A PASS requires all of the following:

1. `BASE44_STAGING_RUNTIME_REACHABLE`
2. `REAL_LOGIN_FLOW_COMPLETES`
3. `BASE44_AUTH_ME_RETURNS_REGISTERED_USER`
4. `PROTECTED_CONTROL_PLANE_RENDERS_WITHOUT_TEST_SEAM`
5. `REGISTRY_V2_BINDING_MATCHES_GOVERNED_COMMIT_BLOB_SHA256`
6. `REGISTRY_REMAINS_NON_LIVE_READ_ONLY`
7. `NO_BASE44_ROLE_PROMOTION_TO_AIRENOS_AUTHORITY`
8. `NO_CONSOLE_OR_PAGE_ERRORS_MATERIAL_TO_TARGET_FLOW`
9. `POST_ACTION_REMOTE_READ_BACK_PASS`
10. `FINAL_RULE_DOC_21_RECONCILIATION_PASS`

Missing evidence fails closed.

## Terminal classifications

- Contract implemented only: `IMPLEMENTED_GOVERNED_NOT_EXECUTED`
- Runtime acceptance PASS: `CLOSED_VERIFIED_REAL_AUTH_PASS`
- Evidence unavailable without target failure: `EVIDENCE_BLOCKED_NOT_FAILED`
- Target runtime acceptance failure: `FAILED_TARGET_RUNTIME_ACCEPTANCE`

## Non-implication

Even `CLOSED_VERIFIED_REAL_AUTH_PASS` would **not** by itself certify Release 0, authorize production, activate Session Authority, issue an AIRenOS bearer, or authorize K5.

## Current execution state

At creation of this contract:

- AOS-NOVA Base44 source commit remains `da52777072cb25fc533eff2685d794b24a7bdb8b`.
- Registry v2 consumer SHA-256 remains `c3f7590c83cb45056a6ce70c4a54cecaaf45ce40883949c11a0474b85dca6793`.
- Standard Base44 runtime still reports `403 / not_deployed`.
- No staging runtime has been enabled under this contract.
- No authenticated runtime acceptance has been executed under this contract.

**END AOS-NOVA-BASE44-STAGING-AUTH-001 v0.1**
