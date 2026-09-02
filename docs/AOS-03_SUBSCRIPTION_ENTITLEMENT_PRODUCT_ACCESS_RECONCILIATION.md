# AOS-03 — Subscription / Entitlement / ProductAccess Runtime Reconciliation

Status: IMPLEMENTATION CANDIDATE — GOVERNED NON-PRODUCTION — NOT CLOSED
Date: 2026-09-03

## 1. Governed objective

AOS-03 composes the already-certified AIRenOS authorities for Product Registry (AOS-01), Organization/Tenant context (AOS-02), commercial Subscription lifecycle (R3-E) and effective Entitlement resolution (R3-F) into a server-side ProductAccess runtime. It does not rebuild those authorities and it does not activate production.

The effective access rule is:

`active identity/membership scope ∩ Organization/Tenant binding ∩ ProductSubscription binding ∩ service-granting Subscription ∩ effective Product entitlement ∩ requested action permission ∩ Tenant/Location scope`

Backend/RLS remains an independent mandatory enforcement layer; ProductAccess never substitutes for downstream domain authorization or RLS.

## 2. Reconciliation with certified R3-E / R3-F

R3-E remains the sole owner of Plan and commercial Subscription lifecycle. Its certified Tenant-scoped Subscription states remain unchanged:

- `scheduled`
- `trialing`
- `active`
- `suspended`
- `cancel_pending`
- `canceled`
- `expired`

AOS-03 treats only `trialing`, `active` and `cancel_pending` as service-granting. It does not alter a Subscription state, price, Plan, provider reference or billing event.

R3-F remains the sole owner of Entitlement catalog and Tenant Entitlement lifecycle. AOS-03 never inserts, updates or deletes `billing.tenant_entitlements`; ProductAccess reads only the trusted effective Entitlement projection.

Because the certified R3-E runtime has one current non-terminal commercial Subscription per Tenant, AOS-03 introduces an additive compatibility binding rather than rewriting R3-E: one commercial Subscription may be bound to multiple AIRenOS Products. Product-specific access is then separated by each Product's AOS-01 entitlement key. This allows bundle semantics without changing certified billing history.

## 3. ProductSubscription binding

AOS-03 adds `platform.product_subscription_bindings` as an append-only platform reconciliation boundary linking:

`Organization → Tenant → AIRenOS Product → Product entitlement key → R3-E Subscription`

The binding does not duplicate commercial Subscription state. It stores only identity references needed to compose platform access.

Certified design invariants for the implementation candidate:

- Organization and Tenant must already be bound through AOS-02.
- Organization and Tenant must be active at bind time.
- the referenced R3-E Subscription must belong to the same Tenant and be current/non-terminal at bind time.
- the entitlement key is derived by application code from the AOS-01 Product Registry; callers cannot supply a different entitlement through the public command.
- the entitlement catalog entry must exist and be active.
- a given `(subscription_id, product_code)` binding is unique.
- multiple different Products may bind to the same commercial Subscription.
- binding mutation requires explicit Platform permission `platform.product_access.bind_subscription`.
- direct runtime-role DML is denied.
- binding mutation is idempotent and writes AuditEvent + OutboxEvent atomically.

## 4. Effective ProductAccess

The application resolver accepts a known AOS-01 `productCode`, the exact downstream `permissionKey` being evaluated and a resource Tenant/Location scope.

It then:

1. validates Product identity against the governed AOS-01 registry;
2. validates Tenant/Location resource scope;
3. resolves active Organization membership and Tenant membership through AOS-02;
4. resolves the current ProductSubscription binding through trusted server context;
5. resolves effective Entitlements through R3-F server-side state;
6. validates the Product's expected entitlement key;
7. validates service-granting Subscription state;
8. evaluates the requested RBAC permission;
9. returns a non-production ProductAccess projection or fails closed.

`SecurityContext.entitlements` is intentionally not used as the effective commercial source in this resolver. This prevents a client-carried entitlement value from spoofing ProductAccess. The trusted R3-F resolver is authoritative.

## 5. PostgreSQL isolation

`security.resolve_current_product_subscription(product_code)` derives identity, Tenant, Location and correlation context from trusted PostgreSQL request settings. It additionally requires:

- active Organization/Tenant binding;
- active Organization membership for the current identity;
- active Tenant membership for the current identity;
- active Location belonging to the Tenant;
- active Location membership, or the certified `tenant.location.all` Tenant permission.

The resolver never accepts Tenant or Organization IDs as caller-controlled arguments. Cross-Tenant reads therefore fail closed at the database capability boundary.

## 6. Explicit non-scope

AOS-03 does **not** implement or authorize:

- provider selection or provider SDK/webhooks;
- Stripe LIVE or any real-money operation;
- prices, production plans, trial duration, grace/dunning policy or tax;
- checkout UI, billing portal or Base44 product purchase screens;
- destructive downgrade/cancellation data deletion;
- production database migration or production feature enablement;
- Corte delle Stelle production changes;
- AIRen Booking or AIRenPay ownership changes;
- Kairos, ARYA, STELLA or K5 implementation;
- merge of PR #4 or any protected branch.

## 7. Evidence status

This document is created with the initial implementation candidate. Runtime PASS evidence must be bound later to an exact commit SHA and exact GitHub Actions runs. Until that occurs, and until remote read-back plus RULE-DOC-20/21 closure reconciliation and canonical Drive registration are complete:

`AOS-03 = IMPLEMENTATION CANDIDATE / NOT CLOSED`

Historical failures, if any, must remain append-only evidence and must not be rewritten.
