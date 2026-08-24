# R3-D — Platform Principal & Role Administration Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE
Date: 2026-08-22

## 1. Governed scope

R3-D closes the Platform Principal & Role Administration gap frozen by `R3-D-001 — Platform Principal & Role Administration Scope & Gap Reconciliation — v0.1` while preserving the established AIRenOS authority split between platform and Tenant roles.

Certified implementation scope:

- safe Platform Principal detail query
- safe Platform Principal list query with bounded pagination and optional active-role filter
- safe Platform Role catalog/list query
- platform role assignment
- platform role suspension
- platform role reactivation
- platform role revocation without hard delete
- re-grant of a revoked platform role through the governed assign path
- protected-role policy for `platform_admin`
- anti-self-escalation
- protected-role peer requirement
- protected-role self suspend/revoke denial
- minimum-active protected-role enforcement
- request-hash lifecycle idempotency
- assignment transition history
- AuditEvent and OutboxEvent for governed mutations
- forced-failure atomic rollback
- independent PostgreSQL platform-permission recheck
- authentication projection reflects only active Platform Role assignments
- direct authority-table mutation denial to runtime invocation roles

R3-D does not create a Tenant-role shortcut into Platform authority and does not make `tenant_admin` equivalent to `platform_admin`.

## 2. Authority boundary

Authenticated platform authority remains:

AuthenticatedPrincipal
→ PlatformSecurityContext
→ resolved active platform roles
→ explicit `platform.*` permission
→ governed application command/query
→ `airen_control_plane` NOLOGIN invocation role
→ narrow `security.*` PostgreSQL capability
→ independent DB permission recheck
→ `airen_control_plane_owner` NOLOGIN capability owner
→ minimum table/schema privileges required by the capability.

R3-D permissions:

- `platform.principals.read`
- `platform.roles.read`
- `platform.roles.assign`
- `platform.roles.suspend`
- `platform.roles.reactivate`
- `platform.roles.revoke`

The runtime invocation roles do not receive direct DML authority on Platform Role assignment tables. `airen_app` cannot execute the R3-D mutation capability. `airen_control_plane` cannot directly update `authz.platform_role_assignments`.

## 3. Platform Role lifecycle

Assignment states remain:

- `active`
- `suspended`
- `revoked`

Governed actions:

- assign a previously missing role assignment → active
- assign a previously revoked role assignment → active (re-grant)
- active → suspended
- suspended → active
- active/suspended → revoked

No hard delete is introduced.

Authentication resolves only active Platform Role assignments into `AuthenticatedPrincipal.platformRoles`. Runtime evidence proves that suspension/revocation removes the role from the authentication projection and reactivation/re-grant restores it.

## 4. Protected role governance

`platform_admin` is represented in `authz.platform_protected_roles` with a governed minimum number of active assignments.

Certified invariants:

- assignment/reactivation cannot be used for self authority gain
- protected `platform_admin` administration requires an active peer holding that protected role
- an actor cannot suspend/revoke their own protected role
- a non-peer role possessing a generic role-assignment permission cannot assign `platform_admin`
- suspension/revocation is blocked if it would violate the configured minimum active protected-role count
- protected-role lifecycle still uses normal idempotency, transition, Audit and Outbox contracts

These invariants prevent both privilege escalation and accidental administrative lockout.

## 5. Identity boundary

R3-D governs Platform Role assignment to existing AIRenOS Identity records. It does not govern Identity lifecycle.

The capability verifies target Identity existence/status using a non-locking SELECT-only read. `airen_control_plane_owner` has only the schema/table read access needed for this validation; no UPDATE/INSERT/DELETE authority over `identity.identities` was added to solve runtime failures.

Assign/reactivate requires the target Identity to be active. An inactive/suspended target cannot gain or regain Platform authority through R3-D.

## 6. Idempotency and rollback

`authz.platform_role_lifecycle_idempotency` records request hashes for assign/suspend/reactivate/revoke.

- identical retry replays the completed result
- replay does not emit a duplicate AuditEvent
- idempotency-key reuse with changed payload fails closed
- revoke of a missing assignment fails as a governed conflict and leaves no idempotency, transition, Audit or Outbox side effect
- forced AuditEvent failure rolls back assignment state, idempotency, transition history and Outbox effect atomically

## 7. Query surface

R3-D exposes safe Platform Principal and Platform Role query capabilities. Runtime evidence validates:

- Platform Principal detail returns the target Identity with role-assignment projection
- Platform Principal list supports a bounded limit and active-role filtering
- Platform Role list exposes protected-role metadata, minimum-active value and permission keys
- a principal without platform read authority is denied both principal and role queries

This is not unrestricted raw table access.

## 8. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-C closure baseline:
`96c0bb8610b9fb450793112c759dda28a3eb33b1`

R3-D implementation PASS commit:
`58f9d1672a8f1eb6ebc420bb03de2677945182e8`

Implementation tree:
`73ea75e76dce79a36fc8979cc0bf82ab22448acd`

