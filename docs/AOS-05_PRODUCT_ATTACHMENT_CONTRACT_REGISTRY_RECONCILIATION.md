# AOS-05 — Product Attachment Contract & Registry Reconciliation

State at implementation candidate: **WIP / GOVERNED NON-PRODUCTION**.

## Purpose

AOS-05 defines the common AIRenOS product-attachment contract required before a vertical or shared capability may receive a concrete Experience Layer entrypoint. It closes the gap between the certified AOS-01 Product Registry / AOS-03 ProductAccess runtime and the future product-specific attachment gates.

AOS-05 does **not** attach RISTOAIREN, AIRen Booking or AIRenPay. It registers the governed prerequisites that future attachment gates must satisfy.

## Authority model

- AIRenOS Foundation / GitHub remains the canonical attachment-contract authority.
- AOS-01 Product Registry remains the source for product code, product type, entitlement, owning Core and certified source SHA.
- AOS-03 ProductAccess remains the server-side access authority.
- The Experience Layer remains replaceable and cannot become business authority.
- Base44 authentication is not an AIRenOS credential.

## Registered product classes

- `ristoairen` -> `vertical_experience`.
- `airen.booking` -> `shared_capability_experience`.
- `airen.pay` -> `shared_capability_experience`.

The registry is exactly one-to-one with the AOS-01 Product Registry. No product-specific app ID, URL or entrypoint is assigned by AOS-05.

## Mandatory future attachment requirements

Every future product-specific attachment gate must provide and prove:

1. real AIRenOS session authority;
2. allowed AOS-03 ProductAccess;
3. effective product entitlement;
4. governed route manifest / entrypoint;
5. health and readiness contract;
6. attachment-specific tests;
7. cleanup / deprovision contract;
8. owning-Core authority preservation.

A client or Base44 experience may present and navigate a product, but it cannot own subscription state, entitlement state, ProductAccess decisions or vertical/capability business state.

## Initial AOS-05 state

All registered products are deliberately:

- `contractState = registered`;
- `runtimeAttachmentState = not_attached`;
- `entrypointState = not_assigned`;
- `experienceTarget = replaceable_client`;
- `experienceBusinessAuthority = false`;
- `productionEnabled = false`.

This prevents AOS-05 from being misread as authorization to build or activate RISTOAIREN, AIRen Booking or AIRenPay experiences.

## Explicit non-authorizations

- no product-specific Base44 app or entrypoint assignment;
- no real AIRenOS session handoff implementation;
- no production deployment or provider activation;
- no Stripe LIVE or real-money operation;
- no Corte delle Stelle production change;
- no R3 history rewrite or PR #4 merge;
- no Kairos / ARYA / STELLA implementation or K5;
- no individual RISTOAIREN, AIRen Booking, AIRenPay or Kairos attachment gate is authorized by AOS-05 itself.
