# AIRenOS Runtime Adapter Blueprint v0.1

**Artifact class:** `GOVERNED_DESIGN_NOT_CANONICAL`  
**Milestone:** `AIRENOS-RUNTIME-ADAPTER-BLUEPRINT-001`  
**Date:** `2026-08-26`  
**Runtime implementation authorized:** `false`  
**Schema authorized:** `false`  
**Production publication authorized:** `false`

## 1. Purpose

Define the executable-design boundary for a future provider-neutral adapter between AIRenOS Foundation and replaceable experience layers such as RistoAIRen/Base44, without creating a route, connector, schema, provider dependency or runtime behavior.

This blueprint refines the already accepted typed exchange model:

- Foundation → Experience = `READ_ONLY_GOVERNED_PROJECTION`;
- Experience → Foundation = `ACTION_PROPOSAL_ONLY`.

It is a design artifact only. It does not grant runtime authority.

## 2. Non-negotiable authority boundary

AIRenOS Foundation remains authoritative for identity, Tenant, Location, membership, roles, permissions, entitlements, purpose authorization, domain state, idempotency, audit and outbox.

No experience provider may:

- assert trusted `tenant_id` or `location_id`;
- read Foundation source tables directly;
- write Foundation domain tables directly;
- convert a proposal into an authorization decision;
- create a default Tenant/Location fallback;
- bypass permission, entitlement or purpose evaluation;
- import provider SDKs into Foundation domain packages;
- execute STELLA proposals directly;
- persist a competing mutable copy of Foundation authority.

Any missing, expired, ambiguous or unverifiable authority fails closed.

## 3. Candidate transport boundary

Preferred first implementation candidate, subject to a later explicit implementation gate:

- application-level request/response over HTTPS;
- JSON typed envelopes;
- TLS required in every non-local environment;
- no direct database connectivity between experience provider and Foundation;
- no provider webhook may mutate a domain directly;
- asynchronous delivery, when later required, must terminate in a Foundation-controlled ingress that applies the same trust checks as synchronous ingress.

The transport is replaceable. Business/domain contracts must not depend on Base44, Vite, React, a particular HTTP framework or provider SDK.

## 4. Protocol versioning

Every exchange envelope must carry an explicit protocol version.

Candidate version identifier: `airen.exchange.v1`.

Rules:

1. Unknown major versions fail closed.
2. Minor-compatible additions may only add optional fields with defined defaults that do not weaken authority.
3. Field removal, semantic reinterpretation, authorization changes or trust-boundary changes require a new major version.
4. Providers must never infer meaning from unknown fields.
5. Foundation is the authoritative compatibility arbiter.
6. A protocol version cannot silently promote a design artifact into runtime authority.

## 5. Foundation → Experience projection

Mode: `READ_ONLY_GOVERNED_PROJECTION`.

Minimum envelope classes:

- `protocol_version`;
- `projection_id`;
- `projection_type`;
- `issued_at`;
- `expires_at`;
- `tenant_ref` as trusted opaque reference;
- optional trusted `location_ref` when scope requires it;
- `purpose_ref`;
- `authorization_ref`;
- `policy_version`;
- `correlation_id`;
- `data_classification`;
- minimized typed `payload`;
- `provenance_ref`;
- `integrity_ref` where required.

A projection is invalid when expired, scope-inconsistent, authorization-unverifiable, purpose-incompatible or structurally invalid.

Experience layers may cache only when a future approved policy explicitly permits it. Cache lifetime must never exceed projection expiry.

## 6. Experience → Foundation action proposal

Mode: `ACTION_PROPOSAL_ONLY`.

Minimum envelope classes:

- `protocol_version`;
- `proposal_id`;
- `proposal_type`;
- `created_at`;
- `actor_session_ref` or equivalent untrusted session reference for server-side resolution;
- `correlation_id`;
- `idempotency_key`;
- `purpose_ref` as requested purpose, never proof of authorization;
- minimized typed `payload`;
- `client_context` limited to non-authoritative UX/context metadata.

Forbidden proposal fields as authority claims:

