AIREN BOOKING CHANNEL HUB + AIRENPAY — CANONICAL DESIGN v0.1
Date: 2026-08-29
Artifact class: GOVERNED_CANONICAL_DESIGN
Project: AIRenOS / RISTOAIREN
Protocol: RULE-DOC-20 + RULE-DOC-21
Runtime implementation sequence authorized: YES, gate-by-gate
Current mutation activation authorized: NO
Production cutover authorized: NO
Protected R3/main modification authorized: NO

1. PURPOSE

This document freezes the canonical architecture for extending the existing AIRenOS Booking authority into a provider-neutral reservation Channel Hub and a provider-neutral payment/guarantee orchestration layer named AIRenPay.

The objective is that every reservation, regardless of origin, converges into one AIRenOS Booking Core authority. External marketplaces, Google reservation surfaces, direct web, telephone, WhatsApp, concierge, walk-in and future channels may originate or synchronize booking intent, but none becomes a competing source of truth.

AIRenPay is defined as:
AIRenPay — Payment, Guarantee & Transaction Orchestration Hub.

AIRenPay initially orchestrates regulated payment providers; it is not itself a payment processor, acquirer or PSP. The design deliberately minimizes PCI/payment-data scope by keeping PAN, CVV and equivalent sensitive credentials within the selected authorized provider.

This design is generic enough to support future bookable resources such as tables, rooms, spa slots, beach beds, transfers, appointments, events and other services, while the first governed implementation remains RISTOAIREN Booking.

2. AUTHORITY BOUNDARY — NON-NEGOTIABLE

AIRenOS remains authoritative for:
- Identity and authenticated actor resolution;
- Tenant and Location scope;
- membership, roles and permissions;
- entitlements and purpose authorization;
- canonical Booking and BookingHold state;
- availability/capacity decisions;
- idempotency;
- audit trail;
- outbox/domain events;
- channel reconciliation decisions;
- guarantee policy evaluation;
- conversion of a hold into a Booking.

No external channel, provider SDK, webhook, Base44 experience layer or payment provider may:
- write AIRenOS domain tables directly;
- assert trusted tenant_id or location_id;
- bypass availability or capacity policy;
- bypass membership/permission/entitlement checks;
- create a Booking as a side effect outside the canonical Booking service;
- treat a payment-provider success as sufficient authority to invent a Booking;
- store a competing mutable booking ledger;
- expose provider private credentials in a frontend bundle, repository or log;
- silently overwrite a canonical booking due to external state divergence.

Provider payloads are evidence/input. AIRenOS makes the final domain decision.

3. CANONICAL SYSTEM VIEW

Inbound sources:
- DIRECT_WEB
- PHONE
- WALK_IN
- WHATSAPP
- CONCIERGE
- GOOGLE
- OPENTABLE
- THEFORK
- FUTURE_PROVIDER

Canonical flow:
Channel / assisted source
→ Channel Adapter or Direct Booking Adapter
→ authenticated Foundation ingress
→ normalization
→ idempotency / replay protection
→ tenant/location resolution
→ availability / allocation evaluation
→ BookingHold when required
→ BookingGuaranteePolicy
→ AIRenPay when a guarantee/payment is required
→ canonical Booking Core
→ audit + outbox
→ outbound channel synchronization / reconciliation.

Base44 remains an Experience Layer. It does not become a channel authority or payment authority.

4. BOOKING CORE PRESERVATION

The existing Booking lifecycle is preserved. HOLD is not added to BOOKING_STATUSES.

Existing canonical Booking statuses remain:
REQUESTED
PENDING
CONFIRMED
ARRIVED
SEATED
COMPLETED
CANCELLED
NO_SHOW

A prebooking/temporary reservation is modeled separately through BookingHold. This prevents transient checkout/payment state from contaminating the business lifecycle of an actual Booking.

5. BOOKINGHOLD DOMAIN

BookingHold represents a temporary, expiring claim on availability while the caller completes any required guarantee or payment step.

