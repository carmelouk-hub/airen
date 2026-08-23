# R3-H — PLATFORM AUDIT QUERY SURFACE RECONCILIATION

Date: 2026-08-23
Milestone: R3-H
State: CLOSURE CANDIDATE / EXACT CI PENDING / NOT CLOSED

## Certified baseline
- Parent closure: R3-G `d4dfb71b4925529e0fbb320451982505b0ceb71d`.
- Parent closure tree: `66dbefa8eae9c34cbd3251763492e86cabed9467`.
- R3-H implementation PASS commit: `3a6819fe133c9ba653c7aeff3d29ed083035fc4c`.
- R3-H implementation PASS tree: `e74c2b9ca8e9e2c6e00c53e8d4f83994918ae77a`.
- Implementation PASS CI: foundation-contract-ci #407 / run `32641742153` — SUCCESS.
- Deployment artifact: `9493785516`, digest `sha256:d97ef99ec60460bf194dcb8d47ac4223604b85cce74835ad5d95637361b04271`.

## Design authorities
- Human: R3-H-001, Drive `11HJcrM9-2bH9riGb65IYw6c6hd4QrdW5ZgQsuRfW2jk`.
- Machine: MRS-008, Drive `1rVKejVktQh6VyLm7gohIm1QEfxF62pEfXlbW4ivzMdw`.
- Frozen counts: 1 Platform permission, 0 lifecycle transitions, 13 query input fields, 18 invariants, 26 mandatory tests.

## Reconciled implementation
R3-H adds a bounded, platform-scoped, read-only query capability over the pre-existing `audit.audit_events` evidence authority. It does not create a second Audit table. The package owner remains `packages/audit-events`, with PostgreSQL persistence isolated in `packages/persistence-postgres`.

The sole new Platform permission is `platform.audit.read`, seeded by default only for `platform_admin`. Application permission checks are not sufficient by themselves: the narrow `security.platform_query_audit_events(...)` SECURITY DEFINER capability independently rechecks the active Platform role-to-permission grant in PostgreSQL. The invocation role `airen_control_plane` receives EXECUTE on the narrow function but retains no direct SELECT authority on `audit.audit_events`.

Tenant and Location values are filters, not caller authority. A Location filter requires Tenant and PostgreSQL validates Location ownership against that Tenant. Platform-global rows with `tenant_id IS NULL` remain queryable only through Platform authority.

The time contract is mandatory `[createdFrom, createdUntil)`, maximum 31 days. Pagination is keyset-only over `created_at DESC, id DESC`; OFFSET is forbidden. Cursors are opaque and bound to the same normalized filters/window. Limit defaults to 50 and is constrained to 1..100.

Projection excludes identity email/display/provider joins. Metadata is recursively sanitized for credential/token/payment-secret key patterns. Sanitized metadata over 8192 bytes is replaced with the deterministic redaction object rather than truncated. Query execution is side-effect free and exposes no Audit UPDATE/DELETE path.

## Forensic correction history
Two failed implementation runs are intentionally retained:
- CI #403 / run `32641067153` — application/deployment SUCCESS, PostgreSQL job failed at R3H-T01.
- CI #405 / run `32641381285` — application/deployment SUCCESS, Foundation and R3-A..G regressions SUCCESS, R3H-T01 still failed.

The first diagnosis attributed T01 to FORCE RLS interaction and produced additive migration 0028. Subsequent inspection proved Foundation had already defined `airen_control_plane_owner` as BYPASSRLS. That diagnosis was superseded, not hidden. The real defect was proof nondeterminism: T01 used a broad window with the default 50-row page and searched for `r3h.alpha`; earlier regression suites could create enough newer Audit rows to evict the seeded proof row from that page.

The final reconciliation keeps database authority unchanged, makes T01 deterministically filter its seeded `actionKey=r3h.alpha`, and uses additive migration 0029 to remove only the two redundant R3-H policies introduced by 0028. No Foundation policy is rewritten and repository history remains immutable.

## Runtime evidence reconciliation
CI #407 verified:
- application-contracts = SUCCESS;
- postgres-rls-runtime = SUCCESS;
- deployment-path-runtime = SUCCESS;
- explicit R3H-T01..R3H-T26 PostgreSQL runtime matrix = SUCCESS;
- Foundation and R3-A through R3-G regression suites = SUCCESS;
- migrations 0027, 0028 historical correction, and 0029 reconciliation apply successfully;
- deployment readiness, degraded detection and rollback = SUCCESS.

Final runtime-test source blob is `ad8c5ffe68d661c44356929f9014a883a9c7dc32`, file SHA-256 `129cf7e97b406388bb8172a14de48159915628c19a8e03f2bfb7428cafa9dfea`.

## Authority boundaries retained
- Existing `audit.audit_events` remains the single Audit evidence authority.
- `airen_control_plane` remains without direct Audit SELECT and without Audit mutation authority.
- `platform.audit.read` is independently rechecked in PostgreSQL.
- Tenant/Location filters do not establish authority.
- Tenant roles do not imply Platform Audit authority.
- No identity/PII joins are added to the safe projection.
- No metadata filter semantics are introduced.
- Query execution does not mutate Audit, Outbox, Subscription, Entitlement, Capability or role state.
- No Corte delle Stelle or RISTOAIREN Platform hardcoding is introduced.

## Out of scope remains unchanged
No Admin API/UI, retention, export, SIEM, security_auditor role, T20, Golden Restaurant E2E, Corte production cutover, Base44 decommission or R3-I implementation is certified by R3-H.

## Closure candidate decision
R3-H implementation evidence is reconciled with R3-H-001 and MRS-008. No unresolved authority or security gap is identified by CI #407. The milestone may advance to this closure-only commit and exact CI. It MUST NOT be marked CLOSED/PASS until exact closure CI, 04.3 archive/integrity, 04.1 final machine evidence, canonical Drive promotion and terminal PR governance update are complete.