- trusted `tenant_id`;
- trusted `location_id`;
- permission decision;
- entitlement decision;
- lawful-basis decision;
- authorization decision;
- audit identity;
- outbox/event authority;
- service-role credentials;
- provider secret material.

If Tenant/Location hints are ever carried for UX correlation, Foundation must ignore them as authority and resolve trusted scope independently.

## 7. Foundation execution pipeline

Every proposal that could produce a mutation must re-enter Foundation and preserve this exact order:

`validate input -> resolve actor -> resolve trusted Tenant/Location -> permission -> entitlement -> purpose authorization -> transaction -> domain validation -> idempotency -> audit -> outbox -> typed result`

No adapter may skip, reorder or satisfy these stages on behalf of Foundation.

## 8. Authentication and caller identity

The runtime implementation is not authorized, therefore no concrete credential or secret is created by this blueprint.

Candidate requirements for the future implementation gate:

- end-user identity must be resolved by Foundation through an accepted identity boundary;
- service-to-service caller identity must use a Foundation-approved credential mechanism with rotation and revocation;
- provider-side session data is input evidence only, never final identity authority;
- secrets must not be embedded in frontend bundles, repository files, projection payloads or logs;
- credential failure, expiry, revocation or ambiguity returns a typed denial.

## 9. Replay protection and idempotency

All mutation proposals require a client-generated opaque `idempotency_key` and a Foundation-owned idempotency decision.

Candidate invariants:

- key is scoped to resolved actor + trusted Tenant/Location + operation contract;
- same key + semantically identical request returns the previous typed result when policy permits;
- same key + different semantic payload fails closed as `IDEMPOTENCY_CONFLICT`;
- provider retries never bypass the Foundation idempotency store;
- timestamp alone is not replay protection;
- replay windows and storage durations remain unresolved until the implementation gate.

## 10. Timeouts, retries and failure behavior

Candidate design:

- each request has an explicit Foundation-controlled deadline;
- timeout never implies success;
- providers may retry only retry-safe requests and must reuse the same idempotency key for the same mutation intent;
- authorization denial is not retryable without a meaningful authority/state change;
- malformed input, version mismatch and scope ambiguity fail immediately;
- circuit-breaking may exist in adapters but cannot convert a denied/unavailable Foundation result into local success;
- offline mutation queues are forbidden until separately designed and approved.

Exact timeout values are intentionally unresolved.

## 11. Typed result and error model

Every response must be a typed result. Candidate top-level states:

- `SUCCESS`;
- `DENIED`;
- `INVALID`;
- `CONFLICT`;
- `UNAVAILABLE`;
- `RETRYABLE_FAILURE`.

Minimum result metadata:

- `protocol_version`;
- `result_type`;
- `correlation_id`;
- `request/proposal_ref`;
- `occurred_at`;
- typed `reason_code` when not successful;
- optional safe user-facing message key;
- `audit_ref` only when an audit record was actually created;
- no stack traces, tokens, secrets, SQL details or internal policy internals.

Default authorization result is `DENY`.

## 12. Correlation and traceability

Every boundary crossing carries a `correlation_id`.

Requirements:

- Foundation may replace or normalize untrusted inbound correlation values while preserving a linkage reference;
- correlation IDs are not authorization tokens;
- logs, audit and outbox records must support end-to-end reconstruction without exposing secret material;
- duplicate correlation IDs must not create domain authority or idempotency semantics.

## 13. Observability boundary

Future runtime must emit structured, privacy-minimized operational telemetry for:

- adapter request count and latency;
- protocol/version mismatch;
- typed denial/error classes;
- retry and idempotency conflicts;
- Foundation ingress availability;
- correlation coverage;
- projection expiry/rejection;
- policy/version distribution.

Observability must not become a shadow profile store. Raw personal payloads, secrets, authorization tokens and unrestricted prompts are forbidden in telemetry.

## 14. Data classes allowed across the boundary

Only explicitly typed and purpose-authorized minimized fields may cross.

Candidate allowed classes when separately authorized:

