# AOS-02 — Tenant / Organization / Domain Control Plane Reconciliation

State at implementation commit: **WIP / GOVERNED NON-PRODUCTION**.

## Purpose

AOS-02 adds the missing AIRenOS Organization customer/account boundary without rebuilding or weakening the already certified R3 Tenant, Location, TenantMembership or TenantDomain authority.

Canonical hierarchy for this gate:

`Identity -> OrganizationMembership -> TenantMembership -> LocationMembership`

ProductAccess, subscription and entitlement authorization remain outside AOS-02 and belong to AOS-03.

## Reused certified authority

AOS-02 preserves and reuses the existing R3 control plane for:

- Tenant provisioning and lifecycle;
- Location lifecycle;
- TenantMembership and LocationMembership;
- TenantDomain lifecycle;
- trusted subdomain and custom-domain `hostname -> tenant/location` resolution;
- PostgreSQL authority boundaries, RLS, audit and outbox behavior.

No existing R3 migration or certified branch is rewritten.

## Additive AOS-02 delta

AOS-02 introduces:

- first-class `platform.organizations`;
- `authz.organization_memberships`;
- `platform.organization_tenants` with one Organization -> many Tenants and exactly one Organization binding per Tenant;
- governed Organization provisioning;
- governed Organization -> Tenant binding;
- authenticated OrganizationMembership lookup;
- AIRenOS application contract requiring active OrganizationMembership and active TenantMembership for tenant-user context.

`Organization != Tenant` is a hard invariant. Organization is the AIRenOS customer/account boundary; Tenant remains the operational and data-isolation boundary.

## Domain invariant

TenantDomain remains a routing primitive, never an authorization primitive. A hostname may resolve a Tenant/Location, but access still requires authenticated identity and memberships. AOS-02 does not infer Organization or Tenant authorization from a hostname.

## Migration history isolation

`0030_aos02_organization_control_plane.sql` is an additive post-R3 migration. The existing R3 baseline runner remains unchanged and continues to represent the historical 0001-0029 certified migration chain. The dedicated AOS-02 workflow applies the certified baseline first and then applies migration 0030 in isolation before executing AOS-02 runtime proofs.

## Base44 boundary

No Base44 production implementation is authorized by this gate. AIRenOS Base44 remains an experience/control surface over governed AIRenOS APIs and context. AIRen Booking and AIRenPay remain shared capabilities, not verticals. Their Base44 product experiences are intentionally deferred until after AOS-03 has established subscription/entitlement/ProductAccess runtime and the AIRenOS shell can authorize which products each Organization/Tenant may open.

## Explicit non-authorizations

- no production deployment;
- no Corte delle Stelle production change;
- no Stripe LIVE or real-money operation;
- no production database migration;
- no R3 history rewrite;
- no PR #4 merge;
- no K5 implementation;
- no ProductAccess/subscription/entitlement implementation in AOS-02.
