# AIRenOS Foundation

Status: **B44-FX-014 / Deployment Path Verification — IMPLEMENTED, RUNTIME EVIDENCE PENDING; G4 PENDING FINAL R2 RECONCILIATION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers already include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, the typed fail-closed environment/secret-provider contract, and the provider-neutral observability baseline.

B44-FX-014 adds the final G4 Foundation blocker implementation: a provider-neutral OCI deployment unit, a non-root API runtime, fail-closed deployment configuration, source-controlled PostgreSQL runtime group-role bootstrap, checksum-guarded atomic migration execution, liveness/readiness endpoints, least-privilege runtime-role verification, structured observability wiring, degraded-candidate detection and a mechanical rollback rehearsal to the exact known-good image identity.

The new deployment contract test and full OCI deployment rehearsal are part of GitHub Actions. B44-FX-014 is not CLOSED/PASS and G4 is not PASS until the deployment runtime job succeeds together with the existing application-contract and PostgreSQL/RLS suites, followed by closure/archive reconciliation.

T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch and `main` remains unchanged. Production hosting, authentication, secret-manager and telemetry provider selections remain TBD behind provider-neutral interfaces.
