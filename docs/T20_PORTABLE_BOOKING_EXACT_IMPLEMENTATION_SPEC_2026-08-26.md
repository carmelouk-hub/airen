# T20 Portable Booking — Exact Implementation Specification

**Milestone:** `T20-PORTABLE-BOOKING-EXACT-IMPLEMENTATION-SPEC-001`  
**Date:** `2026-08-26`  
**Artifact class:** `EXACT_IMPLEMENTATION_SPEC_NOT_RUNTIME_AUTHORIZATION`  
**State:** `SPECIFICATION_FROZEN_PENDING_ACCEPTANCE`

## Authorization boundary

This document is authorized by `T20-BOOKING-GOVERNANCE-DECISION-001` only to freeze the exact future implementation. It does not authorize runtime code, migration execution, Base44 runtime changes, production publication or T20 certification.

- Implementation specification: authorized.
- Runtime implementation: blocked.
- Schema/migration execution: blocked.
- Base44 runtime change: blocked.
- Production publication: blocked.
- T20 runtime tests executed by this specification: zero.

## 1. Existing implementation baseline

The future Slice-01 implementation must extend the repository that already exists rather than create a parallel stack:

- TypeScript / Node.js;
- PostgreSQL through `pg`;
- authenticated request boundary through existing `AuthenticationAdapter` + `requirePrincipal`;
- server-derived `SecurityContext` through `apps/api/src/security-context.ts`;
- vertical code under `packages/ristoairen`;
- PostgreSQL persistence under `packages/persistence-postgres`;
- API composition under `apps/api`.

AIRenOS Foundation remains authority. Base44 remains a replaceable experience provider.

## 2. Protocol and transport

Private Booking uses HTTPS and JSON with protocol `airen.exchange.v1`.

Required boundary metadata:

- `x-airen-correlation-id` for trace correlation;
- `idempotency-key` for mutations;
- `x-airen-deadline-ms` as a bounded client request hint, never authority;
- maximum request body: 64 KiB.

Unknown protocol major, malformed envelope, expired service assertion or unverifiable scope fails closed.

## 3. Exact private API surface

Base path: `/v1/ristoairen/bookings`.

### RST-F-BKG-007 — booking.private.query

`GET /v1/ristoairen/bookings`

Permission: `booking.read`.

Trusted active Tenant and Location are derived from `SecurityContext`; neither can be supplied as authority by query/body/header.

Allowed filters:

- repeatable `status` from canonical Booking states;
- `from_date` ISO local date inclusive;
- `to_date` ISO local date inclusive;
- opaque base64url `cursor`;
- `limit` 1..100, default 50;
- `order=starts_at.asc|starts_at.desc`, default ascending.

Cursor ordering is `(starts_at, id)` and the cursor encodes only the last emitted sort tuple plus protocol/query-shape version. Cursor contents are opaque to the caller and must be MAC/signature protected or otherwise tamper-evident at implementation time.

`GET /v1/ristoairen/bookings/{booking_id}` uses the same permission and trusted Location scope. Absent and foreign-scope resources both return `RESOURCE_NOT_FOUND_OR_NOT_VISIBLE`.

### RST-F-BKG-001 — booking.create

`POST /v1/ristoairen/bookings`

Permission: `booking.create`.

Idempotency required.

Client may submit only the approved Booking create DTO. `tenant_id`, `location_id`, `created_by_identity_id`, `starts_at` and initial status are server-derived. Initial status is `REQUESTED`.

### RST-F-BKG-002 — booking.update

`PATCH /v1/ristoairen/bookings/{booking_id}`

Permission: `booking.update`.

Idempotency required. Optimistic concurrency requires `row_version`.

Generic update cannot change status, Tenant, Location, creation provenance or protected authority fields.

### RST-F-BKG-003 — booking.status.transition

`POST /v1/ristoairen/bookings/{booking_id}/status-transitions`

Permission: `booking.status.update`.

Required input: `requested_status`, `row_version`. Optional: `reason`.

No generic `booking.update` permission implies this authority.

## 4. Booking private projection

The private DTO may expose the approved operational fields including Booking identifiers, lifecycle state, party size, date/time, source, customer snapshot contact fields, operational notes/requests, zone/table/event references, lifecycle timestamps and `row_version`.

The DTO does **not** expose raw persistence rows, `tenant_id`, `location_id`, service credentials, auth tokens or unrestricted metadata.

The omission of Tenant/Location from the DTO does not remove scope: scope is server-derived and enforced before projection.

## 5. Canonical lifecycle

States:

`REQUESTED`, `PENDING`, `CONFIRMED`, `ARRIVED`, `SEATED`, `COMPLETED`, `CANCELLED`, `NO_SHOW`.

