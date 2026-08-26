# T20 Portable Booking — Governance Decision Gate

**Gate:** `T20-BOOKING-GOVERNANCE-DECISION-001`  
**Date:** `2026-08-26`  
**Artifact class:** `GOVERNANCE_DECISION_FOR_IMPLEMENTATION_SPEC`  
**State:** `ACCEPTED_FOR_IMPLEMENTATION_SPEC_ONLY`  
**Runtime implementation authorized:** `false`  
**Schema/migration execution authorized:** `false`  
**Production publication authorized:** `false`

## 1. Purpose

Resolve the governance decisions that blocked preparation of an exact T20 Portable Booking implementation specification, while preserving the certified R3 boundary and without implementing runtime code, schema, migrations, Base44 resources, fixtures or executable T20 runtime tests.

This decision consumes the existing T20 Portable Booking exact census and the unapproved 13-gap decision packet. It does not retroactively claim T20 runtime PASS.

## 2. Authority and non-regression

The following remain non-negotiable:

- AIRenOS Foundation is authority for identity, Tenant, Location, product access, permissions, entitlements, idempotency, audit and outbox.
- Client/provider Tenant and Location values are never authority.
- `SecurityContext` is server-derived.
- no default Tenant, default Location or unknown-host fallback exists;
- Base44 remains a replaceable experience/provider boundary, not Foundation authority;
- STELLA has no direct Booking write path;
- PR #4 remains OPEN / DRAFT / UNMERGED;
- runtime, schema and production remain blocked until separately authorized.

## 3. Decision status vocabulary

- `ACCEPTED` — governance semantics are frozen for the next implementation-spec phase.
- `ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING` — governance direction is frozen, but exact technical realization must be defined and tested in the implementation specification before any code write.
- `REJECTED` — candidate must not be used.

## 4. GAP decisions

### GAP-001 — Private Booking read/list contract

**Decision: ACCEPTED.**

Canonical candidate ID reserved for the implementation specification:

`RST-F-BKG-007 booking.private.query`

Rationale: DOC-010 already allocates `RST-F-BKG-006` to `booking.checkin`; therefore `006` must not be reused.

Contract class: `BF-C1 QUERY`.

Required permission: `booking.read`.

Trusted scope for T20 Slice-01:

- authenticated `SecurityContext` required;
- `active_tenant_id` server-derived and required;
- `active_location_id` server-derived and required for the Slice-01 location-scoped query;
- foreign Tenant/Location hints are ignored as authority and cannot broaden scope.

Allowed request semantics for the implementation specification:

- bounded date/time range;
- optional `booking_id` exact filter;
- optional status filter;
- optional customer reference/search token only where the caller is authorized to see the resulting projection;
- cursor-based pagination;
- server-bounded page size;
- deterministic server-defined ordering.

Output is a minimized typed Booking projection, never a raw persistence row. Foreign-scope objects are indistinguishable from not-visible resources. Empty list is a successful empty collection. An exact `booking_id` that is absent or invisible returns `RESOURCE_NOT_FOUND_OR_NOT_VISIBLE`.

The implementation specification must freeze exact DTO fields, cursor encoding, maximum page size, default ordering and date-range bounds before runtime work.

### GAP-002 — Exact permission for `RST-F-BKG-003`

**Decision: ACCEPTED.**

`RST-F-BKG-003 booking.status.transition` requires `booking.status.update`.

`booking.update` remains the permission for general editable Booking fields and does not imply status-transition authority.

### GAP-003 — Exact role grants and role key

**Decision: ACCEPTED.**

Slice-01 grant matrix:

- `tenant_admin`: `booking.read`, `booking.create`, `booking.update`, `booking.status.update`;
- `manager`: `booking.read`, `booking.create`, `booking.update`, `booking.status.update`;
- `responsabile`: `booking.read`, `booking.status.update` only.

For this slice, the accepted role key is `responsabile`.

`responsabile_cucina` is **REJECTED as an implicit alias**. No runtime may silently normalize one into the other. A future alias or specialist-role mapping requires an explicit RBAC decision and tests.

### GAP-004 — Entitlement applicability and key

**Decision: ACCEPTED.**

There is **no separate Booking-specific feature entitlement for T20 Slice-01**.

The actor must still have valid AIRenOS product access for `ristoairen`, and all permission and scope checks remain mandatory. `required_entitlement` for the Slice-01 Booking functions is therefore `NOT_APPLICABLE` beyond product-access eligibility.

The incomplete/example key `risto.booking` is **REJECTED as authority** and must not be implemented.

Any future commercial Booking add-on or entitlement requires a new explicit governance decision and cannot silently alter this Slice-01 contract.

### GAP-005 — Application context contract

**Decision: ACCEPTED.**

`RistoApplicationService` uses the existing server-derived `SecurityContext` contract. A separate `TenantContext` type is not required for T20 Slice-01 and must not be invented merely to satisfy a local implementation shape.

The implementation may introduce internal narrowed views/adapters of `SecurityContext` only if they cannot add authority and remain derivable from the canonical server context.

### GAP-006 — SQL schema and migration

**Decision: ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING.**

The next implementation-spec phase is authorized to design the exact Booking persistence schema, constraints, indexes, foreign keys, migration ordering and rollback plan from DOC-008 semantics.

This decision does **not** authorize applying a schema or migration.

The specification must prove:

- Tenant scoping on every Booking row;
- Location scoping where required;
- same-Tenant/same-Location parent integrity;
- state-transition protection through the application-service boundary;
- migration reversibility or a documented safe-forward strategy;
- no provider-specific authority field.