Minimum canonical fields/classes:
- id
- tenant_id
- location_id
- actor_identity_id or trusted originating principal reference
- source_channel
- source_external_reference when applicable
- requested service/resource class
- booking date/time window
- party_size / quantity
- capacity claim
- status
- created_at
- expires_at
- guarantee_policy_ref
- guarantee_ref when created
- conversion_booking_id when converted
- idempotency scope/reference
- correlation_id
- row_version
- audit metadata

Canonical BookingHold states:
CREATED
GUARANTEE_REQUIRED
GUARANTEE_PENDING
GUARANTEED
CONVERTED
EXPIRED
CANCELLED
FAILED

Required transitions:
CREATED → GUARANTEE_REQUIRED when policy requires financial/card assurance.
CREATED → GUARANTEED when no financial action is required and the policy permits immediate guarantee.
GUARANTEE_REQUIRED → GUARANTEE_PENDING when AIRenPay/provider interaction begins.
GUARANTEE_PENDING → GUARANTEED only after a verified provider outcome that satisfies policy.
GUARANTEED → CONVERTED only through the canonical Booking service inside a governed transaction.
Any non-converted hold may transition to EXPIRED when expires_at is reached.
Operator/user cancellation may transition an eligible hold to CANCELLED.
Provider or internal terminal failure may transition an eligible hold to FAILED.

Conversion must be idempotent. A converted hold cannot create a second Booking.

6. CAPACITY LOCKING AND OVERBOOKING PREVENTION

BookingHold must reserve capacity atomically. Two concurrent requests must never both succeed if together they exceed trusted availability.

The implementation gate must prove:
- capacity check and hold claim occur within one transactional authority boundary;
- expiry releases capacity deterministically;
- failed guarantee releases capacity when policy requires;
- conversion replaces the transient hold claim with canonical Booking capacity without a gap/double-count window;
- retrying the same request with the same idempotency key does not allocate capacity twice;
- channel adapters cannot bypass the hold/capacity service.

Exact database locking mechanics remain an implementation detail, but the atomicity invariant is canonical.

7. BOOKING GUARANTEE POLICY

BookingGuaranteePolicy is tenant/location scoped and deterministic.

It evaluates contextual inputs such as:
- channel/source;
- service/resource class;
- date and day-of-week;
- service period/time slot;
- event/special date;
- party size/quantity;
- booking lead time;
- customer/relationship classification when explicitly authorized;
- configured no-show risk policy;
- tenant commercial rules.

Canonical guarantee modes:
NONE
PAYMENT_METHOD_GUARANTEE
DEPOSIT
FULL_PREPAYMENT
AUTHORIZATION_HOLD

Examples of tenant policy are permitted but not hard-coded: no guarantee for a small lunch booking, card guarantee for dinner, per-person deposit for groups, full prepayment for an event, or a different rule for a special date.

AI may later recommend a guarantee mode/risk score, but only deterministic policy may authorize the resulting requirement.

8. AIRENPAY — CANONICAL ROLE

AIRenPay is a provider-neutral orchestration boundary.

AIRenPay responsibilities:
- evaluate the already-selected guarantee mode;
- select the tenant-authorized payment gateway connection;
- create provider-side setup/payment/authorization flows;
- track orchestration state;
- verify signed provider webhooks/events;
- normalize provider outcomes;
- request capture, void/release or refund through provider adapters where authorized;
- expose a typed guarantee result to BookingHold/Booking Core;
- produce audit/outbox evidence;
- reconcile asynchronous provider state.

AIRenPay must not:
- receive/store PAN or CVV in AIRenOS databases/logs;
- become a card vault when the provider offers tokenization;
- treat frontend redirect completion as proof of payment;
- trust an unverified webhook;
- capture funds without an explicit policy/authorized command;
- use a platform-wide tenant-agnostic secret where a tenant-specific gateway connection is required.

9. PAYMENT GATEWAY PORT

Canonical provider-neutral operations are conceptual contracts, not provider API names:
- createPaymentMethodSetup()
- createDepositPayment()
- createFullPrepayment()
- createAuthorizationHold()
- captureAuthorization()
- releaseAuthorization()
- refundPayment()
- getTransactionStatus()
- verifyAndNormalizeWebhook()