Allowed transitions for Slice-01:

- REQUESTED → PENDING | CONFIRMED | CANCELLED
- PENDING → CONFIRMED | CANCELLED
- CONFIRMED → ARRIVED | CANCELLED | NO_SHOW
- ARRIVED → SEATED | CANCELLED
- SEATED → COMPLETED
- COMPLETED, CANCELLED, NO_SHOW are terminal in Slice-01.

Any transition outside this matrix fails `INVALID_STATE_TRANSITION` and creates no state change.

## 6. Exact PostgreSQL Booking design

Target table: `risto_bookings`.

Primary key: UUID.

Required scope fields: UUID `tenant_id`, UUID `location_id`.

The table implements all DOC-008 Booking target fields needed by Slice-01 plus server provenance, optimistic concurrency and environment classification.

Key implementation choices:

- `starts_at` and lifecycle instants use `timestamptz`;
- civil booking date uses `date` and local booking time uses `time`;
- `party_size` is integer > 0 and <= 1000;
- expected duration is 15..1440 minutes;
- state is constrained to the canonical lifecycle values;
- `row_version bigint not null default 1` increments on every successful mutation;
- no normal hard-delete operation exists;
- `environment_class` is one of PRODUCTION, DEMO, SANDBOX, TEST_TEMPORARY.

Minimum indexes:

- `(tenant_id, location_id, status)`;
- `(tenant_id, location_id, starts_at, id)`;
- `(tenant_id, location_id, booking_date, booking_time_local, id)`;
- partial `(tenant_id, location_id, external_reference)` when external reference is not null.

All optional parent references must be validated same-Tenant before mutation; Location-aware parents also require same-Location validation.

## 7. Migration and rollback design

Forward migration path:

`packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql`

Rollback path:

`packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.rollback.sql`

The forward migration is first permitted only against an isolated T20 database after a separate runtime-implementation authorization. It must create the table/indexes, enable and FORCE RLS before T20 fixtures are inserted, and must not migrate Base44/Corte production data.

Rollback is pre-production only and must refuse destructive execution if non-test rows exist. T20 fixtures must be deterministically cleaned first.

## 8. RLS design

`risto_bookings` has RLS enabled and forced.

Request-scoped PostgreSQL settings:

- `app.tenant_id`
- `app.location_id`
- `app.identity_id`
- `app.correlation_id`

Baseline policy:

`tenant_id = current_setting('app.tenant_id')::uuid AND location_id = current_setting('app.location_id')::uuid`

The same predicate applies to `USING` and `WITH CHECK`.

RLS is defense-in-depth. It does not replace application permission/state/parent validation, and application authorization does not replace RLS.

No unscoped provider/service-role access is allowed.

## 9. Authentication and service identity

End-user identity continues to use the existing Foundation `AuthenticationAdapter`, `requirePrincipal`, hostname/Tenant/Location resolution and server-derived `SecurityContext`.

For a future server-side experience adapter, service identity uses a short-lived asymmetric service assertion:

- JWT;
- EdDSA;
- required claims: `iss`, `sub`, `aud`, `iat`, `exp`, `jti`, `kid`;
- audience: `airenos-foundation`;
- maximum TTL: 300 seconds;
- clock skew: 30 seconds;
- Foundation owns the public-key registry;
- provider private key stays only in the provider secret manager;
- key rotation overlaps old/new `kid` for at most 15 minutes;
- disabling a key in the Foundation registry fails closed immediately.

A valid service assertion authenticates only the calling service. It never grants Tenant, Location, user permission or Booking authority.

## 10. Idempotency and replay

Durable Foundation-owned idempotency applies to `RST-F-BKG-001`, `002`, `003`.

Target store: `foundation_idempotency_keys` implemented through `packages/persistence-postgres/src/idempotency-control-plane.ts`.

Scope:

`actor_identity_id + tenant_id + location_id + canonical_function_id + idempotency_key`.

Semantic request hash: SHA-256 of canonical JSON after server normalization.

Retention: 72 hours. In-progress lease: 30 seconds.

Same key + same semantic request returns the stored typed result. Same key + different request returns `IDEMPOTENCY_CONFLICT`. Concurrent execution has exactly one winner through a unique scoped key; competitors see IN_PROGRESS or the committed stored result.

Timestamp alone is never replay protection.

## 11. Timeout, retry and rate limits

Foundation deadlines:

- query: 5,000 ms;
- mutation: 8,000 ms.

Experience client timeouts:

- query: 6,000 ms;
- mutation: 9,000 ms.

Queries may retry at most twice on network error / 502 / 503 / 504 using exponential backoff approximately 150 ms then 450 ms plus jitter.

