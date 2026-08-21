# AIRenOS Foundation

Status: **B44-FX-011 / Identity Adapter & Authenticated Principal Runtime — RUNTIME PASS, G4 PENDING R2 COMPLETION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

The current Foundation runtime now proves fail-closed Tenant/Location routing, provider-neutral authenticated principal construction from a verified signed credential, provider_subject → Identity resolution through a narrow `airen_auth` database boundary, membership/permission/entitlement enforcement, PostgreSQL RLS, persistent governed commands, and atomic mutation + Audit + Outbox.

B44-FX-011 closes the operational identity/authentication-adapter blocker at Foundation level. Production provider selection remains replaceable behind the adapter. G4 remains pending for environment/secrets runtime contract, observability baseline and deployment-path verification.

T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch.
