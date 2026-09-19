AIRenClub — Entity & Data Contract
v0.1 — AIRC-PB-002
STATUS: CANONICAL DESIGN CONTRACT — PB-002 CLOSED / DESIGN PASS WITH OPEN DEPENDENCIES. This document defines the canonical AIRenClub entity, aggregate, scope, data-governance and lifecycle model. It does not authorize runtime, Base44, persistent schemas, migrations, production, real PII, real payments or real access restrictions.
0. Authority, lineage and boundaries
AIRenClub is a native AIRenOS vertical. AIRenOS governs the Control Plane; AIRenClub governs the Nightlife Operational Domain. AIRenClub must not duplicate AIRenOS Identity, Session Authority, Organization, Legal Entity, Product Catalog, ProductSubscription, Entitlements, Tenant, Location, TenantDomain, platform roles, platform audit, secrets, observability, shared service governance, Purpose Authorization or Jurisdiction policy.
Canonical upstream authorities reconciled for this promotion: AIRenOS Platform Bible; AIRenOS Vertical Contract v0.1; Product Catalog / Subscription / Entitlements v0.1; Tenant & Location Provisioning v0.1; Security & Audit Bible v0.1; AIRenClub Product Bible v0.1; RULE-DOC-20; RULE-DOC-21; AIRenOS Program Control Master.
PB-001 authority: Drive 1jC-31f4BMFbYAxVVX3kX3g1ikbgoyzplXbJJjGjFYHE. GitHub branch airenclub/pb-001-foundation-20260919, commit 8b64f6a95c87644452fff4cc77293ff4e047843f. PB-002 promotion branch: airenclub/pb-002-entity-data-20260919.
Review lineage: the working analysis produced a 52-candidate entity catalog and was explicitly non-canonical until this promotion. This contract promotes only the approved/refined decisions and preserves unresolved authority questions as HOLD or DESIGN_PENDING rather than resolving them silently.
1. Reconciliation result
Fresh RULE-DOC-20 / RULE-DOC-21 reconciliation result before write: MATCH / NO_CHANGE_VERIFIED on the PB-001 boundary. AIRenClub PB-001 branch HEAD remained 8b64f6a95c87644452fff4cc77293ff4e047843f. main remained b846344f8cc93bb888fe2b4a686a8f0ecae8ec4c. R3 remained 3d32b53bde2191c7718606cf9d3fe3497ae3f626. RBL remained d055fba86d938aa38cee648171425046c7d972a4. PR #4 remained OPEN / DRAFT / UNMERGED.
Program Control pre-write state: ACT-AIRC-PB-001-CARMELO-001 CLOSED; ACT-AIRC-PB-002-CARMELO-001 READY. No prior PB-002 canonical document or PB-002 GitHub branch was found.
Purpose Authorization is inherited from AIRenOS as a distinct control from permissions, entitlements and Tenant/Location isolation. AIRenClub declares required purposes and minimized inputs; AIRenOS remains authority for purpose policy and decision provenance.
2. AIRenOS / AIRenClub ownership contract
AIRenOS-owned references: IdentityRef, SessionContextRef, OrganizationRef, OrganizationMembershipRef, ProductAccessRef, TenantMembershipRef, LocationMembershipRef, LegalEntityRef, ProductRef, ProductSubscriptionRef, PlatformEntitlementRef, TenantRef, LocationRef, TenantDomainRef, AuditRef, SecretRef, PurposeDecisionRef, JurisdictionPolicyRef, PaymentOperationRef and, where applicable, BookingRef. These are references to AIRenOS/shared authority and are not AIRenClub master records.
AIRenClub-owned operational semantics: club operating profile, venue zones, event and event session, capacity policy, event access policy, ticket product, purchase intent and purchase, capacity reservation, operational subject, access entitlement, access allocation, access credential, arrival slot, boarding group, access class, gate, gate assignment, gate scan, admission record, live gate state, customer club relationship, partner and attribution, incident/review/decision/restriction, event format/experiment/scorecard, nightlife analytics and governed domain AI.
Cross-vertical rule: AIRenClub does not directly own RISTOAIREN Menu, Order, KDS, Inventory or Booking-domain records. Any hospitality or F&B integration uses explicit API/event/reference contracts; direct cross-vertical database coupling is prohibited.
3. Aggregate map and consistency boundaries
ClubOperatingProfile is the AIRenClub configuration attached to one AIRenOS Location. VenueZone and Gate belong to that Location-scoped operating context.
Event is the event identity aggregate; EventSession is a separate operational occurrence aggregate. CapacityPolicy and EventAccessPolicy are versioned policy aggregates and cannot be reduced to mutable frontend flags.
TicketProduct defines what is offered. PurchaseIntent defines a bounded checkout attempt. Purchase records the confirmed commercial outcome. CapacityReservation provides atomic hold/consume/release semantics across applicable capacity constraints.
AccessEntitlement is the authority for a guest's operational right to enter. AccessAllocation binds that right to EventSession, ArrivalSlot and BoardingGroup. AccessCredential is only a revocable technical representation of that right. Priority and VIP are AccessClass configurations, not duplicate entitlement aggregates.
GateScan records a technical attempt. AdmissionRecord records the governed fact of admission/exit/correction. A successful-looking credential cannot authorize admission when the underlying AccessEntitlement is revoked, suspended, expired or otherwise ineligible.
OperationalSubject is AIRenClub's local subject identity for purchaser/beneficiary/guest relationships and does not imply an AIRenOS account. SubjectIdentityLink may connect the subject to AIRenOS Identity when a governed account relationship exists.
Incident, IncidentReview, AccessDecision and AccessRestriction are separate aggregates/decision stages. Incident does not automatically imply guilt, denial or ban. Restriction requires an explicit governed decision basis, scope, validity, policy reference and review semantics.
Partner is the unified business counterpart aggregate. PartnerRole expresses promoter, creator, influencer, community, university, brand, media, association or other approved relationship types. PartnerEngagement binds a partner/role to an Event. AttributionTouch and AttributionCredit remain separate facts/derived results.
4. Canonical entity catalog and classification
4.1 CORE_MVP transactional
E01 ClubOperatingProfile — Location-scoped nightlife operating configuration.
E02 VenueZone — Location-scoped zone hierarchy and operational grouping.
E03 CapacityPolicy — versioned physical/operational capacity constraints; safety limits cannot be increased by sales configuration.
E04 Event — event identity within one AIRenOS Location.
E05 EventSession — operational occurrence/time window for an Event.
E06 EventAccessPolicy — versioned customer-visible and operational access conditions.
E07 TicketProduct — event admission offer; distinct from AIRenOS SaaS Product/Plan/Price.
E08 PurchaseIntent — expiring checkout attempt.
E09 Purchase — confirmed operational purchase state, with provider payment references only.
E10 PurchaseLine — immutable/snapshotted line of the purchased offer.
E11 CapacityReservation — atomic HELD/CONSUMED/RELEASED/EXPIRED capacity allocation.
E12 AccessEntitlement — canonical right of access for an OperationalSubject.
E13 AccessAllocation — EventSession/ArrivalSlot/BoardingGroup allocation of an Entitlement.
E14 AccessCredential — revocable technical credential linked to an Entitlement.
E15 ArrivalSlot — Session-scoped planned arrival window with capacity.
E16 BoardingGroup — Session-scoped operational grouping; not a right of access.
E17 AccessClass — Tenant-scoped versioned class of service; Priority/VIP are configurations here.
E18 Gate — physical/logical access point in a Location.
E19 GateAssignment — Session-scoped assignment of Gate and eligible classes/slots/groups.
E20 GateScan — append-oriented scan attempt/result fact.
E21 AdmissionRecord — append-oriented admission/exit/correction fact.
E22 LiveGateState — governed Session state for live entrance operations.
E23 OperationalSubject — Tenant-scoped operational subject independent of AIRenOS Identity.
E27 PolicyAcceptance — evidence that a specific EventAccessPolicy version was communicated/accepted. It is not privacy consent and not Purpose Authorization.
E33 Incident — Location-scoped factual safety/operational incident record.
E34 IncidentSubject — subject participation/allegation within one Incident; does not establish guilt.
4.2 CORE_MVP_CONFIG and value objects
E42 EventFormat — Tenant-scoped configurable format profile used from the first implementation to prevent hardcoded event categories such as Golden Hour, Cosplay, Afrobeat or similar business experiments.
VO01 DeliveryContactSnapshot — minimal transaction-scoped delivery contact snapshot for ticket/boarding communication. Candidate fields: channel, destination, verification_status, purpose, captured_at. It must not automatically create a CRM profile or AIRenOS membership.
4.3 CORE_LATER
E24 CustomerClubProfile; E25 SubjectIdentityLink; E26 VerificationAssertion; E28 Partner; E29 PartnerRole; E30 PartnerEngagement; E31 AttributionTouch; E32 AttributionCredit; E35 IncidentEvidenceReference; E36 IncidentReview; E37 AccessDecision; E38 AccessRestriction; E39 RestrictionSubject; E40 RestrictionReview; E43 AudienceSegment; E44 EventExperiment; E45 EventScorecard.
E41 RestrictionApplicabilityDecision remains DESIGN_PENDING. It may become a persisted decision-evidence record or an audited policy decision rather than a business aggregate. It is not mandatory for the first schema.
4.4 PROJECTION
E46 NightlifeAnalyticsProjection and E51 ControlTowerProjection are authorized read models/projections and never Core authority.
4.5 FUTURE
E47 AIObservation; E48 AIRecommendation; E49 AIExecutionRecord; E50 FlowAutomationPolicy; E52 MobilityIntegrationReference. These remain non-runtime until separately promoted.
5. Entity relationship invariants
LocationRef → ClubOperatingProfile → VenueZone/Gate. LocationRef → Event → EventSession. Event references versioned EventAccessPolicy, EventFormat and TicketProduct. TicketProduct → PurchaseIntent → Purchase → PurchaseLine → AccessEntitlement → AccessAllocation → AccessCredential → GateScan → AdmissionRecord.
OperationalSubject may own or benefit from Purchase/Entitlement without becoming AIRenOS Identity. SubjectIdentityLink is optional. Purchase does not create OrganizationMembership, TenantMembership or LocationMembership.
All parent-child relations are same-Tenant and, where Location-scoped, same-Location validated. A child cannot change scope by changing a client-supplied identifier. location_id null never means all Locations.
An EventSession belongs to exactly one Event and Location. ArrivalSlot, BoardingGroup, GateAssignment, GateScan and AdmissionRecord are scoped to that EventSession.
An AccessAllocation can point only to a Session covered by its parent AccessEntitlement. Its ArrivalSlot and BoardingGroup, when present, must belong to the same Session.
A GateAssignment can reference only a Gate belonging to the same Location as the EventSession.
A RestrictionSubject must bind to a resolved OperationalSubject; unresolved or probabilistic subject matching is insufficient for enforcement.
6. Lifecycle families
CONFIGURATION: DRAFT → ACTIVE → SUPERSEDED/RETIRED.
EVENT: DRAFT → PUBLISHED → ACTIVE → CLOSED/CANCELLED.
EVENT_SESSION: SCHEDULED → OPEN → LIVE → CLOSED/CANCELLED.
COMMERCIAL_OFFER: DRAFT → PUBLISHED → SALES_OPEN → SALES_CLOSED → RETIRED.
PURCHASE_INTENT: CREATED → ACTIVE → EXPIRED/CONVERTED/CANCELLED.
PURCHASE: PENDING → CONFIRMED → CANCELLED/COMPENSATED.
CAPACITY_HOLD: HELD → CONSUMED/RELEASED/EXPIRED.
ACCESS_ENTITLEMENT: PENDING → ACTIVE → SUSPENDED/REVOKED/EXPIRED/CONSUMED.
ACCESS_ALLOCATION: ASSIGNED → REASSIGNED/RELEASED/EXPIRED.
CREDENTIAL: ISSUED → ACTIVE → ROTATED/REVOKED/EXPIRED.
GATE: CONFIGURED → ACTIVE → DISABLED/RETIRED. LIVE_GATE_MODE: PRE_GATE → LIVE_GATE → CLOSED.
VERIFICATION: PENDING → VERIFIED → EXPIRED/REVOKED/FAILED. REVIEW: OPEN → IN_REVIEW → DECIDED → REOPENED if policy permits.
INCIDENT: REPORTED → UNDER_REVIEW → CLOSED. RESTRICTION: PENDING → ACTIVE → SUSPENDED/EXPIRED/REVOKED.
OPERATIONAL_FACT records such as GateScan, AdmissionRecord and AttributionTouch are append-oriented. Corrections produce a new fact/event rather than destructive history rewrite.
7. Data classification and retention hooks
D1 Configuration data: non-sensitive operational configuration.
D2 Safety/operational configuration: capacity, gate and operational policy data.
D3 Commercial/transaction data: Purchase, PurchaseLine, reservations and entitlement commercial provenance.
D4 Access/security telemetry: credentials, scans and admission evidence; raw bearer/QR secrets are excluded from audit and should not be retained in clear form by default.
D5 Customer/relationship personal data: OperationalSubject relationship/contact data.
D6 Identity/age verification assertions: minimized verification result and provider reference rather than document image by default.
D7 Safety/incident/restriction data: high-sensitivity governed operational evidence.
D8 Analytics/segmentation/AI-derived data: derived records with source, purpose and version provenance.
D9 Restricted external/secret material: prefer reference-only; AIRenClub should not replicate secrets, payment card data, document images or provider credentials.
Retention classes R1 configuration history; R2 commercial/contract history; R3 short-lived operational state; R4 entitlement/credential lifecycle; R5 gate/admission evidence; R6 customer relationship; R7 verification evidence; R8 analytics/AI derived data; R9 incident/restriction/safety evidence.
No fixed retention duration is frozen in PB-002. Effective retention is resolved from data class + purpose + AIRenOS Jurisdiction policy + Tenant policy + legal hold or equivalent approved requirement. Expiry/anonymization/purge must preserve required audit provenance.
8. Tenant / Location / Event scope
All AIRenClub operational records are TENANT_REQUIRED unless explicitly documented as an AIRenOS/shared reference. Organization-wide concepts do not remove tenant_id.
Location-scoped records require tenant_id + location_id and same-scope parent validation. Event-scoped records inherit Location. Session-scoped records inherit Event and Location.
Multi-location read models use an explicit authorized Location set. A null Location is never interpreted as wildcard. Cross-Tenant access is deny-by-default, including when two Tenants share an Organization.
Environment separation is mandatory: demo/sandbox/test data do not become production data by identifier reuse. Synthetic fixtures are required for destructive certification tests.
9. Public Projection Contract
The canonical flag is public_projection_allowed, not Public YES/NO on raw records. Raw private entities do not become public APIs.
Public projection allowed, with sanitized field sets: ClubOperatingProfile, selected VenueZone fields, Event, EventSession, customer-visible EventAccessPolicy, TicketProduct, ArrivalSlot availability, AccessClass, EventFormat, and deliberate public Partner identity/engagement fields.
Conditional public projection: BoardingGroup and Gate only when operationally useful to the guest and only after policy/context checks.
No public raw projection: Purchase, PurchaseLine, AccessEntitlement, AccessCredential, OperationalSubject, CustomerClubProfile, VerificationAssertion, GateScan, AdmissionRecord, Incident, IncidentReview, AccessDecision, AccessRestriction, AudienceSegment, AIObservation/Recommendation or internal analytics records.
Pattern: Public Request → AIRenOS Domain Resolver → validated public Tenant context → AIRenClub Public Projection Service → sanitized DTO.
10. AI authority and Purpose Authorization
AI is never authority of the AIRenClub Core. Direct AI writes to operational entities are prohibited by default.
Required evaluation chain for purpose-sensitive AI use: authenticated/authorized service context + permission + entitlement + Tenant/Location scope + AIRenOS Purpose Authorization + AI capability policy + data isolation = allowed operation.
Candidate AIRenClub purpose identifiers remain contract proposals until registered in AIRenOS: FLOW_OPTIMIZATION, EVENT_ANALYTICS, FORMAT_OPTIMIZATION, CUSTOMER_SERVICE, MARKETING_ATTRIBUTION, SAFETY_REVIEW_SUPPORT, CAPACITY_FORECASTING. No generic AI_USE purpose is permitted.
Incident/safety data may be used for authorized safety-review support only when the AIRenOS purpose decision permits it. Safety/verification data do not automatically become marketing or segmentation inputs.
Pattern: AIObservation → AIRecommendation → governed application service → authorization → Purpose Authorization → validation → human approval when required → Core write → Audit.
Permanent exclusion or similarly material adverse restriction cannot be autonomously imposed by AI in the baseline contract.
11. Incident, decision and restriction model
Canonical chain: Incident → IncidentReview → AccessDecision → AccessRestriction → RestrictionReview/Expiry.
Decision basis is a closed, versioned catalog. Initial candidate bases: INCIDENT_REVIEW, CONFIRMED_ACCESS_FRAUD_REVIEW, CONFIRMED_TICKET_FRAUD_REVIEW, CONTRACTUAL_POLICY_BREACH_REVIEW, LEGAL_OR_REGULATORY_REQUIREMENT, COMPETENT_AUTHORITY_ORDER, SAFETY_REVIEW, RESTRICTION_REVIEW_OUTCOME. A free-form OTHER basis is not permitted.
A restriction must identify decision_id, subject_id, restriction_type, requested_scope, effective_scope, valid_from, valid_until when bounded, reason_code, policy_version, jurisdiction decision reference, purpose decision reference when applicable, review requirement and status.
LOCATION and TENANT restriction scopes are part of the design contract. ORGANIZATION requested scope remains HOLD beyond the issuing Tenant until AIRenOS provides an explicit cross-Tenant Organization relationship/data-sharing/Jurisdiction/Purpose contract.
No global AIRenClub blacklist is authorized. Similar names, emails or probabilistic identity matches cannot enforce a restriction.
12. Access, credential and gate contract
Canonical access chain: TicketProduct → Purchase → AccessEntitlement → AccessAllocation → AccessCredential → GateScan → AdmissionRecord.
AccessEntitlement is the operational authority. AccessClass expresses Standard/Priority/VIP service configuration. AccessAllocation assigns Session/Slot/Group. Credential only presents the entitlement.
AccessCredential should store opaque credential identity, entitlement reference, credential type, generation, token hash or provider reference, issuance/expiry/revocation state and provenance. Raw reusable bearer material should not be persisted in clear form unless a separately governed contract requires it.
Gate validation always rechecks current Entitlement eligibility. A cryptographically or syntactically valid credential is denied when the Entitlement is revoked, suspended, expired, outside Session scope or otherwise ineligible.
Duplicate admission must be governed through anti-passback/entry semantics. Exact multi-active credential and anti-passback rules remain open decisions for PB-005/test design.
13. OperationalSubject, AIRenOS Identity and guest model
OperationalSubject is the AIRenClub subject for purchaser, beneficiary, guest or customer relationship and may exist without an AIRenOS account.
SubjectIdentityLink is the optional governed bridge to AIRenOS Identity. Ticket purchase must not create OrganizationMembership, TenantMembership or LocationMembership.
Guest data model is accepted: OperationalSubject + optional VerificationAssertion + Purchase + AccessEntitlement. Guest runtime/session authority is HOLD. AIRenClub must not invent a parallel authentication/session authority before AIRenOS defines the public/guest runtime contract.
DeliveryContactSnapshot supports transactional delivery without automatic CRM creation. Event Policy Acceptance is distinct from privacy consent, marketing consent and AIRenOS Purpose Authorization.
14. Purchase, payment and capacity invariants
Baseline saga: PurchaseIntent → eligibility check → CapacityReservation HELD → governed PaymentOperation → on success Purchase CONFIRMED + CapacityReservation CONSUMED + AccessEntitlement issued; on failure CapacityReservation RELEASED.
Payment provider success is not sufficient to create an Entitlement if the required capacity hold has expired or is invalid. Late payment success after hold expiry requires a governed compensation path such as rebook/review/refund policy; it must not silently oversell capacity.
AIRenPay, when used, is a shared operational payment capability. AIRenClub does not duplicate provider ledger or AIRenOS SaaS billing authority.
15. Jurisdiction dependencies
AIRenClub does not decide legal applicability autonomously. Target chain: requested action → AIRenOS Jurisdiction Resolver → applicable policy pack → Purpose Authorization where relevant → AIRenClub domain policy → ALLOW / DENY / REVIEW_REQUIRED.
Locale, language and Jurisdiction are separate. Venue/legal-entity country, subdivision/local rules, event location, data use and extraterritorial requirements may all affect policy.
AIRenClub may request decisions such as mayApplyRestriction, mayRetainIncidentEvidence, allowedVerificationMethods, minimumAdmissionAge, requiresHumanReview and mayUseDataForPurpose; AIRenOS remains policy authority.
16. Open decisions and HOLD register
AIRC-OD-001 Guest runtime/session authority — HOLD.
AIRC-OD-002 Organization-wide restriction cross-Tenant — HOLD.
AIRC-OD-003 Exact AIRenOS Purpose Authorization runtime API/contract — HOLD / external dependency.
AIRC-OD-004 AIRenOS Identity lifecycle mapping — external dependency; AIRenClub does not invent a competing enum.
AIRC-OD-005 RestrictionApplicabilityDecision persistence shape — DESIGN_PENDING.
AIRC-OD-006 AIRenPay operational binding — future contract.
AIRC-OD-007 RISTOAIREN Booking/Table/F&B integration — future cross-vertical contract.
AIRC-OD-008 Credential multi-active policy — review in PB-005.
AIRC-OD-009 Admission anti-passback exact semantics — review in PB-005/Test Contract.
AIRC-OD-010 Verification provider abstraction — future contract.
AIRC-OD-011 Organization Control Tower multi-Tenant — HOLD.
AIRC-OD-012 Event/venue portability across Locations — review.
17. Risks and mandatory guardrails
Authority duplication: no AIRenClub replacement for AIRenOS Identity/Tenant/Location/Subscription/Purpose/Jurisdiction.
Entity explosion: the 52 review candidates are not 52 mandatory MVP tables. Classification in this contract controls materialization priority.
Guest shortcut: a public token or delivery contact is not Identity or Membership authority.
Restriction leakage: Organization ownership does not automatically authorize cross-Tenant restriction enforcement.
Sensitive profiling: safety, incident, verification and age data cannot silently feed marketing, segmentation, pricing or access decisions without specific approved authority and Purpose policy.
Audience firewall: marketing segmentation is not Access Eligibility. AudienceSegment cannot become an implicit source of access denial, restriction or safety score.
Credential confusion: QR/Wallet/NFC is not the right itself.
Capacity race: holds and consumption must be atomic across all applicable capacity constraints.
AI authority creep: confidence never grants permission; recommendation never equals mutation.
Provider lock-in: payment, verification, gate hardware, messaging and credential representations remain adapter-based.
18. Golden Club Journey and implementation sequence
Canonical Golden Club Journey for the first certified foundation: AIRenOS Tenant → AIRenOS Location → ClubOperatingProfile → EventFormat → Event → EventSession → EventAccessPolicy → TicketProduct → PurchaseIntent → CapacityReservation → Purchase → OperationalSubject → DeliveryContactSnapshot → AccessEntitlement → AccessAllocation → ArrivalSlot → AccessClass → AccessCredential → Gate → GateScan → AdmissionRecord.
Minimum acceptance invariants: own-Tenant succeeds; cross-Tenant read denied; cross-Tenant write denied; wrong Location denied; expired credential denied; revoked Entitlement denied even with a valid credential; wrong EventSession denied; duplicate admission governed; capacity overbooking denied; expired PurchaseIntent cannot create Purchase; Incident creation does not automatically create Restriction.
Post-PB-002 design sequence: PB-003 RBAC/RLS/Entitlements → PB-004 Route/Page/UX/Public Surfaces → PB-005 Backend & Integration Contracts → BL-001 Baseline Selection → MAT-001 Platform Binding + Venue/Event → MAT-002 Ticketing/Purchase/Capacity → MAT-003 Access/Arrival/Credential → MAT-004 Gate/Admission → MAT-005 Incident Register → MAT-006 Read-only Analytics Projection → GJ1 Golden Club Journey.
PB-002 closure does not authorize PB-003 execution, Base44 creation, database schema, migrations, LIVE integrations or production. The next gate requires a fresh reconciliation and explicit user authorization.
19. PB-002 closure statement
AIRC-PB-002 — ENTITY & DATA CONTRACT = CLOSED — DESIGN PASS WITH OPEN DEPENDENCIES. The canonical AIRenClub data model is sufficiently defined to proceed to RBAC/RLS/Entitlements design while the HOLD register remains non-materializable. This closure is a design/governance closure only and is not runtime, security, legal or production certification.