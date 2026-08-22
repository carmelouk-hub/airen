# AIRenOS Foundation

Status: **B44-FX-014 / Deployment Path Verification — RUNTIME PASS, CLOSURE CI & ARCHIVE PENDING; G4 PENDING FINAL R2 RECONCILIATION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers already include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, the typed fail-closed environment/secret-provider contract, and the provider-neutral observability baseline.

B44-FX-014 proves a provider-neutral OCI deployment unit, locked dependency resolution, a non-root API runtime, fail-closed deployment configuration, source-controlled PostgreSQL runtime group-role bootstrap, checksum-guarded atomic migration execution, idempotent redeploy, liveness/readiness endpoints, least-privilege runtime-role verification, structured observability wiring, degraded-candidate detection and a mechanical rollback rehearsal to the exact known-good image identity.

Evidence lineage is preserved: #241 exposed and isolated a migration-wrapper parser defect after OCI build PASS; the parser was reconciled without weakening migration atomicity. #243 then passed all runtime gates. #245 generated the versioned npm lockfile from GitHub Actions. Definitive lockfile-reproducible runtime evidence is #251 / ID 32581856143: application contracts PASS, PostgreSQL/RLS PASS and deployment-path runtime PASS with `npm ci`-locked dependencies.

B44-FX-014 is not yet formally CLOSED/PASS until closure CI and immutable 04.3 archive reconciliation are complete. Once archived, the deployment-path blocker list is empty, but G4 itself still requires a separate R2 Foundation Completion Reconciliation before it may be declared PASS.

T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch and `main` remains unchanged. Production hosting, authentication, secret-manager and telemetry provider selections remain TBD behind provider-neutral interfaces.
