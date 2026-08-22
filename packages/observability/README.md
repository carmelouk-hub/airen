# AIRenOS Foundation Observability

B44-FX-013 provider-neutral observability boundary.

This package owns correlation/trace context, structured log contracts and redaction, low-cardinality Foundation metrics, stable error classification, and health/readiness evaluation. It does not select a telemetry vendor and it does not own business truth, authorization decisions, AuditLog persistence, or secret resolution.

Non-negotiable rules:
- correlation and trace identifiers are propagated through trusted runtime context;
- log event names and metric labels are stable low-cardinality identifiers;
- raw secret material, credentials, bearer/session tokens and PII must not enter unredacted telemetry;
- error telemetry uses stable error codes/classes and does not serialize exception messages by default;
- Tenant/Location/correlation identifiers are prohibited as metric labels;
- readiness fails closed when a critical dependency fails and does not expose thrown exception detail;
- sinks remain provider-neutral adapters; no vendor SDK is part of the Foundation contract.

Audit and observability are complementary: Audit records governed business/security causality; telemetry explains runtime health and execution behavior. Neither substitutes for the other.