Provider adapters translate these contracts to Stripe, Nexi, Adyen, PayPal, Worldline, SumUp or future providers.

Provider-specific fields must not leak into the Booking domain contract except inside an opaque provider_metadata boundary designed for diagnostics/reconciliation.

10. AIRENPAY DATA MODEL BOUNDARY

TenantPaymentGatewayConnection:
- id
- tenant_id
- optional location_id
- provider_type
- provider_account_reference
- enabled capabilities
- mode TEST/LIVE
- secret_reference only, never plaintext secret
- webhook configuration reference
- status
- created/updated audit metadata.

AIRenPayGuarantee / PaymentOrchestration minimum classes:
- id
- tenant_id/location_id
- booking_hold_id and/or booking_id
- guarantee_mode
- provider_type
- provider_connection_id
- provider_customer_reference when applicable
- provider_payment_method_reference when applicable
- provider_setup/payment/authorization reference
- amount and currency when applicable
- orchestration_status
- authorization_expires_at when applicable
- paid/authorized/captured/refunded/released timestamps when applicable
- correlation_id
- idempotency reference
- row_version
- audit metadata.

No raw card credentials are canonical data.

11. STRIPE FIRST ADAPTER — SANDBOX DESIGN

Stripe is the first implementation candidate because it supports the guarantee patterns required by this design.

For PAYMENT_METHOD_GUARANTEE, the adapter should use a provider flow equivalent to Stripe SetupIntent: collect and prepare a payment method for future use without creating an immediate charge, including the required customer consent/mandate for future off-session use where applicable.

For DEPOSIT and FULL_PREPAYMENT, the adapter creates an actual payment flow and AIRenOS considers it satisfied only after verified provider state/webhook evidence.

For AUTHORIZATION_HOLD, the adapter may use a PaymentIntent/manual-capture style flow only when the authorization validity window is compatible with the booking timing and payment method. Long-lead bookings must not depend on an authorization that will expire before the service date. In those cases policy must select saved payment method and/or deposit/prepayment instead.

The first Stripe implementation is TEST/SANDBOX only. No live Stripe credentials, charges or production tenant are authorized by v0.1.

12. CHANNEL CONNECTION MODEL

TenantChannelConnection represents a tenant/location relationship with an external reservation channel.

Minimum classes:
- id
- tenant_id
- optional location_id
- channel_type
- external_merchant/location reference
- capabilities: inbound booking, outbound booking, availability export, update/cancel, guest sync, waitlist where supported
- authentication/secret references
- environment TEST/LIVE
- status
- last successful sync
- health/reconciliation state
- created/updated audit metadata.

Secrets remain in a secret manager/provider vault and are referenced, never stored in frontend/client data.

13. CHANNEL ADAPTER PORT

Canonical operations/capabilities may include:
- ingestBookingCreated()
- ingestBookingUpdated()
- ingestBookingCancelled()
- publishAvailability()
- publishBookingState()
- fetchIncrementalChanges()
- reconcileSnapshot()
- healthCheck()

Not every provider supports every operation. Capabilities must be explicit per connection. Missing capability never causes AIRenOS to simulate provider support silently.

14. NORMALIZED EXTERNAL BOOKING LINK

Every external reservation that becomes or maps to an AIRen Booking must retain provenance through an ExternalBookingLink:
- tenant_id/location_id
- booking_id
- channel_type
- external_merchant_ref
- external_booking_id
- external_status
- first_seen_at
- last_seen_at
- last_synced_at
- provider_updated_at when available
- commission/cost metadata when contractually available
- raw payload reference or immutable evidence reference under retention policy, not unrestricted PII duplication
- reconciliation status
- correlation_id.

Unique identity should normally be channel connection + external_booking_id. A provider retry with the same external id must never create a second Booking.

15. DEDUPLICATION

