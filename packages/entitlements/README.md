# entitlements

AIRenOS Entitlement Administration, effective eligibility resolution and runtime enforcement boundary.

This package deliberately keeps Entitlements separate from Plan/Subscription (`packages/billing`), Permissions (`packages/authorization`) and Feature/Capability mapping (R3-G). `requireEntitlement()` remains the enforcement primitive over trusted `SecurityContext.entitlements`; R3-F adds governed catalog/grant lifecycle and structured effective resolution without moving authority into RISTOAIREN or UI code.
