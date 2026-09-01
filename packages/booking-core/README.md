# AIRen Booking Core

AB-02 establishes this directory as the AIRenOS-owned home of the Booking domain implementation.

The seven Booking domain files were extracted from `packages/ristoairen/src/booking` without changing domain behavior. The historical RISTOAIREN paths remain compatibility re-export adapters so existing API, persistence, AIRenPay and test imports continue to resolve to the exact same runtime bindings.

AB-02 deliberately preserves `RistoProductAccessGuard` naming and the historical `RST-F-BKG-*` / `RST-F-BKG-HOLD-*` idempotency identifiers. Product-neutral access control and the canonical `airen.booking` entitlement belong to AB-03 and must not be introduced retroactively in this extraction gate.

No database migration, API route rename, Base44 change, AIRenPay behavior change, provider call, production deployment or Gate E opening is part of AB-02.