Deduplication is layered:
1. exact provider event id/replay id;
2. exact external_booking_id inside the channel connection;
3. exact AIRen idempotency key for direct/assisted sources;
4. optional semantic duplicate detection for suspicious cross-channel duplicates.

Semantic/heuristic duplicate detection must not silently merge bookings. Low-confidence cross-channel matches create a review/reconciliation condition. Human confirmation or a separately governed deterministic rule is required before destructive merge/cancel behavior.

16. INBOUND EVENT INGRESS

Provider webhooks terminate in a Foundation-controlled ingress.

Required controls:
- provider signature/authentication verification;
- timestamp/replay validation where supported;
- event-id uniqueness;
- payload size/schema validation;
- tenant/channel connection resolution from trusted configuration, not provider-supplied tenant ids;
- normalization into canonical typed event;
- idempotency;
- audit-safe structured logs without secrets/card data;
- transactional domain mutation through Booking services only;
- outbox event after successful commit.

A webhook acknowledgment timeout must never cause duplicate domain mutation on provider retry.

17. OUTBOUND SYNCHRONIZATION AND RECONCILIATION

AIRenOS must distinguish:
- event-driven real-time sync;
- provider polling/incremental sync;
- periodic reconciliation snapshot.

Reconciliation states may include:
IN_SYNC
PENDING
DIVERGED
CONFLICT
PROVIDER_UNAVAILABLE
MANUAL_REVIEW_REQUIRED

AIRenOS never resolves a material divergence by silently accepting external state as canonical. Provider-specific policy determines whether AIRenOS republishes its state, accepts an allowed external update through normal authorization, or raises manual review.

18. CHANNEL INVENTORY / ALLOCATION POLICY

ChannelAllocationPolicy governs how much canonical capacity is exposed to each channel.

Minimum dimensions:
- tenant/location
- service/resource class
- channel
- effective date range
- day-of-week/special date
- time window
- party-size bounds
- lead-time minimum/maximum
- cutoff
- quota/capacity amount or percentage
- safety buffer
- priority
- enabled status.

AIRenOS remains the availability authority. A channel quota is an exposure policy, not an independently owned inventory pool.

For providers with strong real-time availability support, AIRenOS can publish dynamic availability. For providers with slower synchronization, quotas/safety buffers may reduce oversell risk. The adapter capability model determines the strategy.

19. ASSISTED SOURCES

PHONE:
An authorized operator creates the booking through the same canonical Booking/BookingHold service with source=PHONE.

WALK_IN:
An authorized operator creates/updates canonical service occupancy with source=WALK_IN. Walk-in must reduce the same availability used by digital channels.

WHATSAPP:
The WhatsApp adapter may converse, collect structured intent, query availability and present options. AI or conversational automation may propose actions, but Booking creation/conversion occurs only through the deterministic Booking service. Any required guarantee routes through BookingHold + AIRenPay.

CONCIERGE:
A concierge/operator flow is treated as an authenticated assisted channel with traceable actor/source provenance.

DIRECT_WEB:
The direct tenant booking widget uses BookingHold for race-free temporary reservation during checkout/guarantee steps.

20. GOOGLE ACTIONS CENTER ADAPTER CONSTRAINT

Google Reservations integration is treated as a partner integration, not a generic public API toggle.

Current official design implications:
- partner/onboarding approval is required for the relevant Actions Center integration;
- Reservations End-to-End requires a Booking Server reachable over HTTPS;
- Google currently defines real-time Booking Server operations including availability lookup, CreateBooking, UpdateBooking and HealthCheck;
- merchant/service/availability feed or equivalent Actions Center inventory onboarding is part of the integration model;
- sandbox behavior must not create real-world inventory side effects;
- adapter credentials, feed mechanics and provider-specific protocol remain isolated inside GoogleChannelAdapter.

AIRenOS core contracts must not depend on Google-specific Basic Auth, feed formats or endpoint names.

Official references reviewed 2026-08-29:
https://developers.google.com/actions-center/verticals/reservations/e2e/integration-steps/booking-server-ready
https://developers.google.com/actions-center/verticals/reservations/bl/overview
https://developers.google.com/actions-center/verticals/reservations/bl/reference/feeds/overview