Mutations may retry at most twice only on the same retryable transport conditions and must reuse the identical idempotency key and semantic payload.

400/401/403/404/409/422 are not automatically retried. Timeout never means success.

Rate-limit scope combines verified service identity, resolved user identity, trusted Tenant and trusted Location.

- queries: 120/minute;
- mutations: 60/minute;
- burst: 20.

Limit response is typed HTTP 429 / `RETRYABLE_FAILURE` with `retry_after_ms`. Rate limiting is not authorization.

## 12. Audit and transactional outbox

Required audit names:

- BOOKING_CREATED
- BOOKING_UPDATED
- BOOKING_STATUS_CHANGED

Reserved outbox names:

- `booking.created.v1`
- `booking.updated.v1`
- `booking.status_changed.v1`

Audit and outbox are committed in the same domain transaction as the successful mutation. Failure to persist mandatory audit/outbox evidence causes the mutation transaction to fail.

Outbox payloads are minimized and contain identifiers/scope, status/change metadata, event time and correlation. They do not contain phone, email, notes, special requests, secrets, tokens or raw headers.

## 13. Observability

Use the existing `packages/observability` abstraction. No Base44/provider observability SDK enters domain code.

Required telemetry fields include timestamp, service, operation, result type, reason code, latency, correlation ID, protocol version and hashed Tenant/Location references.

PII snapshots, notes, special requests, Authorization headers, service assertions and raw bodies are forbidden from telemetry.

## 14. Kill switches

Foundation owns all switches. Defaults are OFF:

- `RISTOAIREN_BOOKING_ADAPTER_ENABLED=false`
- `RISTOAIREN_BOOKING_PROJECTION_ENABLED=false`
- `RISTOAIREN_BOOKING_MUTATION_ENABLED=false`

Projection and mutation can be disabled independently. Disabled mutation never falls back to local/provider success.

## 15. Environment separation and DR

Test, staging and production use separate databases, service-key registries and credentials.

T20 synthetic rows use `TEST_TEMPORARY`. Corte delle Stelle production is never a destructive T20 fixture.

Design targets:

- staging RPO 60 min / RTO 120 min;
- production target RPO 15 min / RTO 60 min.

Production targets remain non-certified until backup/restore and operational DR are separately validated.

## 16. Exact future implementation paths

New files authorized only by a later runtime implementation gate:

- `packages/ristoairen/src/booking/contracts.ts`
- `packages/ristoairen/src/booking/application-service.ts`
- `packages/ristoairen/src/booking/policy.ts`
- `packages/ristoairen/src/booking/index.ts`
- `packages/persistence-postgres/src/risto-booking-repository.ts`
- `packages/persistence-postgres/src/idempotency-control-plane.ts`
- `packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.sql`
- `packages/persistence-postgres/src/migrations/20260826_001_risto_bookings.rollback.sql`
- `apps/api/src/ristoairen-booking-api.ts`
- `tests/integration/t20-booking-contract.test.ts`
- `tests/postgres/t20-booking-runtime.test.ts`
- `tests/postgres/t20-booking-security.test.ts`
- `tests/helpers/t20-booking-fixtures.ts`
- `tests/postgres/t20-booking-cleanup.test.ts`

Existing files that a later bounded gate may modify:

- `packages/ristoairen/src/index.ts`
- `packages/persistence-postgres/src/index.ts`
- `apps/api/src/server.ts`
- `.github/workflows/ci.yml`
- `package.json`

Base44 app source, platform-core, certified R3 branch and `main` are outside this bounded manifest.

## 17. T20 evidence contract

T20 still requires the complete 66-test certification contract. The future implementation must prove positive use plus denial/isolation behavior including unauthenticated requests, permission denial, cross-Tenant and cross-Location access, client scope spoofing, status bypass, invalid transitions, duplicate idempotency, semantic idempotency conflict, direct RLS defense, expired/revoked service assertions, rate limits, kill switches, audit/outbox and deterministic cleanup with zero residue/orphans.

Fixture topology remains:

- Tenant A → Location A1, A2
- Tenant B → Location B1
- canonical operational role: `responsabile`

## 18. Promotion gate

This specification can become `PASS_EXACT_IMPLEMENTATION_SPEC` only after machine acceptance and dual-source read-back.

Even after PASS:

`RUNTIME_IMPLEMENTATION_AUTHORIZED = false`

`SCHEMA_EXECUTION_AUTHORIZED = false`

`PRODUCTION_PUBLICATION = false`

The next possible activity is a separate explicit **bounded T20 runtime implementation authorization**. No implementation may begin merely because this document is accepted.