GitHub Actions:
`foundation-contract-ci` run #381
Run ID `32592325545`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9480649648`
Digest `sha256:e6393b7ea941a7076e0f5173a13058cb4e2b76981848de5ea631df256ccd98f5`

## 9. Runtime assertions proved

PASS:

- migrations 0010→0013 apply on a clean PostgreSQL runtime
- Foundation RLS regression suite remains PASS
- authenticated principal regression remains PASS
- R3-A provisioning/lifecycle regressions remain PASS
- R3-B Location lifecycle regression remains PASS
- R3-C TenantDomain regression remains PASS
- governed assignment of a normal platform role to an active Identity
- authentication projection immediately includes active assignment
- identical assignment retry replays successfully without duplicate audit
- changed-payload idempotency reuse denied
- undefined platform role denied
- inactive Identity authority gain denied
- self authority gain denied
- Platform Principal detail query authorized
- Platform Principal filtered list authorized
- Platform Role catalog query authorized and exposes protected policy
- normal role suspend removes role from authentication projection
- normal role reactivate restores role to authentication projection
- normal role revoke removes role from authentication projection
- revoked role re-grant restores role to authentication projection
- forced Audit failure rolls back state/idempotency/transition/outbox
- protected `platform_admin` assignment by active peer succeeds
- generic delegator without protected-role peer status cannot assign `platform_admin`
- protected-role self suspension denied
- minimum-active protected-role invariant blocks unsafe suspension
- peer protected-role suspend/reactivate/revoke/re-grant works under governance
- no-platform principal denied read queries
- DB permission recheck denies unauthorized direct capability invocation
- direct `airen_control_plane` role-assignment UPDATE denied
- `airen_app` mutation capability execution denied
- transition history, AuditEvent and OutboxEvent are recorded for governed role mutations
- revoke of missing assignment fails closed with zero lifecycle side effects
- deployment-path regression remains PASS

## 10. Failure reconciliation

### CI #355 / run 32590462013 — missing schema USAGE

The initial R3-D runtime reached `security.platform_mutate_role_assignment` and failed because `airen_control_plane_owner` had the intended SELECT on `identity.identities` but lacked USAGE on schema `identity`.

Correction: migration `0011_r3d_platform_role_admin_correction.sql` granted only `USAGE ON SCHEMA identity` to the NOLOGIN capability owner. No runtime invocation role received table authority.

The same correction also made missing-assignment revoke fail closed explicitly rather than relying on SQL NULL semantics, with a dedicated regression test.

### CI #365 / run 32591873828 — unnecessary Identity locking read

After schema USAGE was corrected, PostgreSQL rejected `SELECT ... FOR SHARE` on `identity.identities`. The locking read would require broader table authority than the SELECT-only validation needed by R3-D.

Correction: migration `0012_r3d_platform_role_identity_read_correction.sql` removed only `FOR SHARE`. No UPDATE/INSERT/DELETE privilege was granted on Identity. A static guardrail now rejects locking reads and mutation-authority expansion on that boundary.

### CI #373 / run 32592178660 — PL/pgSQL role_key ambiguity

The runtime then advanced into role suspension and exposed SQLSTATE `42702`: output variable `role_key` conflicted with an unqualified table column in governed UPDATE branches.

Correction: migration `0013_r3d_platform_role_column_qualification_correction.sql` qualifies role-assignment UPDATE/WHERE/RETURNING references with table alias `pra`. No permission, lifecycle or protected-role rule changed. A static guardrail verifies the qualification.

Full rerun CI #381 PASS.

No correction weakened grants, RLS, Platform/Tenant authority separation, protected-role policy, anti-self-escalation, minimum-active enforcement, idempotency, rollback, Audit or Outbox guarantees.

## 11. Scope boundary

R3-D certifies Platform Principal and Platform Role assignment administration only.

Out of scope and still future:

- Plan/Subscription — R3-E
- Entitlement administration — R3-F
- Feature/Capability/effective limits — R3-G
- Platform Audit Query — R3-H
- Admin API/UI — R3-I
- integrated Control Plane certification — R3-J
- production Identity-provider administration beyond the existing provider-neutral authentication boundary
- production cutover
- Corte delle Stelle migration
- Base44 decommission
- T20 and Golden Restaurant E2E certification

## 12. Production boundary

All R3-D runtime evidence uses synthetic Identity/role fixtures.

R3-D does not modify `main`, Corte delle Stelle production data/configuration, production domains or production cutover state.

## 13. Governance conclusion

Implementation evidence is sufficient to create the R3-D closure candidate.

R3-D must not be marked CLOSED until this reconciliation and machine-evidence closure commit receives exact-commit CI PASS, followed by 04.3 exact source snapshot, SHA-256/integrity manifest, Bible and DOC-000 final promotion, final machine evidence and PR governance reconciliation.

R3-E must not be opened as an implementation gate before that closure chain is complete.