21. OPENTABLE ADAPTER CONSTRAINT

Current OpenTable partner materials advertise:
- Sync API for reservation/guest/operational synchronization;
- Booking API for booking experiences against current availability;
- CRM API;
- API Sandbox access by request.

Therefore OpenTable is a strong first external-channel candidate after the generic Channel Adapter contract is certified. Exact endpoints/authentication are not frozen until partner/sandbox credentials and documentation are granted.

Official references reviewed 2026-08-29:
https://dev.opentable.com/
https://www.opentable.com/restaurant-solutions/api-partners/

22. THEFORK ADAPTER CONSTRAINT

TheFork Manager currently documents software integrations and a custom API integration capability for connecting restaurant ecosystems and reservation data. The public material does not authorize AIRenOS to assume unrestricted endpoints or credentials.

Therefore TheForkChannelAdapter is designed provider-neutral now, but exact contract implementation begins only after partner/commercial/API access is verified.

Official reference reviewed 2026-08-29:
https://www.theforkmanager.com/it/integrazioni-software-ristoranti
https://www.theforkmanager.com/it/software-ristorante-prezzi

23. STRIPE PROVIDER CONSTRAINT

Current Stripe official guidance confirms:
- SetupIntent can save/prepare payment methods for future payments without creating a charge;
- appropriate consent/mandate is required for future/off-session use;
- separate authorization/capture is supported for eligible methods through manual capture;
- card authorization validity is limited and varies by network/transaction type, commonly measured in days, so authorization expiry must be modeled explicitly.

Official references reviewed 2026-08-29:
https://docs.stripe.com/payments/setup-intents
https://docs.stripe.com/payments/place-a-hold-on-a-payment-method

24. GENERIC BOOKABLE RESOURCE PRINCIPLE

No first implementation should hard-wire AIRenPay or Channel Hub exclusively to restaurant tables.

The domain should preserve a generic resource/service concept sufficient for future verticals, while avoiding premature universal schema complexity. First runtime proof remains restaurant capacity/table booking. Future adapters may map the same Hold/Guarantee/Channel primitives to ROOM, SPA_SLOT, BEACH_BED, TRANSFER, APPOINTMENT, EVENT_SLOT and other resource classes through separately governed vertical policies.

25. SECURITY AND PRIVACY

Mandatory controls:
- strict tenant/location RLS and trusted scope resolution;
- per-connection least-privilege secrets;
- secret rotation/revocation;
- no secrets in frontend, GitHub, Drive evidence or logs;
- provider webhook verification and replay protection;
- correlation_id on every boundary crossing;
- idempotency for every mutation;
- data minimization in provider payload persistence;
- GDPR purpose/retention rules for guest PII;
- payment consent evidence where required;
- no PAN/CVV storage;
- auditable operator actions;
- service identities distinct from end-user identities;
- fail closed on missing/ambiguous channel connection, provider identity, tenant, location, permission, entitlement or policy.

26. OBSERVABILITY

Minimum metrics/events:
- channel ingress event count, latency and error class;
- provider webhook verification failures;
- duplicate/replay count;
- external booking reconciliation divergence;
- availability publication lag;
- provider availability/health;
- BookingHold created/expired/converted rates;
- guarantee requirement distribution;
- AIRenPay provider success/failure/timeout;
- authorization expiry risk;
- payment/refund/capture reconciliation;
- per-channel booking volume, cancellation/no-show and attributable commission/cost when available;
- correlation coverage.

27. BUSINESS ANALYTICS ENABLED BY THE HUB

Because provenance is canonical, AIRenOS may later report:
- direct vs marketplace booking share;
- channel conversion rate;
- commission/acquisition cost;
- cancellation and no-show rate by source;
- deposit/guarantee effectiveness;
- repeat guests by acquisition channel;
- migration from paid channels to direct booking where lawful and contractually permitted;
- allocation/quota performance.

These analytics are downstream projections and do not change Booking authority.

