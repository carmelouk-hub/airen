# R3-E — Plan & Subscription Lifecycle Reconciliation

Status: IMPLEMENTATION RUNTIME PASS — CLOSURE CANDIDATE
Date: 2026-08-23

## 1. Governed scope

R3-E closes the Plan & Subscription lifecycle gap frozen by `R3-E-001 — Plan & Subscription Lifecycle Scope & Gap Reconciliation — v0.1` and machine specification `MRS-005`, while preserving ADR-006 separation between commercial Subscription state, Entitlement state and Permission state.

Certified implementation scope:

- distinct `packages/billing` ownership for commercial Plan/Subscription contracts
- Plan draft/create/update/activate/retire lifecycle
- stable immutable Plan slug and immutable active historical commercial terms
- Tenant Subscription create/start/trial/activate/suspend/reactivate lifecycle
- scheduled cancellation, cancellation unschedule, immediate cancel and scheduled-cancel finalization
- explicit terminal canceled/expired states without hard delete
- governed immediate Plan change to another active Plan without proration/payment execution
- non-secret provider/source routing references with provider-reference uniqueness
- one current non-terminal Subscription lifecycle per Tenant, including concurrency enforcement
- append-only `billing.subscription_events`
- request-hash lifecycle idempotency
- AuditEvent and OutboxEvent atomicity
- forced-failure atomic rollback
- safe Platform Plan/Subscription detail and bounded-list queries
- safe current-Tenant Subscription resolver derived only from trusted Tenant context
- independent PostgreSQL Platform-permission recheck
- direct billing table mutation denial to runtime invocation roles
- explicit non-mutation of `billing.tenant_entitlements`

R3-E does not implement Entitlement administration, Feature/Capability resolution, provider SDK/webhooks, invoicing, payment collection, refunds, tax, dunning, metering or proration.

## 2. Ownership and authority boundary

The R3-E authority path is:

AuthenticatedPrincipal
→ PlatformSecurityContext
→ active Platform Role
→ explicit `platform.plans.*` / `platform.subscriptions.*` permission
→ governed `packages/billing` command/query
→ `airen_control_plane` NOLOGIN invocation role
→ narrow `security.*` PostgreSQL capability
→ independent PostgreSQL permission recheck
→ `airen_control_plane_owner` NOLOGIN capability owner
→ minimum schema/table privileges needed for the capability.

`airen_app` has no lifecycle mutation authority. It receives only EXECUTE on the zero-argument current-Tenant resolver, which derives `airen.tenant_id` from trusted request context and excludes provider references.

No Tenant role, including `tenant_admin`, becomes Platform billing authority.

## 3. Plan lifecycle

Plan states:

- `draft`
- `active`
- `retired`

Governed transitions:

- create → draft
- draft update → draft
- draft → active
- active → retired

Certified invariants:

- Plan slug is normalized, unique and immutable
- commercial terms are mutable only while draft
- active/retired historical terms are not rewritten
- retired is terminal in normal lifecycle
- new subscriptions and Plan changes require an active Plan
- no hard delete
- Plan contains no Entitlement/Feature authority columns

## 4. Subscription lifecycle

Subscription states:

- `scheduled`
- `trialing`
- `active`
- `suspended`
- `cancel_pending`
- `canceled`
- `expired`

Creation derives state server-side from trusted PostgreSQL time:

- future `starts_at` → scheduled
- started and valid trial → trialing
- otherwise → active

A Plan default trial may derive `trial_ends_at` server-side when the caller omits it.

Governed transitions proved:

- scheduled → trialing/active only after start time is reached
- trialing → active through explicit governed activation
- active → suspended → active
- trialing/active → cancel_pending
- cancel_pending → trialing/active through explicit unschedule, requiring active Tenant because service is restored
- current non-terminal → canceled through `cancel(mode=immediate)`
- cancel_pending → canceled through `cancel(mode=finalize_scheduled)` only when `cancel_effective_at <= trusted now`
- current non-terminal → expired only when `current_period_end <= trusted now`
- scheduled/trialing/active/suspended → another active Plan through governed change-plan

Canceled and expired are terminal and are never reactivated.

## 5. Tenant lifecycle interaction

Service-granting operations require `Tenant.status=active`:

- create Subscription
- activate/start
- reactivate
- unschedule cancellation
- change Plan

Restrictive operations remain available for a non-active Tenant:

- suspend
- schedule cancellation
- immediate cancellation
- scheduled cancellation finalization
- expiration

Tenant lifecycle and Subscription lifecycle remain separate; neither silently mutates the other.

## 6. Provider/source boundary

R3-E persists only non-secret routing metadata:

- `source_kind`
- `provider_key`
- `provider_subscription_ref`
- `provider_customer_ref`

Provider Subscription reference is unique within provider when present. The runtime schema is checked for secret/password/token/credential columns and none are introduced.

Provider references never authorize Tenant identity. No provider SDK/API, webhook ingestion, provider credentials or payment operation is implemented.

## 7. Entitlement separation

R3-E never mutates `billing.tenant_entitlements`.

Static SQL guardrails reject R3-E migration code that inserts, updates or deletes Tenant Entitlements. Runtime evidence snapshots `billing.tenant_entitlements` before and after the complete R3-E lifecycle test and proves it is unchanged.

Entitlement lifecycle remains R3-F.

## 8. Idempotency, event history and rollback

