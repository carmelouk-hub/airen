# AIRenPay

AP-01 establishes this directory as the AIRenOS-owned home of the provider-neutral AIRenPay contracts and policy.

AIRenPay is an independent, optional capability. Its canonical entitlement target is `airen.pay`. The entitlement constant is exported here, but AP-01 does not activate AIRenPay, authorize a provider call, open Direct Booking Gate E or move real money.

The package depends on AIRenOS shared contracts and on the provider-neutral guarantee modes exposed by `packages/booking-core`. It must not depend on RISTOAIREN or on a provider SDK. Concrete provider adapters remain in `packages/integrations`.

The historical `packages/ristoairen/src/airenpay` paths remain compatibility re-export adapters. They resolve to these exact bindings and do not own or fork AIRenPay behavior.

AP-01 does not rename certified PostgreSQL tables, migrations, events, persistence modules or idempotency identifiers. Those historical surfaces remain compatibility evidence until a separately governed replacement is explicitly authorized and proven.
