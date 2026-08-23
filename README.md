# AIRenOS — Governed Control Plane Rebuild

AIRenOS is the provider-neutral, multi-tenant Control Plane being rebuilt outside Base44 under the AIRenOS Platform Bible, machine specifications, forensic evidence, CI gates and controlled Git history.

> **Canonical working branch:** `r3/control-plane-20260822`  
> **Governance PR:** [#4 — R3 Control Plane](https://github.com/carmelouk-hub/airen/pull/4)  
> **Default branch `main`: intentionally unchanged during controlled R3 work.**

## Current canonical status

| Gate | Scope | State |
| --- | --- | --- |
| R3-A | Tenant Lifecycle | CLOSED / PASS |
| R3-B | Location Lifecycle | CLOSED / PASS |
| R3-C | TenantDomain Registry Lifecycle | CLOSED / PASS |
| R3-D | Platform Principal & Role Administration | CLOSED / PASS |
| R3-E | Plan & Subscription Lifecycle | CLOSED / PASS |
| R3-F | Entitlement Administration & Effective Resolution | CLOSED / PASS |
| R3-G | Feature & Capability Resolution | CLOSED / PASS |
| R3-H | Platform Audit Query Surface | CLOSED / PASS |
| R3-I | Admin API & Admin UI Surfaces | DESIGN FROZEN / READY FOR CONTROLLED IMPLEMENTATION / NOT PASS / NOT CLOSED |

R3-H is closed on commit `fa16b2d4329e1a3971fd96fd1311a9c99b706889` with exact closure CI PASS.

R3-I has completed its RULE-DOC-15 implementation file census. The reconciled candidate surface is **11 artifacts: 7 CREATED / 4 MODIFIED**. The census found **0 new Platform permissions, 0 new Tenant permissions, 0 new database authority, 0 required database migrations and 0 new frontend-framework dependencies**.

This README synchronization is documentation-only. It does **not** mark R3-I product implementation as started and does not claim PASS or CLOSED/PASS.

## Canonical architecture

```text
AIRenOS
  ↓
Vertical
  ↓
Tenant
  ↓
Location
  ↓
Operational workflows
```

Core authority rules:

- `Tenant.slug` remains the stable logical SaaS identity.
- Hostname resolution is designed as `hostname → TenantDomain / CustomDomainRegistry → tenant_id → optional location_id`.
- Authority is separated across **CORE / APP / AI**.
- AI does not write directly to CORE.
- Tenant and Location authority are resolved server-side; client-supplied scope is not authoritative.
- Platform roles are separate from Tenant roles.
- PostgreSQL/RLS and independent permission checks remain defense-in-depth.
- Admin UI is never authority.

## R3-I frozen boundary

R3-I is an authenticated HTTP/API + Admin UI **composition layer** over the already-certified R3-A through R3-H authorities.

Frozen contract:

- API prefix: `/api/admin/v1`
- 12 Admin API route families
- 8 top-level Admin UI surfaces
- 20 design invariants
- 30 mandatory tests
- no Platform `createLocation` shortcut
- no raw SQL or direct database-policy logic in route handlers
- safe existing projections must be reused
- browser/client state cannot grant roles, permissions, Tenant/Location scope, entitlement or feature authority

The initial Admin UI implementation is intentionally framework-light: the census does not require React, Next.js, Vite or another frontend framework.

## Repository map

- `apps/api` — provider-neutral HTTP runtime, authentication/security-context composition and Admin API delivery boundary
- `apps/admin` — Admin UI surface
- `packages/*` — certified domain/application authorities and adapters
- `packages/persistence-postgres` — PostgreSQL persistence adapters
- `db/migrations` — governed database migrations
- `tests/integration` — application/API/UI contract tests
- `tests/postgres` — PostgreSQL/RLS/runtime authority tests
- `scripts` — static guardrails, migration/runtime verification and evidence tooling
- `machine-context` — machine-readable certification evidence
- `docs` — repository-side reconciliation and closure documentation

## How to verify the live state

- [Current R3 code](https://github.com/carmelouk-hub/airen/tree/r3/control-plane-20260822)
- [R3 commit history](https://github.com/carmelouk-hub/airen/commits/r3/control-plane-20260822)
- [Governance PR #4](https://github.com/carmelouk-hub/airen/pull/4)
- [GitHub Actions / CI](https://github.com/carmelouk-hub/airen/actions)
- [Exact R3-H closure commit](https://github.com/carmelouk-hub/airen/commit/fa16b2d4329e1a3971fd96fd1311a9c99b706889)

## Production boundaries

R3 work remains controlled and non-destructive:

- `main` is not advanced merely because an R3 milestone closes.
- Corte delle Stelle production is unchanged by this branch.
- R3-J integrated certification is not started.
- T20 final certification is not authorized here.
- Golden Restaurant E2E is a later gate.
- Corte migration/cutover is a later gate.
- Base44 decommission is a later gate.

## Next controlled action

After this documentation synchronization, the R3-I candidate manifest must be rebased/read against the new documentation-only HEAD. Only after that read-back and a final concurrency check may the controlled R3-I product implementation be published.

**No premature PASS. No silent authority widening. Port the semantics, not the platform.**
