# R3-C — TenantDomain Registry Lifecycle Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE

## 1. Scope governed by R3-CP-001 / R3-C-001

R3-C closes the TenantDomain registry lifecycle gap while preserving the certified Foundation hostname resolver semantics.

Certified implementation scope:

- governed custom-domain registration
- hostname normalization and global collision protection
- trusted `*.ristoairen.com` namespace protection against custom-domain shadowing
- verification attempt start, verified result, failed result and governed retry
- activation only after verified ownership evidence state
- disable and verified reactivation
- same-Tenant Location bind/rebind/detach
- active effective Location requirement for active domains
- platform detail/list query surface with mandatory Tenant filter for list
- lifecycle transition history
- request-hash idempotency
- AuditEvent and OutboxEvent for governed mutations
- forced-partial-failure rollback
- independent PostgreSQL platform permission recheck
- direct `airen_app` TenantDomain DML revocation
- narrow public route capabilities executed as `airen_app` with no Tenant/Location context
- custom-domain and trusted-subdomain resolution remain fail-closed

## 2. Identity and authority boundary

`Tenant.slug` remains the stable logical SaaS identity. `TenantDomain` is a replaceable routing/context binding and does not become an authorization boundary.

Immutable normal-lifecycle fields:

- TenantDomain id
- `tenant_id`
- `hostname`
- `created_at`

Location binding may change only through the governed `platform.domains.bind_location` capability. Tenant ownership never changes through a normal R3-C mutation.

Platform permissions:

- `platform.domains.read`
- `platform.domains.register`
- `platform.domains.verify`
- `platform.domains.activate`
- `platform.domains.disable`
- `platform.domains.bind_location`

The application-level path is:

AuthenticatedPrincipal → PlatformSecurityContext → explicit `platform.domains.*` permission → application command/query → `airen_control_plane` NOLOGIN role → narrow `security.*` capability → independent DB permission recheck → `airen_control_plane_owner` capability owner.

`tenant_admin` never implies Domain Registry platform authority.

## 3. R3-C authority cutover

Foundation migration 0005 historically granted tenant-scoped DML on `platform.tenant_domains` to `airen_app`. R3-C reconciles that primitive with Control Plane ownership by revoking `INSERT`, `UPDATE` and `DELETE` from `airen_app`.

RLS remains enabled and forced as defense-in-depth. Normal application code may not mutate TenantDomain rows directly after migration 0009.

`airen_control_plane` also receives no direct table mutation grants. Mutation is only through the R3-C security-definer capabilities.

## 4. Lifecycle and verification state

Domain status vocabulary remains schema-compatible:

- `pending`
- `verified`
- `active`
- `disabled`
- `error`

Verification state is explicitly constrained to:

- `unverified`
- `pending`
- `verified`
- `failed`

Governed flow:

register → pending/unverified
→ start verification → pending/pending
→ verification pass → verified/verified
→ activate → active/verified
→ disable → disabled/verified
→ activate → active/verified when Tenant/effective Location are valid.

Failed path:

pending/pending → verification failure → error/failed
→ governed retry → pending/pending.

A failed verification cannot silently become active and cannot re-enter verification through the initial-start action.

R3-C records a verification evidence reference for pass/fail transitions. This proves the server-side contract; R3-C does not claim a production DNS provider integration.

## 5. Hostname and namespace rules

Registration normalizes hostname to lower-case exact host form and rejects invalid syntax.

The canonical trusted RISTOAIREN namespace remains derived from immutable Tenant slug:

`slug.ristoairen.com`

R3-C custom-domain registration rejects `ristoairen.com` and any `*.ristoairen.com` hostname. Therefore a custom-domain row cannot shadow the trusted platform namespace.

Global hostname uniqueness continues to be enforced by the existing case-insensitive unique index.

Unknown hostnames remain fail-closed. There is no default Tenant fallback.

## 6. Safe Location binding

A TenantDomain may bind to one Location of its own Tenant or remain unbound and resolve through that Tenant's active primary Location.

Rules proved:

- foreign-Tenant Location binding denied
- bound target must be active
- active domain detach is allowed only when an active primary Location is available
- active domain resolution requires active Tenant and active effective Location
- Location rebind/detach does not change `tenant_id` or hostname

## 7. Public pre-context resolver

