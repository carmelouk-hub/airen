# R3-F — Entitlement Administration & Effective Resolution Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE
Date: 2026-08-23

## 1. Governed scope

R3-F closes the Entitlement Administration & Effective Resolution gap frozen by `R3-F-001 — Entitlement Administration & Effective Resolution Scope & Gap Reconciliation — v0.1` and machine specification `MRS-006`, while preserving ADR-006 separation between Subscription/Plan state, Entitlement state, Permission state and later Feature/Capability resolution.

Certified implementation scope:

- `packages/entitlements` remains the owner of Entitlement enforcement and effective resolution
- additive evolution of existing `billing.entitlement_catalog` and `billing.tenant_entitlements`
- governed Entitlement catalog create/update/retire lifecycle
- governed Tenant Entitlement grant/regrant/revoke/expire lifecycle
- governed limit, config and validity changes
- trusted-time derivation of scheduled/effective/expired behavior
- source provenance with compatibility for certified legacy `source_kind` values
- append-only `billing.entitlement_events`
- request-hash Entitlement lifecycle idempotency
- AuditEvent and OutboxEvent atomicity
- forced-failure atomic rollback
- safe Platform catalog/Tenant Entitlement queries
- safe zero-argument current-Tenant effective Entitlement resolver derived from trusted Tenant context
- independent PostgreSQL Platform-permission recheck
- direct Entitlement table mutation denial to runtime invocation roles
- preservation of the existing `requireEntitlement()` enforcement contract

R3-F does not implement Plan/Subscription lifecycle, Feature/Capability mapping, product-feature visibility, provider billing, Admin API/UI, broad audit query, Corte migration or production cutover.

## 2. Ownership and authority boundary

The R3-F administrative authority path is:

AuthenticatedPrincipal
→ PlatformSecurityContext
→ active Platform Role
→ explicit `platform.entitlements.*` permission
→ governed `packages/entitlements` command/query
→ `airen_control_plane` NOLOGIN invocation role
→ narrow `security.*` PostgreSQL capability
→ independent PostgreSQL permission recheck
→ `airen_control_plane_owner` NOLOGIN capability owner
→ minimum billing/platform/authz/audit/events privileges required by that capability.

`airen_app` has no Entitlement lifecycle mutation authority. It receives only EXECUTE on the zero-argument current-Tenant effective resolver, which obtains the Tenant from trusted runtime context and does not expose `source_ref`.

No Tenant role, including `tenant_admin`, becomes Platform Entitlement administration authority.

## 3. Entitlement catalog lifecycle

Catalog state is additive over the Foundation catalog:

- `active`
- `retired`

Governed transitions:

- absent → active through catalog create
- active → active through description update
- active → retired through retire

Certified invariants:

- Entitlement key is normalized, unique and immutable
- retired is terminal in normal lifecycle
- retired catalog entries reject new grant/regrant
- no hard delete
- catalog lifecycle does not create Permission or Feature/Capability authority

## 4. Tenant Entitlement lifecycle

Derived runtime states:

- `scheduled`
- `effective`
- `revoked`
- `expired`
- legacy-compatible `inactive` for disabled/elapsed rows without terminal marker

Governed actions:

- grant absent → scheduled/effective
- regrant inactive/revoked/expired row → scheduled/effective
- revoke scheduled/effective → revoked
- expire scheduled/effective → expired only when `valid_until <= trusted now`
- change limit while current → same derived state
- change config while current → same derived state
- change validity while current → scheduled/effective according to trusted time

Certified rules:

- service-granting/change operations require active Tenant
- restrictive revoke/expire paths do not silently reactivate service
- nullable limit is non-negative when present
- config replacement requires a JSON object
- validity interval must be ordered and cannot be used to create an already-expired active state
- duplicate enabled grant fails closed
- grant/regrant requires active catalog entry

## 5. Source provenance and legacy compatibility

`source_kind` remains open-text by design for backward compatibility with already-certified Foundation/test rows. R3-F does not impose a retroactive closed enum.

New governed grant/regrant commands validate the source shape and may store:

- `source_kind`
- optional non-secret `source_ref`

Source attribution is not Permission, Subscription or Tenant authority. Normal update commands cannot mutate source attribution outside a governed regrant path.

The current-Tenant effective resolver excludes `source_ref`.

## 6. Effective resolution

R3-F effective resolution answers which Entitlements are effective for the trusted Tenant and returns Entitlement-specific limit/config state.

Effective eligibility requires:

- trusted current Tenant context
- active Tenant
- catalog entry still active
- Tenant Entitlement enabled
- `valid_from` absent or reached
- `valid_until` absent or not elapsed

The zero-argument resolver accepts no client-supplied Tenant identity.

This resolution is not R3-G Feature/Capability resolution. It does not map Entitlement keys into product capabilities and does not alter Permission checks.

## 7. R3-E and R3-G separation

R3-F does not mutate:

- `billing.plans`
- `billing.subscriptions`
- `billing.subscription_events`
- R3-E commercial lifecycle idempotency

R3-F introduces no Feature/Capability registry or Entitlement→Feature mapping table.

Therefore:

Subscription != Entitlement != Permission

and:

Entitlement != Feature/Capability

remain enforced architectural boundaries.

## 8. Idempotency, event history and rollback