`billing.lifecycle_idempotency` records request hashes and immutable completed results for all Plan/Subscription mutations.

Proved:

- identical retry replays the completed result
- replay does not duplicate AuditEvent or SubscriptionEvent evidence
- same idempotency key with changed payload fails closed
- `billing.subscription_events` is append-only in normal admin operation
- forced AuditEvent failure rolls back Subscription state, idempotency claim, SubscriptionEvent and OutboxEvent atomically

## 9. Runtime evidence

Foundation frozen base:
`2c40af819c93c32538ccd846b4e9eb7474cd5f74`

R3-D exact closure baseline:
`f6792bbfa3ed0b7ef40f047bbce6112cc13066e0`

R3-E implementation PASS commit:
`4ddaa93f1b1bec13a7b50100083b11b539f13b1f`

Implementation tree:
`6122f21f04ba709d723337d619f9e059fb2a0429`

GitHub Actions:
`foundation-contract-ci` run #386
Run ID `32605121768`
Conclusion: SUCCESS

Jobs:

- application-contracts — PASS
- postgres-rls-runtime — PASS
- deployment-path-runtime — PASS

Deployment evidence artifact:
ID `9483925916`
Digest `sha256:52a7d3ca061c40f9671db55abbb6bc9dcaa4ea17a41caf859866c861306535c5`

The artifact reports `RUNTIME_DEPLOYMENT_PATH_PASS`, migration first run PASS, migration idempotent second run PASS, startup fail-closed PASS, liveness/readiness PASS, least-privilege runtime role PASS, degraded-candidate detection PASS and rollback PASS. The workflow artifact is bound by GitHub metadata to head SHA `4ddaa93f1b1bec13a7b50100083b11b539f13b1f`; its embedded `release_revision` is the synthetic PR merge revision used by the deployment-path job and is not treated as the R3-E implementation commit.

## 10. Runtime assertions proved

PASS:

- migrations 0014→0018 apply on the clean certified migration chain
- Foundation RLS regression remains PASS
- authenticated principal regression remains PASS
- R3-A Tenant regressions remain PASS
- R3-B Location regression remains PASS
- R3-C TenantDomain regression remains PASS
- R3-D Platform Role regression remains PASS
- Plan create/update/activate/retire
- active Plan commercial-term immutability
- retired Plan cannot receive a new Subscription
- Plan detail/list query authorization
- Subscription create state derivation
- server-derived default trial semantics
- one-current-subscription-per-Tenant concurrency enforcement
- scheduled start time enforcement
- trial activation
- suspend/reactivate
- schedule/unschedule cancellation
- immediate cancellation
- scheduled cancellation finalization time enforcement
- expiration time enforcement
- terminal Subscription cannot reactivate
- Plan change only to active different Plan
- cancel_pending blocks Plan change until unscheduled
- Tenant active requirement for service-restoring/granting transitions
- restrictive actions remain possible when Tenant is non-active
- provider reference uniqueness
- provider refs excluded from current-Tenant resolver
- safe current-Tenant resolver cannot cross Tenant context
- identical idempotent replay
- changed-payload idempotency conflict
- forced Audit failure complete rollback
- Tenant role shortcut to Platform billing authority denied
- independent PostgreSQL Platform-permission recheck
- direct `airen_control_plane` billing DML denied
- `airen_app` lifecycle capability execution denied
- no secret credential columns introduced
- `billing.tenant_entitlements` unchanged
- AuditEvent / OutboxEvent / SubscriptionEvent evidence recorded
- deployment-path regression PASS

## 11. Failure reconciliation

The first R3-E implementation CI run (#386 / `32605121768`) passed all three jobs. There is no failed runtime CI to reconcile for this implementation candidate.

Before publication, the single draft migration was separated into migrations 0014–0018 solely to produce atomic, reviewable Git objects while preserving the frozen semantics. The complete split set was re-run through local SQL static contracts and application-contract tests before branch advancement. This is packaging refinement, not a runtime failure correction and not an authority change.

No security policy, RLS rule, permission boundary, Tenant/Platform separation, Entitlement separation, idempotency rule, rollback rule or provider boundary was weakened.

## 12. Scope boundary

R3-E implementation runtime PASS proves Plan & Subscription lifecycle only.

Still out of scope:

- Entitlement Administration — R3-F
- Feature/Capability/effective-limit resolution — R3-G
- Platform Audit Query — R3-H
- Admin API/UI — R3-I
- integrated Control Plane certification — R3-J
- provider billing correctness / Stripe or other provider integration
- invoices, payments, refunds, tax, dunning, usage charging or proration
- production billing migration
- Corte delle Stelle migration/cutover
- production cutover
- Base44 decommission
- T20 and Golden Restaurant E2E certification

## 13. Production boundary

All R3-E runtime evidence uses synthetic Plan, Tenant and Subscription fixtures.

`main` is unchanged. Corte delle Stelle production data/configuration/domain state is unchanged. No production billing or provider account is contacted.

## 14. Governance conclusion

Implementation evidence is sufficient to create the R3-E closure candidate.

R3-E must not be marked CLOSED until this reconciliation and machine-evidence closure commit receives exact-commit CI PASS, followed by the 04.3 exact source snapshot/integrity chain, Bible and DOC-000 final promotion, final machine evidence and PR governance reconciliation.

R3-F must not begin implementation before that closure chain is complete.