### GAP-007 — Booking idempotency

**Decision: ACCEPTED.**

Durable Foundation-owned idempotency is required for `RST-F-BKG-001`, `RST-F-BKG-002` and `RST-F-BKG-003`.

Semantic scope of a key:

`resolved actor + trusted Tenant + trusted Location + canonical function + idempotency key`.

Rules:

- same scope/key + semantically identical request returns the prior typed result when safe;
- same scope/key + semantically different payload returns `IDEMPOTENCY_CONFLICT`;
- provider/client retries cannot bypass the Foundation idempotency decision;
- timestamps alone are not replay protection.

Exact key syntax, retention period, in-progress concurrency behavior, persistence layout and replay-result retention are delegated to the implementation specification and must be frozen before runtime implementation.

### GAP-008 — Typed audit and outbox mapping

**Decision: ACCEPTED.**

Existing audit events are retained:

- `BOOKING_CREATED`;
- `BOOKING_UPDATED`;
- `BOOKING_STATUS_CHANGED`.

Version-1 outbox event names reserved for the implementation specification:

- `booking.created.v1`;
- `booking.updated.v1`;
- `booking.status_changed.v1`.

Audit/outbox payloads must be minimized, typed, Tenant/Location scoped, correlation-linked and secret-free. They may carry identifiers and approved operational fields but never credentials, tokens, unrestricted notes, raw provider payloads or cross-Tenant data.

The implementation specification must freeze the exact payload schemas and redaction rules before code.

### GAP-009 — Persistence store and RLS

**Decision: ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING.**

T20 Slice-01 persistence must preserve both server-side authorization and RLS defense-in-depth. RLS is not a substitute for application authorization and application authorization is not a substitute for RLS.

The implementation specification must define the exact persistence adapter and policies only after the Booking schema, `SecurityContext`, grants and read contract are represented machine-readably.

No schema or RLS policy is activated by this decision.

### GAP-010 — Private API and DTO

**Decision: ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING.**

The private API/adapter surface must derive from `RST-F-BKG-007 booking.private.query` and the typed-exchange/runtime-adapter blueprint. It must not expose raw domain/persistence rows and must not accept Tenant/Location as authority.

Exact HTTP path, method, DTO field names, timeout values and transport adapter are delegated to the implementation specification. They must be frozen and threat-tested before runtime authorization.

### GAP-011 — Authenticated fixtures, tests and cleanup

**Decision: ACCEPTED.**

Required synthetic topology remains:

- Tenant A;
- Location A1;
- Location A2;
- Tenant B;
- Location B1.

The canonical Slice-01 operational role key in the fixture is `responsabile`.

T20 evidence requires real authenticated/server-resolved session behavior, deterministic run/correlation identifiers, audit/outbox evidence where expected, deterministic cleanup and residue/orphan checks. No production Tenant or Corte delle Stelle data may be used as a destructive fixture.

### GAP-012 — Local forensic source files

**Decision: ACCEPTED.**

Registered Base44 artifacts are reference/transformation evidence, not an implementation prerequisite and not target authority.

Source bytes are materialized only when an explicit parity/forensic investigation requires them; any such materialization requires hash/provenance verification.

### GAP-013 — Exact implementation file paths

**Decision: ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING.**

Exact new Booking implementation paths are assigned by the post-gate implementation specification after repository-topology reconciliation. Existing Base44 paths or forensic filenames must not be copied as authority.

The implementation specification must publish a bounded write manifest before any implementation starts.

## 5. Runtime-adapter decisions carried into the implementation specification

The accepted runtime-adapter blueprint remains controlling design input.

The implementation specification must freeze, but this governance gate does not itself instantiate:

- exact HTTP paths/methods;
- service-to-service/end-user authentication mechanism and credential rotation/revocation behavior;
- protocol envelope mapping to `airen.exchange.v1`;
- timeout and retry numeric policy;
- idempotency storage and retention;
- exact audit/outbox schemas;
- rate limits/abuse controls;
- observability backend and privacy-minimized telemetry fields;
- kill-switch implementation defaulting OFF;
- environment separation and production endpoint/domain;
- rollback and disaster-recovery behavior.

No concrete secret, credential, connector or production endpoint may be created during the implementation-spec phase.

## 6. T20 state after this gate

The governance blockers above are considered resolved sufficiently to **author an exact implementation specification**.

This does not mean the runtime exists and does not change the T20 certification verdict to PASS.

State after gate:

- `GOVERNANCE_DECISIONS_FOR_IMPLEMENTATION_SPEC = ACCEPTED`;
- `IMPLEMENTATION_SPEC_AUTHORIZED = true`;
- `RUNTIME_IMPLEMENTATION_AUTHORIZED = false`;
- `SCHEMA_EXECUTION_AUTHORIZED = false`;
- `T20_RUNTIME_TESTS_EXECUTED = 0` until separately proven otherwise;
- `T20_CERTIFICATION = INCOMPLETE`;
- `PRODUCTION_PUBLICATION = BLOCKED`.

## 7. Next gate

The only next authorized activity is preparation and acceptance testing of the **T20 Portable Booking Exact Implementation Specification**.

That specification must convert every `ACCEPTED_WITH_IMPLEMENTATION_DETAIL_PENDING` item into exact machine-testable contracts and produce a bounded write manifest.

No runtime code, schema migration, Base44 entity/function, connector, secret or production publication is authorized by this decision.