Hostname resolution occurs before private Tenant authority exists. R3-C therefore adds narrow read-only public route capabilities:

- `security.resolve_active_tenant_domain_route(text)`
- `security.resolve_active_tenant_slug_route(text)`

They execute as `airen_app`, with Tenant/Location request context cleared, and return only an already-active public route projection: Tenant identity, effective Location identity and, for custom hosts, TenantDomain identity.

They do not return private operational data and do not grant authorization. The application resolver still decides whether the hostname belongs to the trusted platform namespace before custom-domain lookup.

## 8. Idempotency, audit and atomicity

`platform.tenant_domain_lifecycle_idempotency` protects register and lifecycle mutations with request hashes.

Identical retry replays the stored result without duplicate effects. Changed-payload reuse is rejected.

`platform.tenant_domain_transitions` records status, verification state and Location-binding changes with actor, correlation id, reason and optional verification evidence reference.

Every governed mutation writes AuditEvent and OutboxEvent in the same transaction.

A forced AuditEvent failure during disable proves that Domain state, transition history, idempotency and Outbox effects roll back together.

## 9. Query surface

R3-C introduces:

- `security.platform_get_tenant_domain(uuid)`
- `security.platform_list_tenant_domains(tenant_id,status,after,limit)`

Both independently recheck `platform.domains.read` in PostgreSQL.

List is explicitly Tenant-filtered, limit-bounded to 1..100 and uses deterministic UUID cursor ordering. Raw unrestricted table projection is not exposed.

## 10. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-B closure baseline:
`c40d42dbdec58c3401d231744cc5bcf5e08e6ff3`

R3-C implementation PASS commit:
`dcb7982852eb1fac1cc8dbe05ddbb1a3b77ba146`

Git tree:
`78e198b3975bf115a54b1190329b7ffde1b6ec8a`

GitHub Actions:
`foundation-contract-ci` run #336
Run ID `32589576068`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9479945318`
Digest `sha256:d02fd7db9a671fa524a1984eacf45fbf82599d6e25b7f3b1bbf18d4599dd8dcf`

The implementation passed its first complete CI run; no implementation failure reconciliation is required for run #336.

## 11. Runtime assertions proved

PASS:

- migration 0009 applies after R3-B
- prior Foundation/R3-A/R3-B regressions remain PASS
- authorized domain registration
- hostname normalization
- registration identical retry replay without duplicate audit
- changed-payload idempotency reuse denied
- trusted `*.ristoairen.com` custom registration denied
- cross-Tenant hostname collision denied
- verification start/pass lifecycle
- activation requires verified state
- custom domain resolves active Tenant/effective Location
- trusted slug subdomain resolves through narrow public route capability
- unknown host fails closed
- platform detail/list query authorized
- same-Tenant active Location rebind
- cross-Tenant Location rebind denied
- detach returns active domain to primary Location resolution
- verification failure produces error/failed
- invalid verification restart denied
- governed verification retry returns pending/pending
- forced audit failure rolls back state/idempotency/history/outbox
- disabled domain stops public resolution
- verified disabled domain can reactivate
- suspended Tenant stops public custom-domain resolution
- tenant-only actor denied platform Domain read/register
- DB platform permission recheck denies unprivileged actor
- direct `airen_app` UPDATE denied
- direct `airen_app` INSERT denied
- `airen_app` cannot execute platform mutation capability
- lifecycle history, AuditEvent and OutboxEvent recorded
- deployment path regression remains PASS

## 12. Boundary reconciliation

R3-C does not implement or certify:

- production DNS provider integration
- automated DNS record creation
- SSL certificate lifecycle/provider
- R3-D platform principal/role administration
- R3-E Subscription
- R3-F Entitlement administration
- R3-G Feature/Capability resolution
- R3-H Platform Audit query
- R3-I Admin API/UI
- R3-J integrated certification
- Corte custom-domain migration/cutover
- T20 or Golden Restaurant E2E
- Base44 decommission

No production domain, Corte production configuration or `main` branch is modified.

## 13. Governance conclusion

Implementation evidence is sufficient to create the R3-C closure candidate.

R3-C must not be marked CLOSED until this reconciliation and machine-evidence closure commit receives exact-commit CI PASS, followed by the canonical 04.3 source snapshot, SHA-256 manifest/integrity record, Master Book, DOC-000, final machine evidence and PR governance promotion.
