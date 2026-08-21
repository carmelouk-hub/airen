# AIRenOS Foundation

Status: **B44-FX-012 / Environment & Secret Provider Runtime Contract — RUNTIME PASS, G4 PENDING R2 COMPLETION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

The current Foundation runtime proves fail-closed Tenant/Location routing, provider-neutral authenticated principal construction, provider_subject → Identity through the restricted `airen_auth` boundary, membership/permission/entitlement enforcement, PostgreSQL RLS, persistent governed commands, and atomic mutation + Audit + Outbox.

B44-FX-012 adds a typed fail-closed runtime environment contract, opaque `SecretRef` references, provider-neutral `SecretProvider`, provider/key allowlisting for the environment reference adapter, redacted secret material, redacted diagnostics, and API composition that consumes resolved secret values without returning them from the runtime object. Production-facing configuration rejects direct database/auth secret material.

The first B44-FX-012 CI attempt was blocked by the existing secret scanner on a protocol-literal false positive; the scanner was not weakened. The parser was rewritten to preserve the strict scan, and GitHub Actions run #137 passed application contracts, runtime-secret tests and PostgreSQL/RLS.

Identity/auth and environment/secret-provider blockers are now runtime-proven at Foundation level. G4 remains pending only for observability baseline and deployment-path verification.

T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch.
