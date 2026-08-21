# AIRenOS Foundation

Status: **B44-FX-013 / Observability Baseline — RUNTIME & CLOSURE PASS, IMMUTABLE ARCHIVE COMPLETE, POST-CLEANUP CI PENDING**

AIRenOS Foundation is the governed portable target outside Base44. The repository preserves the 2025 prototype as legacy and builds from the Platform Bible, forensic snapshots, B44-FX-004 mapping and B44-FX-005 ADRs.

Closed Foundation runtime blockers include provider-neutral authenticated principal construction, PostgreSQL/RLS governed persistence, and the typed fail-closed environment/secret-provider contract. B44-FX-012 is CLOSED/PASS with immutable 04.3 archive and post-cleanup CI #155 PASS.

B44-FX-013 implements a provider-neutral observability baseline: correlation/W3C trace context, structured logging with mandatory redaction, stable error taxonomy, low-cardinality metrics, health/readiness diagnostics and API runtime composition. Telemetry sinks remain replaceable and no telemetry vendor is selected by the Foundation contract.

Runtime evidence #177 / ID 32509849518 is PASS. Exact closure commit `a4b6ced261126ab3db3646391b991101ff41f8e3` passed closure CI #187 / ID 32510040099. Snapshot generation #189 / ID 32510154448 is PASS; the artifact and exact source archive digests were independently verified and archived in Google Drive 04.3.

The temporary snapshot job has been removed. B44-FX-013 is waiting only for the standard post-cleanup CI on the reconciled repository before final CLOSED/PASS status.

After formal B44-FX-013 closure, G4 will remain pending only for deployment-path verification. T20, Golden Restaurant E2E and Corte migration remain separate later gates. Corte delle Stelle production is not modified by this branch.
