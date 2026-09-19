AIRenClub — Backend & Integration Contracts
v0.1 — AIRC-PB-005

STATUS: CANONICAL DESIGN CONTRACT — PB-005 CLOSED / DESIGN PASS WITH OPEN DEPENDENCIES. This contract freezes provider-independent backend boundaries and integration semantics before any baseline, Base44, runtime, persistent schema, migration, LIVE or production implementation.

0. Authority and lineage
AIRenClub is a native AIRenOS vertical. AIRenOS remains Control Plane and owns Identity, Session, Organization, ProductAccess, Tenant/Location membership, ProductSubscription, Entitlements, Purpose Authorization, Jurisdiction and platform governance. AIRenClub owns only the Nightlife Operational Domain.
Upstream authority: PB-001 Product Foundation, PB-002 Entity & Data Contract, PB-003 RBAC/RLS & Entitlements, PB-004 Route/Page/UX Surface Catalog.
No direct cross-vertical database coupling with RISTOAIREN is permitted.

1. Canonical backend formula
REQUEST → authenticated SecurityContext or validated Public/Guest Context → product/entitlement/permission check → Purpose/Jurisdiction check where applicable → Tenant/Location/Event scope → application service → domain invariant → persistence/adapter → AuditEvent/Outbox → sanitized DTO/projection.
Frontend state, route possession, QR possession, provider callback or AI output is never authority by itself.

2. Service boundary classes
SVC-A Control Plane Integration: AIRenOS-owned identity, session, membership, entitlement, purpose and jurisdiction resolution.
SVC-B AIRenClub Core Application Services: event, ticketing, capacity, access, gate, admission, incident and restriction orchestration.
SVC-C Public Projection Services: read-only published projections with no raw Core entity exposure.
SVC-D Guest Transaction Services: bounded guest purchase, boarding and credential retrieval/mutation; runtime blocked until Guest Runtime/Session Authority is resolved.
SVC-E Provider Adapters: AIRenPay, verification, credential, gate hardware and notification providers.
SVC-F Async/Integration Services: webhook intake, outbox, retry, compensation, reconciliation and projection materialization.
SVC-G AI Tool Services: proposal/analysis only unless a separately authorized governed command is approved by a human/system authority.

3. Application Service Contract envelope
Every mutating service accepts: operation_id, correlation_id, idempotency_key when required, actor/context authority, target scope identifiers, expected_version when concurrency-sensitive, command payload, policy/purpose context when required.
Every response returns: result state, authoritative resource/version identifiers, safe reason code, correlation_id, retry classification and projection/next-action hints where appropriate.
Raw provider secrets, bearer credentials, verification evidence and sensitive incident data are excluded from ordinary DTOs.

4. Public and Guest Runtime boundary
Public discovery is anonymous read-only through TenantDomain-resolved Public Projection services.
Public requests never accept tenant_id/location_id from body/query as authority.
Guest mutations require a validated Guest Context that binds the guest transaction to Tenant, Location, EventSession and permitted resource scope.
Guest Context issuance, renewal, recovery and secure boarding-pass retrieval remain HOLD pending AIRenOS Guest Runtime / Session Authority.
Until resolved, AIRC-GST-001..005 and guest mutation endpoints remain RUNTIME_BLOCKED, not approximated with insecure tokens.

5. Purchase saga
Canonical saga:
PurchaseIntent → CapacityReservation → AIRenPay PaymentIntent/Authorization → Purchase → AccessEntitlement → optional AccessAllocation → AccessCredential.
PurchaseIntent is a request to buy, not proof of access.
CapacityReservation is the sole temporary capacity hold authority and must expire deterministically.
Payment success alone does not create admission authority.
Purchase confirmation and AccessEntitlement issuance must be idempotent and reconciliable.
Any partial failure after external payment requires explicit compensation/reconciliation state; silent success is forbidden.

