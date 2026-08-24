# R3-A — Tenant Lifecycle Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE

## 1. Scope governed by R3-CP-001

R3-A closes the Control Plane Tenant lifecycle gap defined by the frozen R3-CP-001 sequence:

- platform-authority bootstrap before Tenant scope exists
- idempotent Tenant creation
- Primary Location bootstrap
- initial active owner TenantMembership bootstrap
- Tenant metadata update
- Tenant suspend
- Tenant reactivate
- Tenant archive
- Tenant detail query
- Tenant list query
- AuditEvent and OutboxEvent for governed mutation paths
- explicit lifecycle transition evidence
- server-side platform permission enforcement

R3-A is a Control Plane lifecycle milestone. It does not move platform authority into RISTOAIREN and does not make Admin UI authoritative.

## 2. Authority boundary

The certified R3-A authority model remains:

AuthenticatedPrincipal
→ PlatformSecurityContext
→ explicit platform permission
→ governed application command/query
→ `airen_control_plane` NOLOGIN invocation role
→ narrow `security.*` PostgreSQL capability
→ independent DB permission recheck
→ `airen_control_plane_owner` NOLOGIN capability owner
→ limited table grants

`PlatformSecurityContext` contains no fabricated tenantId or locationId.

`tenant_admin` does not imply platform authority. Runtime evidence creates an actor with active `tenant_admin` membership and no platform role, then proves platform Tenant read/update are denied.

The normal `airen_app` role cannot execute platform lifecycle mutation capability. The `airen_control_plane` invocation role cannot mutate `platform.tenants` directly.

## 3. Tenant identity and mutable fields

`Tenant.slug` remains stable SaaS identity and is not mutable through R3-A lifecycle commands.

R3-A metadata update is limited to:

- name
- locale
- timezone
- currency

R3-A does not expose mutation of Tenant id, slug, Organization ownership, Product/Vertical binding, platform roles or subscription state.

## 4. State machine

Frozen runtime vocabulary for R3-A:

- `active`
- `suspended`
- `archived`

Allowed governed state transitions:

- active → suspended
- suspended → active
- active → archived
- suspended → archived

`archived` is terminal in R3-A. Reactivation from archived is denied.

Suspension and archive require a governed reason code. Every status change produces a `platform.tenant_state_transitions` record plus AuditEvent and OutboxEvent.

No hard delete is implemented. Suspension/archive preserve Tenant row, Locations and TenantMemberships.

Because hostname resolution already accepts only active Tenant and active primary Location, a suspended or archived Tenant fails closed on operational hostname resolution.

## 5. Idempotency and atomicity

Provisioning uses request-hash idempotency established in R3-A1.

Lifecycle mutations use a separate request-hash idempotency registry. Identical retry returns the prior result without duplicate Audit/Outbox. Reuse of the same key with a different payload fails with `IDEMPOTENCY_CONFLICT`.

A forced AuditEvent failure proves that a lifecycle update rolls back the Tenant mutation, idempotency state and Outbox effects atomically.

## 6. Query surface

R3-A introduces explicit safe platform query capabilities:

- `security.platform_get_tenant(uuid)`
- `security.platform_list_tenants(status, after, limit)`

Both independently require active `platform.tenants.read` authority. List pagination is bounded to 100 rows. These are controlled projections, not direct table access for the application role.

## 7. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-A1 closure baseline:
`bf274805f2e6b0b3bfed4be40f9c03d57725ee64`

Full R3-A implementation PASS commit:
`5be6e25a994fae39166aeff098017b7d9785fd15`

Git tree:
`b031fd8c45a3cd7f1f39d12b575df662d84cf8d9`

GitHub Actions:
`foundation-contract-ci` run #290
Run ID `32586151703`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9479093663`
Digest `sha256:27bef8757998f1cf9c25e0a68db77e143abf27635a69b5fa681d35ac9792ddff`

## 8. Runtime assertions proved

PASS:

- create Tenant idempotently
- create Primary Location
- create initial active owner TenantMembership
- update mutable Tenant metadata
- preserve Tenant.slug
- changed-payload idempotency conflict denied
- suspend active Tenant
- suspended hostname resolution fails closed
- suspension preserves Locations and Memberships
- reactivate suspended Tenant
- active hostname resolution resumes
- forced lifecycle partial failure rolls back all effects
- archive active Tenant without hard delete
- archive preserves Locations and Memberships
- archived reactivation denied
- lifecycle transition history recorded
- detail query authorized
- filtered list query authorized
- tenant_admin without platform role denied platform read/update
- direct airen_control_plane Tenant UPDATE denied
- airen_app platform mutation capability invocation denied
- Foundation RLS regression suite PASS
- governed command regression suite PASS
- authenticated principal regression suite PASS
- R3-A1 provisioning regression suite PASS
- deployment path regression suite PASS
- Base44 runtime coupling boundary PASS

## 9. Failure reconciliation

### Failure 1 — run #286 / ID 32586016966

The first full R3-A runtime attempt failed before exercising the lifecycle because Node 22 `--experimental-strip-types` does not support TypeScript parameter properties used in the new PostgreSQL adapter.

Correction commit:
`9d0f20dc5b4273b11d2227c7159899951886f3c8`

Correction: replaced constructor parameter properties with explicit class fields/assignments. No authority, SQL policy or lifecycle rule changed.

### Failure 2 — run #288 / ID 32586083040

The lifecycle reached PostgreSQL and exercised the state machine. The final privilege-boundary test attempted two expected failures in one PostgreSQL transaction. After the first expected permission error PostgreSQL correctly marked the transaction aborted, so the second assertion received SQLSTATE `25P02` rather than the expected `42501`.

Correction commit:
`5be6e25a994fae39166aeff098017b7d9785fd15`

Correction: each expected privilege denial now runs in its own transaction. No product code, grant, RLS policy or security assertion was weakened.

Full rerun #290 PASS.

## 10. DOC-004 boundary reconciliation

DOC-004 is currently ACTIVE DRAFT and describes a broader future provisioning/deprovisioning saga, including Subscription/Entitlement/readiness revalidation and future retention/export/purge behavior.

R3-A certifies the Tenant lifecycle gap frozen by R3-CP-001 against the current G4/R3 runtime vocabulary. It does **not** claim that all future DOC-004 provisioning-saga acceptance tests are complete.

Specifically:

- subscription lifecycle remains R3-E
- entitlement administration remains R3-F
- capability resolution remains R3-G
- integrated readiness/cross-domain certification remains R3-J
- archive is a non-destructive terminal Tenant lifecycle state, not implementation of future data purge/retention workflows

These are explicit cross-gate dependencies, not R3-A failures.

## 11. Governance conclusion

The implementation evidence is sufficient to create an R3-A closure candidate.

R3-A must not be marked CLOSED until this reconciliation/machine-evidence commit itself receives exact-commit CI PASS, followed by 04.3 exact source snapshot, SHA-256/integrity manifest, Bible, DOC-000, final machine evidence and PR governance reconciliation.

R3-B must remain unopened until that chain is complete.
