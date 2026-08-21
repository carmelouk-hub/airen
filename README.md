# AIRenOS Foundation

Status: **B44-FX-013 / Observability Baseline — IMPLEMENTED, RUNTIME EVIDENCE PENDING, G4 PENDING R2 COMPLETION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers now include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, and the typed fail-closed environment/secret-provider contract. B44-FX-012 is CLOSED/PASS with immutable 04.3 archive and post-cleanup CI #155 PASS.

B44-FX-013 implements a provider-neutral observability baseline: correlation/W3C trace context, structured logging with mandatory redaction, stable error taxonomy, low-cardinality metrics, health/readiness diagnostics and API runtime composition. Telemetry sinks remain replaceable and no telemetry vendor is selected by the Foundation contract.

The new observability tests are part of the application CI gate. B44-FX-013 is not CLOSED/PASS until GitHub Actions runtime evidence confirms the new tests together with the existing Foundation and PostgreSQL/RLS suites.

G4 remains pending for observability runtime evidence and deployment-path verification. T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch.