6. Purchase saga states and compensation
PurchaseIntent: CREATED, VALIDATED, HOLD_PENDING, PAYMENT_PENDING, CONFIRMING, CONFIRMED, FAILED, EXPIRED, COMPENSATION_REQUIRED.
CapacityReservation: ACTIVE, CONSUMED, RELEASED, EXPIRED.
Payment binding: provider-independent internal reference plus AIRenPay adapter reference.
If payment fails: release active hold.
If hold expires before payment confirmation: do not oversell; enter reconciliation/compensation path.
If provider confirms payment after local timeout: verified webhook/reconciliation may resume the same saga by idempotency key.
If Purchase is confirmed but entitlement issuance transiently fails: retry entitlement issuance; never create a second Purchase.

7. AIRenPay operational adapter
AIRenClub calls AIRenPay through an application adapter, never provider-specific payment APIs directly.
Required operations: createPaymentIntent, authorizeOrCapture, getPaymentStatus, cancelOrVoid where supported, refundOrCompensate where authorized, verifyWebhook, reconcilePayment.
AIRenPay remains payment-domain authority for provider binding. AIRenClub owns the nightlife purchase saga state.
Exact AIRenPay operational binding remains OPEN until the canonical AIRenPay runtime contract is selected.

8. Capacity and concurrency
CapacityReservation creation must be atomic against the authoritative capacity ledger.
No read-then-write availability pattern may oversell.
Concurrency-sensitive commands require expected_version or equivalent atomic predicate.
Conflicts return CONFLICT/STALE_VERSION and do not silently overwrite.
Row/version strategy is implementation-neutral now; baseline selection must prove equivalent semantics.

9. Access chain
Canonical authority chain:
AccessEntitlement → AccessAllocation → AccessCredential → GateScan → AdmissionRecord.
AccessEntitlement is the authoritative right of access.
AccessAllocation assigns that right to ArrivalSlot, BoardingGroup, Gate or AccessClass context where applicable.
AccessCredential is a revocable representation only.
GateScan is an observed validation attempt.
AdmissionRecord is the authoritative admission fact.
No layer may collapse these entities into one generic ticket/QR record.

10. Access Entitlement services
Required operations: grant, read, suspend, reinstate where policy allows, revoke, changeAccessClass, evaluateForSession.
Grant requires valid Purchase or separately authorized manual/system grant path.
Revoke/suspend invalidates downstream credential usability through evaluation even if the credential representation remains technically readable.
AccessClass includes Standard, Priority and VIP as configuration, not parallel entitlement systems.

11. Access Allocation services
Required operations: assign, reassign, clear, read.
Allocation must preserve same Tenant/Location/EventSession scope.
ArrivalSlot capacity changes use the same concurrency discipline as ticket capacity.
Reassignment is auditable and cannot fabricate extra entitlement quantity.

12. Credential adapter
Provider-independent operations: issueCredential, rotateCredential, revokeCredential, resolveCredentialReference, getPresentationPayload.
Credentials must use opaque/non-guessable references and never encode sensitive operational history.
Raw reusable credential secrets are not exposed to management surfaces.
Credential multi-active policy remains HOLD: implementation must not assume whether old and new credentials can coexist.

13. Gate validation service
Input: gate identity, scanner/device context when available, credential presentation/reference, event/session context, correlation/idempotency metadata.
Validation sequence: resolve credential → evaluate AccessEntitlement current state → verify allocation/gate/session/arrival constraints → evaluate anti-passback/offline policy → return ALLOW, DENY or REVIEW with operator-safe reason.
A successful GateScan does not itself create AdmissionRecord.

14. Admission service
recordAdmission requires a preceding validated gate decision or separately governed manual admission authority.
AdmissionRecord is append-oriented and immutable as historical fact; corrections are explicit correction records/reasons, not destructive edits.
Duplicate admission behavior depends on anti-passback policy.
Anti-passback semantics remain HOLD; no permissive default is authorized.

15. Gate/scanner/turnstile adapter
Provider-independent adapter operations: identifyDevice, validateDeviceBinding, submitScan, signalDecision, healthStatus, syncPolicySnapshot where authorized.
Hardware provider cannot grant access independently of AIRenClub authority.
Turnstile OPEN/CLOSE actuation is downstream of an authoritative ALLOW decision and must be correlation-linked.
Exact device binding and kiosk/turnstile implementation remain future/provider-specific.