`billing.entitlement_lifecycle_idempotency` records request hashes and immutable completed results for governed Entitlement mutations.

Proved:

- identical retry replays the completed result
- replay does not duplicate lifecycle evidence
- changed payload with the same idempotency key fails closed
- `billing.entitlement_events` is append-style lifecycle evidence
- forced AuditEvent failure rolls back Entitlement mutation, idempotency completion, EntitlementEvent and OutboxEvent atomically

## 9. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-E exact closure baseline:
`46784d03ae8fc17b0bad273b670b8a20d740b13b`

Initial R3-F implementation candidate:
`f8d9faff2cdb6af1ac86615cc2e57329db85d8c6`

Initial candidate tree:
`9691c1d0feb048089963dd08aeaa47e9469886f9`

First implementation CI:
`foundation-contract-ci` #391
Run ID `32610672049`
Conclusion: FAILURE

Failure shape:

- application-contracts — SUCCESS
- postgres-rls-runtime — FAILURE
- deployment-path-runtime — FAILURE

Root cause: PostgreSQL 16 rejected direct string concatenation after a PL/pgSQL `RAISE EXCEPTION` literal in migration `0021_r3f_tenant_entitlement_lifecycle_capability.sql`. Deployment failed on the same migration chain. No authorization, RLS or lifecycle failure was observed.

Corrective implementation PASS commit:
`a98952da7c11c25e2e502e1532c769693d1b82e2`

Implementation PASS tree:
`9f507122492e4ee4ee9d0d2ec5628984ee1b5668`

Corrective GitHub Actions:
`foundation-contract-ci` #393
Run ID `32611327269`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9485608586`
Digest `sha256:5eed651aafab569ba19c53fda3d4364f9787fcb1e45c3ba1d75659359b1825af`

GitHub metadata binds that artifact to head SHA `a98952da7c11c25e2e502e1532c769693d1b82e2`.

## 10. Mandatory MRS-006 proof reconciliation

PASS:

- T01 Foundation and R3-A/B/C/D/E regressions green
- T02 catalog create/update/retire, immutable key, no hard delete
- T03 retired catalog rejects grant/regrant
- T04 grant absent and regrant inactive/revoked/expired
- T05 duplicate active/scheduled grant fails closed
- T06 scheduled/effective derivation uses trusted PostgreSQL time
- T07 non-active Tenant yields no effective runtime Entitlements
- T08 revoke is restrictive and remains available without granting service
- T09 expire blocked before `valid_until` and succeeds after threshold
- T10 nullable/non-negative limit validation
- T11 JSON-object config full replacement
- T12 validity interval and active-Tenant enforcement
- T13 source provenance and legacy `source_kind` compatibility
- T14 identical idempotent replay and changed-payload conflict
- T15 forced Audit failure atomic rollback
- T16 PostgreSQL Platform permission recheck
- T17 Tenant-role shortcut denied
- T18 direct `airen_control_plane` Entitlement DML denied
- T19 `airen_app` lifecycle mutation capability denied
- T20 zero-argument current-Tenant resolver cannot cross Tenant context and excludes `source_ref`
- T21 existing `requireEntitlement()` contract preserved
- T22 R3-E Plan/Subscription state is not mutated by R3-F
- T23 no Feature/Capability registry or mapping introduced

## 11. Failure reconciliation

CI #391 / run `32610672049` is retained as a failed implementation attempt, not erased.

Root cause:
invalid PostgreSQL 16 PL/pgSQL `RAISE EXCEPTION 'literal' || expression` syntax.

Correction:
the error path now uses valid `RAISE EXCEPTION USING ERRCODE=..., MESSAGE=...`, and the R3-F static SQL guardrail rejects the invalid concatenation pattern.

Corrective commit:
`a98952da7c11c25e2e502e1532c769693d1b82e2`

Only two files changed from the first candidate:

- `db/migrations/0021_r3f_tenant_entitlement_lifecycle_capability.sql`
- `scripts/check-r3f-entitlement-contract.mjs`

Authority impact: NONE.

No security policy, RLS rule, permission boundary, Tenant/Platform separation, Subscription/Entitlement/Permission separation, R3-G boundary, idempotency rule or rollback rule was weakened.

## 12. Scope boundary

R3-F implementation runtime PASS proves Entitlement Administration & Effective Resolution only.

Still out of scope:

- Feature/Capability resolution — R3-G
- Platform Audit Query — R3-H
- Admin API/UI — R3-I
- integrated Control Plane certification — R3-J
- provider billing/payment behavior
- RISTOAIREN operational domains
- Corte delle Stelle migration/cutover
- production cutover
- Base44 decommission
- T20 and Golden Restaurant E2E certification

## 13. Production boundary

All R3-F runtime evidence uses synthetic fixtures.

`main` is unchanged. Corte delle Stelle production data/configuration/domain state is unchanged. No production Tenant Entitlement or billing provider is contacted.

## 14. Governance conclusion

Implementation evidence is sufficient to create the R3-F closure candidate.

R3-F must not be marked CLOSED until this reconciliation and machine-evidence closure commit receives exact-commit CI PASS, followed by the 04.3 exact source snapshot/integrity chain, final machine evidence in 04.1, Bible/DOC-000/MRS/R3-CP promotion and PR governance reconciliation.

R3-G must not begin implementation before that closure chain is complete.