28. FAILURE PRINCIPLES

- timeout never means success;
- provider 2xx acknowledgment is not sufficient if domain commit failed;
- payment redirect success page is not proof of settled/authorized state;
- webhook retry does not create a duplicate;
- channel outage must not make AIRenOS availability unknowable;
- stale provider inventory is surfaced and managed by allocation/safety policy;
- expired BookingHold cannot be converted unless a new authorized hold is created;
- expired card authorization cannot be treated as a valid guarantee;
- external cancellation/update conflicts never disappear silently;
- any ambiguous identity/scope/authority fails closed.

29. IMPLEMENTATION SEQUENCE — FROZEN

Gate A — Current Base44 read-only closure
Require LIVE / READ-ONLY and a real correlation_id in the authenticated RISTOAIREN preview. Zero records is acceptable. Mutation remains FALSE.

Gate B — BookingHold / Guarantee Engine
Implement contracts, policy, persistence, transactional capacity claim, expiry/release worker, audit/outbox and tests. No payment provider required for mode NONE.

Gate C — AIRenPay provider-neutral contract
Implement gateway port, TenantPaymentGatewayConnection references, orchestration states, webhook ingress contract and secret boundaries. No live money movement.

Gate D — Stripe TEST adapter
Use Stripe test mode for SetupIntent/deposit/prepayment/manual-capture patterns as policy allows. Prove webhook verification, retries, idempotency, expiration and refund/release paths. Live Stripe is not authorized.

Gate E — Direct Booking E2E
Direct web/Base44 experience creates a BookingHold, satisfies configured guarantee, converts once into Booking and releases/expirs correctly on abandonment. Prove concurrent capacity behavior.

Gate F — Generic Channel Adapter contract
Implement channel connection, normalized event, ExternalBookingLink, exact idempotency/dedup, reconciliation and ChannelAllocationPolicy.

Gate G — First external provider
Select provider only after partner prerequisites are available. OpenTable is a strong initial candidate because a sandbox is advertised; Google may proceed when Actions Center partner onboarding is accepted. No scraping or unofficial reverse engineering.

Gate H — Additional providers
TheFork after verified partner/API access; WhatsApp through an authorized business messaging integration; further adapters according to capability contracts.

30. ACCEPTANCE CRITERIA FOR EACH MUTATION GATE

Every mutation-capable gate requires:
- RULE-DOC-21 pre-check MATCH;
- code on working RBL only;
- schema/migration idempotence where applicable;
- RLS tests;
- permission/entitlement tests;
- cross-tenant negative tests;
- idempotency/replay tests;
- concurrency tests for capacity/hold operations;
- audit/outbox proof;
- provider secret non-disclosure proof;
- provider webhook signature/replay tests when applicable;
- CI PASS;
- non-production runtime proof;
- remote read-back/evidence reconciliation;
- explicit feature flag default FALSE until certification.

31. NON-GOALS v0.1

Not authorized by this design:
- becoming a licensed PSP/acquirer;
- storing raw card data;
- live payment activation;
- production Google/OpenTable/TheFork/WhatsApp launch;
- bypassing partner onboarding or commercial agreements;
- scraping channel portals;
- automatic heuristic booking merges;
- production Corte delle Stelle cutover;
- modifications to protected R3/main;
- broad CRM implementation as part of this gate.

32. GOVERNANCE STATE

DESIGN_DIRECTION = FROZEN_v0.1
AIRenPay name = FROZEN
AIRenPay meaning = Payment, Guarantee & Transaction Orchestration Hub
AIRenOS Booking Core remains single authority = FROZEN
BookingHold separate from Booking lifecycle = FROZEN
Channel Adapter provider-neutral contract = FROZEN
Payment Gateway provider-neutral contract = FROZEN
Current Booking mutation switch = FALSE
Current read-only Base44 E2E final correlation proof = PENDING
First implementation gate after E2E closure = BookingHold / Guarantee Engine

Any change to these authority boundaries, state-machine semantics, payment-data custody, tenant isolation or provider-neutrality requires a new governed design revision.
