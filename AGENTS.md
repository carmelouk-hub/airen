# AGENTS.md — AIRenOS Foundation

## Authority hierarchy
1. AIRenOS Platform Bible active canonical documents.
2. B44-FX forensic evidence.
3. B44-FX-004 portable boundary mapping.
4. B44-FX-005 accepted ADRs.
5. T20 and Golden E2E contracts.
6. Accepted/tested target code.
7. Coding-agent proposals.

## Forbidden shortcuts
- No Base44 SDK/entity/auth/service-role dependency in Foundation core.
- No tenant_id accepted as authority from client input.
- No tenant admin treated as platform admin.
- No unknown-host fallback to a default tenant.
- No direct STELLA DB writes.
- No provider secret in Git, operational DB rows, logs, fixtures, or prompts.
- No production data used as synthetic fixtures.
- No provider SDK imported by domain packages.
- No schema change without a versioned migration.
- No security bypass to make E2E pass.
- No AIRenOS NEXT promotion without explicit governance.

## Required mutation pipeline
Validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement (if applicable)
-> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result.

## Required evidence
Every milestone produces code, tests, schema/migration changes, evidence, parity status, gap status and ADR impact.

## Base44 implementation synchronization gate
For every Base44 implementation or review-surface change, ask and answer the same questions before completion:
1. Is the change authorized for its exact design, sandbox, staging or runtime scope?
2. Is the intended implementation complete and verified locally?
3. Is the exact local state committed and pushed to GitHub with a recorded commit SHA?
4. Has the correct Base44 app received the same in-scope files, including prior unsynchronized changes discovered during the milestone?
5. Do remote file evidence or hashes prove parity with the committed local state?
6. Do the required tests and optimized build pass both locally and in the Base44 sandbox?
7. Does the Base44 preview show the intended interface without browser or console errors?
8. Were any entity, function, agent, connector, auth setting, secret or production deployment added, changed or intentionally left unchanged?
9. Is a Base44 checkpoint recorded, and are all parity gaps, governance boundaries and publication states documented?

GitHub publication is not evidence of Base44 synchronization. Sandbox synchronization is not production publication. A milestone remains incomplete while any required answer is unknown or contradicted.