16. Offline/degraded gate behavior
Default is fail closed for authority-changing operations.
Offline mode must be explicit and visible; cached data is never silently presented as current online authority.
No generic offline bypass is authorized.
A future approved offline policy may use signed, bounded, expiring policy/credential snapshots with explicit scope, freshness, revocation limitations, reconciliation and audit requirements.
Until such policy is separately approved, OFFLINE_AUTHORITY_UNAVAILABLE yields DENY or REVIEW according to safe operational policy, never automatic admission.
Offline gate policy remains HOLD.

17. Identity / Age Verification adapter
AIRenOS Identity and AIRenClub OperationalSubject remain distinct.
Verification provider abstraction exposes only normalized outcomes required by policy: verification_status, age_requirement_result, assurance_level/reference, verified_at/expiry where applicable.
AIRenClub does not persist unnecessary raw identity documents or provider evidence.
Exact provider and identity lifecycle mapping remain OPEN.
Age/identity verification never substitutes for AccessEntitlement.

18. Notification adapter
Provider-independent operations: sendTransactional, sendAccessUpdate, sendArrivalReminder, sendCredentialNotice, sendOperationalAlert.
Channels may include email, SMS, WhatsApp/push where separately enabled.
Notification delivery is not business-state authority.
Templates consume sanitized projection data and must respect Tenant/Location, purpose, jurisdiction and consent rules where applicable.

19. Provider webhook verification
Every provider webhook must pass provider-specific authenticity verification before business processing.
Canonical flow: receive → verify signature/authenticity → normalize provider event → deduplicate → map to internal aggregate → enforce state transition → persist → audit/outbox → acknowledge.
Unknown, stale, replayed or unverifiable webhooks do not mutate Core.
Webhook secrets are provider-side protected configuration and never logged.

20. Idempotency
Required for purchase creation/confirmation, payment callback handling, capacity hold creation/consumption, entitlement issuance, credential issue/rotate/revoke, gate scan submission where retries are possible, admission recording, restriction application/revocation and external notification dispatch where duplicate delivery matters.
Idempotency scope includes Tenant plus operation family plus stable caller key.
Same key with materially different payload is rejected.
Idempotency records must preserve terminal result/replay semantics for a bounded retention period appropriate to the operation.

21. Retry policy
Retry only transient failures classified as retryable.
Use bounded exponential backoff/jitter at implementation time.
Never blindly retry non-idempotent provider operations.
Permanent validation/authorization/purpose/jurisdiction denials are not retryable without changed authority/context.
Every retry retains correlation_id and does not create duplicate domain facts.

22. Audit Event Catalog
Minimum canonical events:
AIRC.PurchaseIntentCreated
AIRC.CapacityReservationCreated
AIRC.CapacityReservationConsumed
AIRC.CapacityReservationReleased
AIRC.PaymentStatusChanged
AIRC.PurchaseConfirmed
AIRC.PurchaseCompensationRequired
AIRC.AccessEntitlementGranted
AIRC.AccessEntitlementSuspended
AIRC.AccessEntitlementRevoked
AIRC.AccessClassChanged
AIRC.AccessAllocationAssigned
AIRC.AccessAllocationReassigned
AIRC.CredentialIssued
AIRC.CredentialRotated
AIRC.CredentialRevoked
AIRC.GateScanRecorded
AIRC.AdmissionRecorded
AIRC.AdmissionCorrected
AIRC.IncidentRaised
AIRC.IncidentCorrected
AIRC.IncidentReviewed
AIRC.AccessDecisionRecorded
AIRC.RestrictionApplied
AIRC.RestrictionRevoked
AIRC.RestrictionReviewed
AIRC.PublicProjectionPublished
AIRC.ProviderWebhookRejected
AIRC.ProviderReconciliationRequired
Audit payloads use identifiers, state transitions, actor/service authority, scope, safe reason codes and correlation; never raw secrets or unnecessary sensitive evidence.

