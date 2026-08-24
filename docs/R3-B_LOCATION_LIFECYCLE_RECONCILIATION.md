# R3-B — Location Lifecycle Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE

## 1. Scope governed by R3-CP-001

R3-B closes the Control Plane Location lifecycle gap frozen by R3-B-001 while preserving the existing tenant-scoped Location creation path.

Certified R3-B scope:

- mutable Location metadata update (`name`, `timezone` only)
- Location suspend
- Location reactivate
- Location archive without hard delete
- atomic Primary Location transfer within one Tenant
- platform Location detail query
- platform Location list query with mandatory Tenant filter and bounded pagination
- dedicated Location state-transition history
- request-hash lifecycle idempotency
- AuditEvent and OutboxEvent for governed mutations
- independent PostgreSQL platform-permission recheck
- rollback on forced partial failure
- explicit tenant-role / platform-role separation

R3-B does not move Location creation into platform authority. Existing `createLocation` remains tenant-scoped through trusted `SecurityContext`, permission `tenant.locations.manage`, entitlement `tenant.multi_location`, governed UnitOfWork, Audit and Outbox.

## 2. Authority boundary

The certified platform lifecycle path remains:

AuthenticatedPrincipal
→ PlatformSecurityContext
→ explicit `platform.locations.*` permission
→ governed application command/query
→ `airen_control_plane` NOLOGIN invocation role
→ narrow `security.*` PostgreSQL capability
→ independent DB permission recheck
→ `airen_control_plane_owner` NOLOGIN capability owner
→ limited table grants

Platform permissions introduced by R3-B:

- `platform.locations.read`
- `platform.locations.update`
- `platform.locations.suspend`
- `platform.locations.reactivate`
- `platform.locations.archive`
- `platform.locations.transfer_primary`

`tenant_admin` does not imply platform Location authority.

The normal `airen_app` role cannot execute the R3-B platform lifecycle mutation capability. The `airen_control_plane` invocation role cannot update `platform.locations` directly.

## 3. Location identity and mutable fields

R3-B preserves normal lifecycle immutability of:

- Location id
- `tenant_id`
- `slug`
- `created_at`

Metadata update is limited to:

- `name`
- `timezone`

No R3-B lifecycle command accepts client-controlled Tenant rebinding. `tenant_id` and `slug` never appear in an R3-B Location UPDATE SET clause.

## 4. State machine

Current schema-compatible Location vocabulary remains:

- `active`
- `inactive`
- `suspended`
- `archived`

R3-B governed transitions are deliberately limited to:

- active → suspended
- suspended → active
- active → archived
- suspended → archived

`archived` is terminal. Reactivation from archived is denied.

`inactive` remains a legacy/reserved schema-compatible state. R3-B introduces no transition to or from `inactive`.

Suspend/archive require a governed reason code. Every governed state change writes `platform.location_state_transitions` plus AuditEvent and OutboxEvent.

No hard delete is implemented.

## 5. Primary Location invariant

R3-B makes the Primary Location invariant explicit and fail-closed.

For an active Tenant:

- there must not be an implicit lifecycle path that leaves the Tenant without its usable primary Location
- a current primary Location cannot be suspended or archived until primary ownership is transferred first
- source and target of primary transfer must belong to the same Tenant
- source must be the current unique primary Location
- target must be active
- transfer is atomic
- exactly one primary Location remains after transfer
- transfer emits AuditEvent and OutboxEvent
- identical retry replays the stored result without a second transfer or duplicate AuditEvent
- changed-payload idempotency reuse is rejected

The runtime test creates the second synthetic Location through the pre-existing governed tenant-scoped `createLocation` path, then transfers primary authority through the R3-B platform capability.

## 6. Idempotency and atomicity

`platform.location_lifecycle_idempotency` records request hashes for:

- update
- suspend
- reactivate
- archive
- transfer_primary

Identical retry returns the previous result. Reuse of an idempotency key with a changed payload fails closed.

A forced AuditEvent failure during Location suspension proves that Location state, lifecycle idempotency, transition history and Outbox effects roll back together.

Primary-transfer replay is evaluated after source/target existence and same-Tenant scope are established, but before current-primary state invariants are re-applied. This preserves authorization/scope checks while allowing a completed transfer to replay after the source has correctly ceased to be primary.

## 7. Query surface

R3-B introduces safe platform query capabilities:

- `security.platform_get_location(uuid)`
- `security.platform_list_locations(tenant_id, status, after, limit)`

Both independently require active `platform.locations.read` permission.

List requirements:

- explicit Tenant filter is mandatory
- status filter is optional
- limit is bounded to 1..100
- deterministic UUID cursor ordering
- projection is limited to id, tenantId, slug, name, status, timezone, isPrimary, createdAt and updatedAt

This is not unrestricted raw table access.

## 8. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-A closure baseline:
`6ffdc757c6f1b5249bb2ffcef832d7daa179bee5`