- `PUBLIC_METADATA`;
- minimized `TENANT_CONFIDENTIAL` projection fields;
- minimized `PERSONAL` fields under an approved purpose;
- `SECURITY_METADATA` references that reveal no secrets;
- purpose-specific `DERIVED_CLAIM` projections only with evidence, method, validity, contestability and authorization.

`SENSITIVE_COMPARTMENT` data requires its own explicit contract and is not authorized by this blueprint.

Always forbidden by this blueprint:

- raw database rows;
- unrestricted notes;
- raw prompts or raw conversation history;
- credentials, secrets or tokens;
- cross-Tenant enrichment payloads;
- universal customer/supplier profiles;
- protected/sensitive inferred traits;
- unrestricted event payloads;
- provider service-role authority.

## 15. Rollback and kill-switch design

Before any runtime implementation can be authorized, the adapter must have a Foundation-owned disable path.

Candidate requirements:

- feature flag or equivalent server-side gate defaults OFF before promotion;
- adapter can be disabled without changing domain data;
- disabling ingress cannot invalidate historical audit/outbox evidence;
- projection issuance can be stopped independently from mutation proposal ingestion;
- provider experience must fail closed/read-only when Foundation adapter capability is disabled;
- rollback must not require restoring Base44 as authority;
- no data migration may be coupled irreversibly to the adapter activation.

## 16. Deployment and environment separation

A future implementation must distinguish at least development/test, staging and production authority.

Rules:

- staging credentials/configuration cannot authorize production;
- synthetic fixtures cannot be promoted as production records;
- production publication remains a separate governance gate;
- Base44 preview/public visibility is not equivalent to AIRenOS runtime certification;
- a successful build or HTTP 200 does not prove security, authorization or production readiness.

## 17. Provider replacement requirement

The adapter design passes only if Base44 can be replaced by another experience provider without changing Foundation domain contracts.

Provider-specific concerns must remain outside Foundation Core, including SDKs, preview mechanisms, UI routing, provider auth/session helpers and provider-specific persistence.

## 18. Threat cases that must be tested before runtime authorization

At minimum:

1. forged Tenant hint;
2. forged Location hint;
3. unknown host/scope;
4. expired projection;
5. revoked authorization;
6. missing permission;
7. missing entitlement when applicable;
8. disabled/unapproved purpose;
9. replayed proposal;
10. idempotency key reused with different payload;
11. unsupported protocol major version;
12. malformed typed envelope;
13. leaked/invalid service credential;
14. provider retry storm;
15. Foundation timeout/unavailability;
16. cross-Tenant reference injection;
17. attempt to write from STELLA directly;
18. attempt to read source-domain tables from provider;
19. logging of secret/personal payloads;
20. adapter kill-switch activation and recovery.

These are design acceptance cases, not evidence that runtime tests have been executed.

## 19. Explicitly unresolved implementation decisions

The following remain open and must be decided by a separate implementation authorization:

- exact API paths and HTTP methods;
- exact framework/library;
- credential mechanism and rotation implementation;
- concrete service identity model;
- timeout/retry numeric values;
- idempotency persistence schema and retention;
- exact event/outbox payload versions;
- private Booking read/list contract;
- Booking permission grant matrix;
- Booking entitlement applicability/key;
- TenantContext canonical contract;
- production endpoint/domain;
- deployment topology;
- rate limits;
- observability backend;
- disaster recovery RTO/RPO;
- any `SENSITIVE_COMPARTMENT` contract.

No unresolved item may be inferred from Base44 forensic behavior.

## 20. Promotion gate

This blueprint may be reviewed, revised, accepted or rejected as governed design.

It does **not** authorize implementation.

A future runtime-adapter implementation milestone requires an explicit governance decision that freezes:

- exact scope;
- exact transport contract;
- exact security/authentication mechanism;
- exact typed protocol/version;
- exact test matrix;
- exact rollback/kill-switch;
- exact environment boundaries;
- exact evidence and parity requirements.

Until then:

`RUNTIME_ADAPTER_IMPLEMENTATION = BLOCKED`

`SCHEMA_CHANGE = BLOCKED`

`PRODUCTION_PUBLICATION = BLOCKED`
