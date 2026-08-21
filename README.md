# AIRenOS Foundation

Status: **B44-FX-013 / Observability Baseline — RUNTIME PASS, CLOSURE/ARCHIVE PENDING, G4 PENDING R2 COMPLETION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, and the typed fail-closed environment/secret-provider contract. B44-FX-012 is CLOSED/PASS with immutable 04.3 archive and post-cleanup CI #155 PASS.

B44-FX-013 implements a provider-neutral observability baseline: correlation/W3C trace context, structured logging with mandatory redaction, stable error taxonomy, low-cardinality metrics, health/readiness diagnostics and API runtime composition. Telemetry sinks remain replaceable and no telemetry vendor is selected by the Foundation contract.

GitHub Actions run #177 / ID 32509849518 passed the complete application suite including `test:observability` and also passed PostgreSQL/RLS. The observability blocker is therefore runtime-proven, but the milestone is not formally CLOSED until exact closure-commit CI, immutable 04.3 snapshot, Bible/DOC-000 reconciliation and standard post-cleanup CI are complete.

After formal B44-FX-013 closure, G4 will remain pending only for deployment-path verification. T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch.
