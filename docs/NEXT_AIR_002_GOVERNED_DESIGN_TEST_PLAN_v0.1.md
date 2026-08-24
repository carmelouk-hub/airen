# NEXT-AIR-002 — Governed Design Test Plan v0.1

**Artifact class:** `SYNTHETIC_CONTRACT_TEST_SPECIFICATION`

**Executable runtime tests:** `NOT_AUTHORIZED`

**Production data:** `FORBIDDEN`

## Test-fixture rules

- every subject, Tenant, Location, claim, event and document is synthetic;
- fixtures cannot be copied, transformed or sampled from production data;
- no provider secret, token, email, phone number or real business record is allowed;
- expected results are typed and fail closed;
- tests must prove negative isolation and prohibited behavior, not only successful paths.

## Contract test catalog

| ID | Contract proof | Expected result | Status |
|---|---|---|---|
| RI-GD-001 | observation references a certified producer and event version | accepted for design validation | `SPECIFIED` |
| RI-GD-002 | duplicate `event_id` arrives | one idempotent outcome, no duplicate claim evidence | `SPECIFIED` |
| RI-GD-003 | client changes Tenant input | trusted scope prevails or typed denial | `SPECIFIED` |
| RI-GD-004 | host does not map to an allowed Tenant | typed denial; no default Tenant | `SPECIFIED` |
| RI-GD-005 | actor lacks permission | `DENY_PERMISSION` | `SPECIFIED` |
| RI-GD-006 | module entitlement is absent | `DENY_ENTITLEMENT` | `SPECIFIED` |
| RI-GD-007 | purpose is absent, expired or unknown | `DENY_PURPOSE` | `SPECIFIED` |
| RI-GD-008 | lawful-basis record is absent | `DENY_LAWFUL_BASIS` | `SPECIFIED` |
| RI-GD-009 | requested field is outside purpose contract | field omitted and denial audited | `SPECIFIED` |
| RI-GD-010 | AI produces a high-confidence claim | state remains `PROPOSED` | `SPECIFIED` |
| RI-GD-011 | independent authorized confirmation is present | confirmed transition retains evidence | `SPECIFIED` |
| RI-GD-012 | correction supersedes a claim | history preserved and active projection rebuilt | `SPECIFIED` |
| RI-GD-013 | claim expires | excluded from active Twin projection | `SPECIFIED` |
| RI-GD-014 | claim is contested | adverse automated action blocked | `SPECIFIED` |
| RI-GD-015 | purpose version changes | caches and cursors invalidate | `SPECIFIED` |
| RI-GD-016 | authorization is revoked | future covered uses fail closed | `SPECIFIED` |
| RI-GD-017 | customer data is requested from another Tenant | zero data returned and denial audited | `SPECIFIED` |
| RI-GD-018 | supplier observation is pooled across Tenants | operation denied | `SPECIFIED` |
| RI-GD-019 | behavior is used to infer a protected trait | claim creation blocked and policy event recorded | `SPECIFIED` |
| RI-GD-020 | opaque score attempts customer or supplier exclusion | action proposal rejected | `SPECIFIED` |
| RI-GD-021 | STELLA attempts a direct relationship write | operation unavailable or denied | `SPECIFIED` |
| RI-GD-022 | action proposal bypasses application service | execution denied | `SPECIFIED` |
| RI-GD-023 | significant decision has no human approval | execution denied | `SPECIFIED` |
| RI-GD-024 | log or prompt includes a forbidden field | redaction or request rejection verified | `SPECIFIED` |
| RI-GD-025 | export requested without dual authorization | export denied | `SPECIFIED` |
| RI-GD-026 | deletion collides with legal hold | typed outcome preserves hold and explains scope | `SPECIFIED` |
| RI-GD-027 | recipient uses a revoked Passport claim | future use denied and reconciliation triggered | `BLOCKED_FEATURE` |
| RI-GD-028 | model or rule version changes | new evaluation required; old claims remain attributable | `SPECIFIED` |
| RI-GD-029 | same request is retried after timeout | deterministic idempotent result | `SPECIFIED` |
| RI-GD-030 | audit or outbox persistence fails | transaction fails closed; no partial mutation | `SPECIFIED` |

## Evidence required per future executable test

- test code and version;
- synthetic fixture provenance;
- typed input and expected result;
- actual result;
- audit and outbox evidence when applicable;
- Tenant/Location isolation evidence;
- parity impact;
- gap status;
- ADR impact.

## Current result

The thirty cases are design specifications, not executed tests. Their current status must not be reported as `PASS` or used to claim runtime readiness.