R3-B implementation PASS commit:
`d54778b64dec5502c06970f908b8a10bb58705ad`

Git tree:
`55506d4d9c0c9822ec60d0e464749316057a23a5`

GitHub Actions:
`foundation-contract-ci` run #315
Run ID `32588188619`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9479602382`
Digest `sha256:ca1ee9cb22900aded8f101b2a1ded72692fed945739ef3de11a23dfaadc1e955`

## 9. Runtime assertions proved

PASS:

- R3-B migration applies on a clean PostgreSQL runtime after R3-A
- Foundation RLS regression suite remains PASS
- governed command regression suite remains PASS
- authenticated principal regression suite remains PASS
- R3-A provisioning regression remains PASS
- R3-A lifecycle regression remains PASS
- authorized platform Location metadata update
- Location `tenant_id` remains immutable
- Location `slug` remains immutable
- lifecycle changed-payload idempotency conflict denied
- current primary suspend while Tenant active denied before transfer
- second synthetic Location created through existing governed tenant path
- atomic primary transfer succeeds
- exactly one primary remains after transfer
- primary-transfer identical retry replays successfully
- retry emits no duplicate audit record
- cross-Tenant primary transfer denied
- forced AuditEvent failure rolls back state/idempotency/transition/outbox
- former primary can be suspended after transfer
- suspended Location cannot become primary target
- suspended Location can reactivate
- former primary can archive after transfer
- archived Location cannot reactivate
- Location transition history recorded
- platform detail query authorized
- platform Tenant-filtered list query authorized
- tenant_admin without platform role denied platform read/update
- direct `airen_control_plane` Location UPDATE denied
- `airen_app` platform Location mutation capability denied
- deployment path regression remains PASS

## 10. Failure reconciliation

### Run #309 / ID 32587992393 — two independent defects exposed

**Static contract false positive.**

The first R3-B CI attempt used an immutable-field regex whose scan window extended beyond the actual `UPDATE ... SET` clause and misclassified a later `tenant_id` reference as a Location tenant reassignment.

Correction commit:
`b87e930f20cebed7399ad862da63a76553b0e95b`

Correction: static checking now extracts the actual `UPDATE platform.locations SET ... WHERE` clauses and checks immutable fields only inside SET expressions. No SQL authority, grant, RLS policy or lifecycle rule changed.

**PostgreSQL PL/pgSQL ambiguity.**

The same run then reached the R3-B runtime test and exposed SQLSTATE `42702`: unqualified `tenant_id` inside the primary-transfer function conflicted with the RETURNS TABLE output variable of the same name.

Correction commit:
`859d4972b28480305b31a3487e44116c108a8022`

Correction: qualified Location table references with alias `l`. No lifecycle semantics or security boundary changed.

### Run #313 / ID 32588090501 — idempotent transfer replay ordering

The first primary transfer succeeded. Its identical retry then failed because the current-state invariant `source must still be primary` was evaluated before the completed idempotency record was replayed. After a successful transfer, that source is correctly no longer primary.

Correction commit:
`d54778b64dec5502c06970f908b8a10bb58705ad`

Correction: completed idempotency replay is resolved after source/target existence and same-Tenant scope validation, but before fresh-execution current-state invariants. No permission, RLS, Tenant-scope or target-state rule was weakened.

Full rerun #315 PASS.

## 11. DOC-004 and commercial boundary reconciliation

DOC-004 remains ACTIVE DRAFT and describes broader future Location provisioning concepts including Subscription, `locations.max`, readiness/bootstrap and later lifecycle/retention concerns.

R3-B certifies the Location lifecycle gap frozen by R3-B-001 against the current Foundation runtime. It does not claim completion of future commercial or integrated readiness gates.

Explicit dependencies remain:

- TenantDomain routing administration — R3-C
- Platform Principal & Role Admin — R3-D
- Plan/Subscription — R3-E
- Entitlement administration — R3-F
- Feature/Capability/effective limits — R3-G
- Platform Audit Query — R3-H
- Admin API/UI — R3-I
- integrated certification/readiness — R3-J

Existing `createLocation` entitlement gating is preserved. R3-B does not bypass it and does not simulate `locations.max` readiness.

## 12. Production boundary

R3-B runtime evidence uses synthetic Tenants/Locations only.

R3-B does not modify:

- `main`
- Corte delle Stelle production data/configuration
- production domains
- production cutover state

R3-B does not claim:

- T20 PASS
- Golden Restaurant E2E PASS
- Corte migration PASS
- production cutover authorization
- Base44 decommission completion

## 13. Governance conclusion

Implementation evidence is sufficient to create the R3-B closure candidate.

R3-B must not be marked CLOSED until this reconciliation and machine-evidence closure commit receives exact-commit CI PASS, followed by 04.3 exact source snapshot, SHA-256/integrity manifest, Bible, DOC-000, final machine evidence and PR governance reconciliation.

R3-C must not be opened as an implementation gate before that closure chain is complete.
