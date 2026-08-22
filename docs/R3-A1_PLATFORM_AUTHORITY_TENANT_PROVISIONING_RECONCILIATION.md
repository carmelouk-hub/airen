# R3-A1 — Platform Authority & Tenant Provisioning Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE

## 1. Scope

R3-A1 is the first controlled slice of R3-A Tenant Lifecycle. It establishes a real platform-authority path for creating a Tenant before any Tenant scope exists.

This slice does not close R3-A as a whole. Tenant update, suspend, reactivate, archive and query/list/detail remain subsequent R3-A work.

## 2. Authority model proved

AuthenticatedPrincipal
→ PlatformSecurityContext
→ `platform.tenants.provision`
→ PostgresTenantProvisioningUnitOfWork
→ `airen_control_plane` NOLOGIN invocation role
→ `security.platform_provision_tenant(...)`
→ `airen_control_plane_owner` NOLOGIN SECURITY DEFINER owner
→ narrow table privileges
→ Tenant + Primary Location + Initial TenantMembership + AuditEvent + OutboxEvent + Idempotency

No fake `tenantId` or `locationId` is introduced into PlatformSecurityContext.

The ordinary `airen_app` role cannot execute the platform provisioning capability.

The `airen_control_plane` invocation role cannot directly insert Tenant rows.

The PostgreSQL capability independently rechecks the actor's active platform role grant for `platform.tenants.provision`, so possession of the invocation role alone is insufficient.

## 3. Transaction and idempotency contract

The provisioning transaction creates, atomically:

1. Tenant
2. Primary Location
3. Initial active owner TenantMembership for the authenticated platform actor
4. AuditEvent
5. OutboxEvent
6. Completed idempotency record

An identical retry returns the original provisioning result and creates no duplicate Tenant, AuditEvent or OutboxEvent.

Reuse of the same idempotency key with a different normalized payload fails with `IDEMPOTENCY_CONFLICT`.

A forced failure during membership creation rolls back Tenant, Location, idempotency state, Audit and Outbox effects.

## 4. Runtime evidence

Foundation base commit:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

Exact implementation commit:
`4c89f079262b7c05282f865d7f2d7fb0583ecc26`

GitHub Actions:
`foundation-contract-ci` run #281
Run ID `32585121645`
Conclusion: SUCCESS

Jobs:

* application-contracts — PASS
* postgres-rls-runtime — PASS
* deployment-path-runtime — PASS

The PostgreSQL runtime job proves the new R3-A provisioning tests in addition to the pre-existing RLS, governed command and authenticated principal regression suites.

## 5. Failure reconciliation

The first runtime attempt, run #279 / ID `32585052718`, failed in the new provisioning test.

Cause: the NOLOGIN capability owner had INSERT permission on `authz.tenant_memberships`, but PostgreSQL also requires SELECT privilege for `INSERT ... RETURNING id`.

Correction: grant `SELECT, INSERT` only to `airen_control_plane_owner` on `authz.tenant_memberships`.

No permission was added to `airen_control_plane` or `airen_app`. No RLS policy was weakened. No security assertion was removed.

The full CI was rerun from the corrected exact commit and passed.

## 6. Regression and protection result

PASS:

* no Base44 runtime coupling introduced
* Foundation runtime contracts remain green
* Foundation RLS remains green
* authenticated principal runtime remains green
* deployment path remains green
* normal application role remains unable to invoke platform provisioning
* platform invocation role remains unable to mutate Tenant tables directly
* tenant-only actor remains unable to provision a Tenant
* partial failure remains atomic

## 7. External non-gating status

A Vercel commit status reported failure because the linked Vercel account deployment is blocked. This is not a GitHub Actions R3-A1 runtime test and does not constitute R3-A1 runtime evidence. It remains visible and is not being represented as PASS.

## 8. Governance conclusion

R3-A1 implementation evidence is sufficient to create a closure candidate.

R3-A1 must not be marked CLOSED until the reconciliation/machine-evidence closure commit itself receives exact-commit CI PASS and the required immutable 04.3 snapshot, integrity manifest and Bible/DOC-000 updates are completed.

R3-A overall remains OPEN after R3-A1 because the remaining Tenant lifecycle operations are not yet implemented.
