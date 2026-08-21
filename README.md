# AIRenOS Foundation

Status: **B44-FX-013 / Observability Baseline — CLOSED/PASS, G4 PENDING DEPLOYMENT PATH VERIFICATION**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers now include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, the typed fail-closed environment/secret-provider contract, and the provider-neutral observability baseline.

B44-FX-013 provides correlation/W3C trace context, structured logging with mandatory redaction, stable error taxonomy, low-cardinality metrics, health/readiness diagnostics and API runtime composition. Telemetry sinks remain replaceable and no telemetry vendor is selected by the Foundation contract.

Evidence lineage: runtime #177 PASS; exact closure commit `a4b6ced261126ab3db3646391b991101ff41f8e3`; closure CI #187 PASS; immutable snapshot #189 PASS with independently verified artifact/source digests; standard post-cleanup CI #199 PASS after removal of temporary snapshot tooling.

B44-FX-013 is CLOSED/PASS. G4 remains pending only for B44-FX-014 — Deployment Path Verification. T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch and `main` remains unchanged.