23. Public Projection services
PublicVenueProjectionService, PublicEventProjectionService, PublicTicketOfferProjectionService, PublicAvailabilityProjectionService, PublicPolicyProjectionService, PublicGateInstructionProjectionService.
Projections contain only deliberately published fields and version/publication metadata.
No public endpoint returns raw Core entities.
Projection materialization may be synchronous or asynchronous but stale state must be detectable for critical availability.

24. AIRenOS Purpose Authorization integration
Purpose Authorization is evaluated separately from Permission, Entitlement and RLS.
Sensitive incident/restriction reads and decisions require a purpose context and an AIRenOS Purpose Authorization decision before data access/action.
Exact AIRenOS Purpose Authorization runtime API remains OPEN. AIRenClub defines an adapter contract, not a guessed implementation.
Unavailable purpose authority fails closed for protected operations.

25. AIRenOS Jurisdiction integration
Jurisdiction resolution is AIRenOS authority.
AIRenClub asks for an applicable jurisdiction/policy decision using Tenant/Location/Event and operation context.
Jurisdiction may constrain verification, retention, notification, restriction, evidence and decision workflows.
Unavailable required jurisdiction authority fails closed.
No country-specific legal logic is hardcoded in AIRenClub Core.

26. Incident service boundary
Incident records factual operational observations and evidence references.
Required operations: raiseIncident, appendFact, attachEvidenceReference, correctIncident, readIncident, listIncidentSummaries.
Incident creation never creates AccessDecision or Restriction.
Sensitive fields require explicit permission plus Purpose Authorization where applicable.
AI may summarize/propose classifications but cannot mutate Incident truth without governed service authority.

27. Access Decision and Restriction boundary
AccessDecision is a human/system-governed decision derived from permitted facts and policy.
Restriction is a separate enforceable state with scope, reason category, start/end/review semantics and provenance.
No global blacklist exists.
Cross-Tenant restriction is DENY by default.
Organization-wide restriction across multiple Tenants remains HOLD pending explicit authority, jurisdiction, purpose, governance and persistence design.
RestrictionApplicabilityDecision persistence remains OPEN.

28. Restriction workflow
Proposed sequence: Incident facts → authorized review → Purpose/Jurisdiction checks → AccessDecision → Restriction proposal → human approval where required → Restriction → applicability evaluation at access time → review/revoke/expire.
A gate operator may raise Incident but cannot infer/create an organization-wide restriction.
Restriction decisions must be explainable through safe reason categories and auditable provenance.

29. AI service/tool boundaries
AI receives minimized, purpose-authorized context.
AI can recommend, summarize, classify, forecast or draft.
AI cannot directly write Core tables, issue/revoke AccessEntitlement, create AdmissionRecord, apply/revoke Restriction, alter capacity authority, confirm payment, or bypass Purpose/Jurisdiction.
Any AI-initiated action becomes a proposed governed command executed only through the same application service, authorization, RLS, audit and human-approval rules as non-AI actions.

30. Cross-Tenant and cross-vertical rules
Cross-Tenant access is DENY by default.
Multi-location operations use explicit authorized Location sets; missing scope is never wildcard.
AIRenClub does not query RISTOAIREN operational tables directly.
Cross-vertical exchange, if later needed, occurs through AIRenOS-owned shared contracts, sanctioned APIs/events or explicit integration adapters.

31. Error taxonomy
VALIDATION_ERROR
AUTHORIZATION_DENIED
ENTITLEMENT_DISABLED
PURPOSE_REVIEW_REQUIRED
JURISDICTION_UNAVAILABLE
CONFLICT_STALE_VERSION
CAPACITY_UNAVAILABLE
PAYMENT_PENDING
PAYMENT_FAILED
COMPENSATION_REQUIRED
CREDENTIAL_INVALID
ACCESS_DENIED
REVIEW_REQUIRED
OFFLINE_AUTHORITY_UNAVAILABLE
PROVIDER_RETRYABLE_FAILURE
PROVIDER_TERMINAL_FAILURE
INTERNAL_RETRYABLE_FAILURE
INTERNAL_TERMINAL_FAILURE
Errors exposed publicly/operators are sanitized and must not leak hidden resource existence or sensitive reasoning.

