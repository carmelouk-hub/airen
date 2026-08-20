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