32. Observability
Every critical service emits correlation_id, operation_id, safe state transition, latency class and provider/internal dependency class.
Logs exclude secrets, raw credentials, raw identity documents and unnecessary incident evidence.
Metrics include purchase saga completion/failure, hold expiry, provider reconciliation, credential issuance failures, scan throughput, admission outcomes, offline/degraded events and restriction workflow latency without exposing personal data.

33. Transaction and outbox rule
A local domain state change and its required integration/audit event must commit atomically where they share persistence authority.
External provider calls are never assumed to participate in the local DB transaction.
Use outbox/inbox or equivalent reliable delivery semantics for asynchronous side effects.
Implementation technology remains baseline-dependent.

34. Open/HOLD dependencies preserved
AIRC-PB5-OD-001 Guest Runtime / Session Authority — HOLD.
AIRC-PB5-OD-002 Organization-wide restriction cross-Tenant — HOLD.
AIRC-PB5-OD-003 exact AIRenOS Purpose Authorization runtime API — OPEN.
AIRC-PB5-OD-004 Identity lifecycle mapping — OPEN.
AIRC-PB5-OD-005 RestrictionApplicabilityDecision persistence — OPEN.
AIRC-PB5-OD-006 Credential multi-active policy — HOLD.
AIRC-PB5-OD-007 Anti-passback semantics — HOLD.
AIRC-PB5-OD-008 AIRenPay operational binding — OPEN.
AIRC-PB5-OD-009 Verification provider abstraction/provider selection — OPEN.
AIRC-PB5-OD-010 Offline gate policy — HOLD.
None of these may be silently resolved during baseline/Base44 selection.

35. PB-005 acceptance tests
T-AIRC-BE-001 public request cannot select arbitrary Tenant authority.
T-AIRC-BE-002 guest mutation fails closed without valid Guest Context.
T-AIRC-BE-003 concurrent capacity holds cannot oversell.
T-AIRC-BE-004 same idempotency key replays the same purchase result.
T-AIRC-BE-005 same idempotency key with different payload is rejected.
T-AIRC-BE-006 payment success without Purchase confirmation does not grant access.
T-AIRC-BE-007 confirmed Purchase cannot create duplicate AccessEntitlements on retry.
T-AIRC-BE-008 revoked entitlement causes credential evaluation denial.
T-AIRC-BE-009 credential possession alone cannot authorize admission.
T-AIRC-BE-010 GateScan ALLOW does not itself create AdmissionRecord.
T-AIRC-BE-011 duplicate admission follows explicit anti-passback policy and cannot be silently accepted.
T-AIRC-BE-012 unverifiable/replayed provider webhook cannot mutate Core.
T-AIRC-BE-013 stale expected_version cannot overwrite newer state.
T-AIRC-BE-014 offline/degraded gate cannot silently use stale authority.
T-AIRC-BE-015 incident creation cannot create Restriction.
T-AIRC-BE-016 restriction mutation requires permission, entitlement, purpose/jurisdiction and governed authority.
T-AIRC-BE-017 cross-Tenant restriction/access attempt fails closed unless explicit future authority exists.
T-AIRC-BE-018 AI cannot directly mutate Core authority.
T-AIRC-BE-019 public projections contain no private/safety/raw Core data.
T-AIRC-BE-020 AIRenClub contains no direct RISTOAIREN DB coupling.
T-AIRC-BE-021 provider retry cannot duplicate payment/purchase/credential/admission facts.
T-AIRC-BE-022 sensitive incident read fails closed when Purpose Authorization is unavailable.
T-AIRC-BE-023 jurisdiction-required operation fails closed when jurisdiction resolution is unavailable.
T-AIRC-BE-024 AuditEvent contains correlation/scope/state transition but no secret-bearing payload.

36. PB-005 design closure condition
PB-005 closes as DESIGN PASS WITH OPEN DEPENDENCIES after exact isolated GitHub mirroring, normalized Drive/GitHub content MATCH, Program Control closure and protected-boundary verification.
PB-005 closure does not authorize Base44 creation, baseline selection, runtime implementation, persistent schema, migration, LIVE or production changes.
