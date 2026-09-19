AIRenClub — RBAC, RLS & Entitlements Contract
v0.1 — AIRC-PB-003
STATUS: CANONICAL DESIGN CONTRACT — PB-003 CLOSED / DESIGN PASS WITH OPEN DEPENDENCIES. This document defines AIRenClub product roles, atomic permissions, entitlement boundaries, RLS/backend policy classes, sensitive-data access controls, denial model and security acceptance requirements. It does not authorize runtime, Base44, database schema, migrations, production, real PII, real payments or real restrictions.
0. Authority and lineage
AIRenClub is a native AIRenOS vertical. AIRenOS remains authority for Identity, Session, Organization, ProductAccess, TenantMembership, LocationMembership, ProductSubscription, Entitlements, Purpose Authorization, Jurisdiction, platform roles, platform audit, secrets and shared service governance.
Upstream canonical sources reconciled before write: AIRenClub PB-002 Entity & Data Contract; AIRenOS Security & Audit Bible; Identity & Organization Specification; Product Catalog / Subscription / Entitlements; Vertical Contract; AIRenClub Product Bible; RULE-DOC-20; RULE-DOC-21; Program Control. RISTOAIREN RBAC & RLS Matrix was used only as a pattern precedent for AIRenOS-compatible control classes, not as AIRenClub authority.
PB-002 authority: Drive 1U3ZDDVOy2Kd5Twbtv5Ny0hy3gDy6mpecY7Z9wxIAOeY; GitHub branch airenclub/pb-002-entity-data-20260919; commit 033283bed2c8064cdcfcee5bad09ccad3e6bbc67.
1. Security formula and authorization layers
For authenticated staff/admin operations, final access requires: Authenticated Identity + valid Session + valid Organization/ProductAccess + TenantMembership + required LocationMembership when Location-scoped + atomic Permission + required Entitlement + PurposePolicyDecision=ALLOW when purpose-sensitive + RLS/backend policy PASS + domain validation PASS.
No single layer substitutes another. Role is only a permission bundle. Entitlement grants commercial capability, not data access. LocationMembership scopes data but does not grant action permission. Purpose Authorization does not grant membership or permission. RLS does not grant commercial entitlement.
Authorization layers: Layer 0 AIRenOS Platform Role; Layer 1 Organization Membership; Layer 2 Product Access; Layer 3 Tenant Membership; Layer 4 Location Membership; Layer 5 AIRenClub Product Role / atomic Permission; Layer 6 Entitlement; Layer 7 Purpose Authorization when applicable; Layer 8 RLS/backend policy and domain invariants.
The client is never authority for tenant_id, location_id, role, entitlement, purpose, admission eligibility, restriction applicability or service-role scope.
2. Public and guest boundary
AIRenClub staff RBAC does not apply by inventing TenantMembership for public guests. Public event discovery uses AIRenOS TenantDomain resolution plus AIRenClub Public Projection services. Guest purchase/access workflows require a separately governed public/guest runtime contract.
PB-003 does not create GuestSession, public bearer authority or automatic AIRenOS accounts. OperationalSubject remains independent from AIRenOS Identity. Public/guest mutations must later use purpose-built application services with anti-abuse, validated context, idempotency and minimized data.
3. Non-negotiable RBAC principles
RBAC-P01 Frontend visibility is UX, not security.
RBAC-P02 Product roles are bundles; atomic permission is the action authority.
RBAC-P03 Permission not registered = DENY.
RBAC-P04 Cross-Tenant = DENY by default.
RBAC-P05 Cross-Location beyond authorized membership = DENY by default.
RBAC-P06 Parent-child scope must be server-validated.
RBAC-P07 Product role never grants AIRenOS platform role or SaaS billing authority.
RBAC-P08 Entitlement never bypasses Permission, Membership, Purpose or RLS.
RBAC-P09 Sensitive customer, verification, incident and restriction data require dedicated permissions and, when applicable, Purpose Authorization.
RBAC-P10 Service role is server-only, scoped, justified and audited; it cannot bypass application authorization or RLS.
RBAC-P11 Append-oriented facts cannot be arbitrarily updated/deleted.
RBAC-P12 AI obtains no authority from prompts, model confidence or recommendations.
RBAC-P13 Role and scope changes require governed services and session/security-context re-evaluation.
RBAC-P14 High-impact safety/restriction decisions require human-authenticated authority in the baseline.
4. AIRenClub baseline product roles
The baseline role catalog is intentionally compact. Roles are default bundles and may not imply every capability in all plans.
tenant_admin — broad AIRenClub product administration inside the Tenant. Can manage allowed product-role assignments through governed services. No platform role, SaaS billing or automatic Purpose override. Location-scoped operations still require valid scope/aggregated authority.
club_manager — broad operational management on authorized Locations: venue configuration, events, ticketing configuration, flow, gates, operational analytics and non-sensitive incident visibility according to permissions.
event_manager — event/session/format/access-policy/ticket-product/capacity/arrival configuration. No implicit role administration, restriction authority or sensitive incident review.
access_manager — operational authority for arrival slots, boarding groups, access allocations, credentials, gates and Live Gate Mode on authorized Locations. No automatic pricing, role management or restriction authority.
gate_operator — minimal door-operation bundle: evaluate credentials through governed service, record admission/exit, view only minimal access status and raise an incident. No raw customer profile, document details, pricing configuration or eligibility override by default.
safety_officer — incident and safety-review bundle on authorized Locations. Sensitive reads require explicit permission and Purpose policy. AccessDecision/Restriction permissions remain inactive unless the restrictions capability and jurisdiction/purpose dependencies are explicitly enabled.
ticketing_operator — purchase/ticket support bundle: ticket-product read, purchase support, bounded cancellation/compensation requests and minimal delivery/contact data. No incident/restriction access and no AIRenOS billing authority.
analyst — read-only aggregate analytics/projections. No raw sensitive entity access and no mutation authority. Multi-location analytics requires explicit scope and entitlement.
operator — minimal generic bundle for future scoped workflows. No sensitive privileges by inheritance; all permissions must be explicit.
Reserved future bundles may include partner_manager or compliance-oriented roles, but they are not active baseline roles until corresponding capabilities are promoted.
5. Role assignment governance
Product role assignment is Tenant-scoped and must use a governed application service. Baseline permissions: access.product_role.read, access.product_role.assign, access.product_role.revoke, access.product_role.assign_protected, access.location_scope.read, access.location_scope.request_change.
tenant_admin may assign/revoke non-protected AIRenClub roles within its authorized Tenant when holding access.product_role.assign. Assignment of tenant_admin itself is protected and requires access.product_role.assign_protected plus AIRenOS Organization/Tenant authority policy.
club_manager and other operational roles cannot assign tenant_admin or mutate AIRenOS platform roles. Self-promotion is denied. Product roles never mutate platform_super_admin, platform_operator, Organization roles or ProductAccess.
6. Permission naming standard
Canonical pattern: domain.resource.action or domain.action where resource is implicit. Standard actions: read, read_private, read_sensitive, create, update, publish, configure, open, close, cancel, suspend, revoke, issue, rotate, assign, reassign, execute, approve, correct, export, anonymize, manage.
Permission keys are atomic security contracts. UI labels or role names are not substitutes. Unregistered permission = DENY.
7. Core permission catalog
7.1 Venue, event and policy
club.profile.read; club.profile.update; venue.zone.read; venue.zone.manage; capacity.policy.read; capacity.policy.configure; capacity.policy.approve; event.read; event.create; event.update; event.publish; event.cancel; event.session.read; event.session.create; event.session.update; event.session.open; event.session.close; event.format.read; event.format.manage; event.format.publish; event.access_policy.read; event.access_policy.configure; event.access_policy.publish.
7.2 Ticketing, purchase and capacity
ticket_product.read; ticket_product.create; ticket_product.update; ticket_product.publish; ticket_product.sales.close; purchase.read; purchase.read_private; purchase.support; purchase.cancel; purchase.compensation.request; purchase.compensation.approve; capacity_reservation.read. CapacityReservation hold/consume/release mutations are SYSTEM_GOVERNED and are not exposed as general human CRUD permissions.
7.3 Subject, verification and policy acceptance
subject.read_basic; subject.read_private; subject.link_identity; subject.anonymize; verification.read_result; verification.request; policy_acceptance.read. Full document images/raw provider evidence are not authorized by these permissions.
7.4 Access, arrival and credentials
access_entitlement.read; access_entitlement.grant; access_entitlement.suspend; access_entitlement.revoke; access_entitlement.class_change; access_allocation.read; access_allocation.assign; access_allocation.reassign; credential.read_status; credential.issue; credential.rotate; credential.revoke; arrival_slot.read; arrival_slot.configure; arrival_slot.open; arrival_slot.close; boarding_group.read; boarding_group.configure; boarding_group.call; boarding_group.close; access_class.read; access_class.configure; access_class.publish.
7.5 Gate and admission
gate.read; gate.manage; gate_assignment.read; gate_assignment.manage; gate.scan.execute; admission.read; admission.record; admission.correct; live_gate.read; live_gate.activate; live_gate.close. admission.correct is high-risk and audited. No generic access_override permission is defined in the baseline.
7.6 Incident, review and restriction
incident.read; incident.read_sensitive; incident.raise; incident.correct; incident.review; access_decision.read; access_decision.approve; restriction.read; restriction.apply; restriction.revoke; restriction.review. access_decision.approve and restriction.* mutation permissions are HUMAN_ONLY baseline and remain runtime-disabled until PB-002 HOLD dependencies and entitlement/jurisdiction/purpose requirements are satisfied.
7.7 Partner, attribution and analytics
partner.read; partner.manage; partner.engagement.manage; attribution.read; attribution.recalculate; analytics.read; analytics.multi_location.read; analytics.export. Raw sensitive customer/safety data is not granted by analytics permissions.
7.8 AI reserved permissions
ai.recommendation.read; ai.recommendation.approve are RESERVED/FUTURE. They do not authorize direct Core writes. AI tool contracts in PB-005 must still require the underlying human-equivalent permissions and Purpose decision.
8. Sensitive-data access policy
gate_operator receives only a minimal gate projection: entitlement eligibility result, access class, arrival/boarding context, credential status and minimum holder display fields required by policy. It does not receive raw verification evidence, full profile, marketing history, incident history or restriction reasoning by default.
ticketing_operator may receive purchase/contact data necessary for support when holding purchase.read_private; it receives no incident/restriction data by inheritance.
safety_officer may receive incident.read_sensitive only inside authorized scope and with the required Purpose decision. Sensitive safety data cannot be reused for marketing/segmentation simply because the actor can read it for safety review.
tenant_admin does not bypass Purpose Authorization or sensitive-data permissions. Platform-super-admin exceptional access remains governed by AIRenOS, not by an AIRenClub role bundle.
analyst reads sanctioned projections. Raw OperationalSubject, VerificationAssertion, Incident, AccessRestriction or GateScan-level personal data are excluded unless a separate authorized analytical projection contract exists.
9. Entitlement catalog
airenclub.core.enabled — base AIRenClub operating capability and prerequisite for all product modules.
airenclub.events.enabled — Event, EventSession, EventFormat and EventAccessPolicy management.
airenclub.ticketing.enabled — TicketProduct, PurchaseIntent/Purchase and commercial access issuance workflow.
airenclub.arrival_flow.enabled — ArrivalSlot, BoardingGroup and AccessAllocation features.
airenclub.priority_vip.enabled — premium AccessClass/Priority/VIP configuration.
airenclub.gate.enabled — Gate, GateAssignment, GateScan, AdmissionRecord and Live Gate operations.
airenclub.incidents.enabled — Incident Register and non-restriction safety workflow.
airenclub.restrictions.enabled — AccessDecision/AccessRestriction workflow. DESIGN CATALOGED but runtime activation is BLOCKED until jurisdiction/purpose/organization-scope dependencies are satisfied.
airenclub.crm.enabled — CustomerClubProfile and relationship features, CORE_LATER.
airenclub.identity_verification.enabled — governed VerificationAssertion/provider integration, CORE_LATER.
airenclub.partner_attribution.enabled — Partner, Engagement and Attribution, CORE_LATER.
airenclub.analytics.enabled — Event/operational analytics projections.
airenclub.multi_location_control_tower.enabled — explicit multi-location aggregate projections; does not grant Location scope by itself.
airenclub.ai_assist.enabled — governed recommendations only, FUTURE.
airenclub.adaptive_flow.enabled — autonomous bounded adaptation inside approved guardrails, FUTURE.
airenclub.mobility.enabled — mobility integration, FUTURE.
Shared AIRenOS quota entitlements such as locations.max, users.max, storage.max or ai.monthly_usage_limit remain AIRenOS Product Catalog authority and are consumed rather than duplicated by AIRenClub.
10. Permission-to-entitlement rule
A permission may exist in a role bundle while the corresponding commercial capability is disabled. Example: gate.scan.execute + airenclub.gate.enabled=false => DENY. Conversely airenclub.gate.enabled=true without gate.scan.execute => DENY.
Entitlements are evaluated server-side. Feature flags may stage rollout but cannot create commercial rights absent an entitlement. ProductSubscription state, entitlement state and security scope remain distinct.
11. RLS / backend policy classes
RLS-C0 PLATFORM_GLOBAL — AIRenOS-owned reference, not an AIRenClub data row authority.
RLS-C1 TENANT_WIDE — row.tenant_id must belong to authorizedTenantIds; no wildcard interpretation from location_id null.
RLS-C2 LOCATION_SCOPED — row.tenant_id must match trusted Tenant and row.location_id must be in authorizedLocationIds for that Tenant.
RLS-C3 PARENT_INHERITED — child scope is derived from a server-loaded parent; client-supplied alternative scope is ignored/denied.
RLS-C4 MULTI_LOCATION_AGGREGATE — aggregation only over an explicit authorized Location set; unauthorized Locations contribute no rows or metrics.
RLS-C5 PUBLIC_PROJECTION — anonymous/public access is via TenantDomain + validated public context + whitelist DTO; never raw private entity read.
RLS-C6 SYSTEM_GOVERNED — mutations allowed only through governed application services with authority, validation, idempotency and audit.
RLS-C7 APPEND_OR_REVERSAL — historical facts cannot be arbitrary update/delete; corrections use new facts, reversal, compensation or superseding version.
12. Entity-to-RLS mapping
CORE_MVP mapping: ClubOperatingProfile C2; VenueZone C3; CapacityPolicy C2/C3 by target; Event C2; EventSession C3; EventAccessPolicy C3+C7; TicketProduct C3+C7; PurchaseIntent C3+C6; Purchase C3+C6+C7; PurchaseLine C3+C7; CapacityReservation C3+C6; AccessEntitlement C3+C6; AccessAllocation C3+C6; AccessCredential C3+C6; ArrivalSlot C3; BoardingGroup C3; AccessClass C1; Gate C2; GateAssignment C3; GateScan C3+C7; AdmissionRecord C3+C7; LiveGateState C3+C6; OperationalSubject C1; PolicyAcceptance C3+C7; Incident C2+C7; IncidentSubject C3; EventFormat C1+C7.
CORE_LATER mapping: CustomerClubProfile C1; SubjectIdentityLink C1+C6+C7; VerificationAssertion C1+C6+C7; Partner C1; PartnerRole C3 inheriting Tenant scope; PartnerEngagement C3; AttributionTouch C3+C7; AttributionCredit C3+C7; IncidentEvidenceReference C3+C6; IncidentReview C3+C7; AccessDecision C1+C6; AccessRestriction C1+C6; RestrictionSubject C3; RestrictionReview C3+C7; AudienceSegment C1; EventExperiment C4 when multi-location; EventScorecard C3; NightlifeAnalyticsProjection C4; ControlTowerProjection C4.
RLS-C5 is an overlay only for explicitly approved public projections. C6/C7 are behavioral overlays and do not replace Tenant/Location predicates.
13. Service-role policy
Service-role/database-privileged execution cannot be called directly from the client. Every privileged function must declare WHY, WHO, SCOPE, VALIDATION, ENTITIES/ACTIONS, AUDIT, IDEMPOTENCY and LIMIT.
Allowed categories include public projection internals, capacity reservation transaction workflow, payment reconciliation adapter, credential issuance/rotation, purpose/jurisdiction decision integration, migration, security fixtures and governed AI tools when separately authorized.
Anti-pattern prohibited: client → privileged role → arbitrary entity CRUD. Service-role access does not bypass Permission, Entitlement, Purpose or Tenant/Location validation.
14. Purpose Authorization matrix
Purpose-sensitive operations require a fresh/valid AIRenOS PurposePolicyDecision. Candidate AIRenClub purposes remain proposals until registered by AIRenOS: FLOW_OPTIMIZATION, EVENT_ANALYTICS, FORMAT_OPTIMIZATION, CUSTOMER_SERVICE, MARKETING_ATTRIBUTION, SAFETY_REVIEW_SUPPORT, CAPACITY_FORECASTING.
Examples: incident.read_sensitive may require SAFETY_REVIEW_SUPPORT; partner attribution customer-level processing may require MARKETING_ATTRIBUTION; analytics using person-level behavior may require EVENT_ANALYTICS; gate eligibility itself must use only the minimum purpose/policy required for access validation and must not open unrelated customer history.
A DENY or REVIEW_REQUIRED purpose outcome fails closed for the requested processing. Consent, if relevant, is evidence/input to AIRenOS policy and is not equivalent to Permission.
15. Denial reason codes
Canonical baseline: unauthenticated; session_invalid; product_access_required; membership_required; tenant_scope_required; location_scope_required; cross_tenant_denied; cross_location_denied; permission_denied; entitlement_denied; purpose_denied; purpose_review_required; sensitive_data_denied; public_projection_only; system_governed_only; append_only_denied; invalid_parent_scope; protected_role_denied; self_mutation_denied; guest_authority_unavailable; restriction_scope_not_authorized; jurisdiction_review_required; capability_runtime_disabled; conflict; stale_version.
Denials must be machine-readable without leaking sensitive policy details. Security/audit severity is determined server-side.
16. Default role-bundle matrix
tenant_admin: broad configuration/event/ticketing/access/gate/analytics permissions plus product-role governance; sensitive/restriction permissions only when explicitly included and Purpose policy allows. No platform/SaaS billing authority.
club_manager: Location-scoped club/event/ticket/access/gate configuration and operational analytics; incident.raise/read non-sensitive; no protected role assignment or restriction decision by default.
event_manager: event/session/format/policy/ticket/capacity/arrival configuration and reads; no admission correction, sensitive incident review, role management or restrictions.
access_manager: entitlement/allocation/credential/arrival/boarding/gate/live-gate operations and minimal subject read; no price administration, protected roles or restriction decision.
gate_operator: gate.scan.execute, admission.record, admission.read minimal, live_gate.read, incident.raise, credential/access eligibility projections. No credential issue/revoke by default and no admission.correct.
safety_officer: incident.read/read_sensitive/raise/correct/review in authorized scope; future access_decision/restriction permissions only when capability is active and explicitly granted. No ticket-price/role management.
ticketing_operator: ticket_product.read, purchase.read/read_private/support, bounded cancellation/compensation request, entitlement/credential status read. No safety-sensitive or role-management permissions.
analyst: analytics.read/export and optional analytics.multi_location.read when entitlement+scope permit. No raw sensitive read and no mutations.
operator: no broad baseline; explicit least-privilege permissions only.
17. High-risk operations
The following are high-risk and require explicit atomic permission, audit, reason/correlation and often human approval: access.product_role.assign_protected; purchase.compensation.approve; capacity.policy.approve where safety-impacting; admission.correct; incident.read_sensitive; incident.review; access_decision.approve; restriction.apply; restriction.revoke; restriction.review; subject.link_identity; subject.anonymize.
No high-risk operation may be implied solely by role name. AI cannot execute access_decision.approve or restriction.apply in the baseline.
18. Role-authenticated security acceptance matrix
T-AIRC-SEC-001 own-Tenant authorized read succeeds.
T-AIRC-SEC-002 cross-Tenant read denied.
T-AIRC-SEC-003 cross-Tenant write denied.
T-AIRC-SEC-004 cross-Location beyond membership denied.
T-AIRC-SEC-005 missing permission denied even with entitlement.
T-AIRC-SEC-006 missing entitlement denied even with permission.
T-AIRC-SEC-007 PurposePolicyDecision DENY/REVIEW_REQUIRED fails closed for purpose-sensitive processing.
T-AIRC-SEC-008 role mutation cannot create or mutate AIRenOS platform roles.
T-AIRC-SEC-009 tenant_admin self-promotion/protected-role escalation denied without protected assignment authority.
T-AIRC-SEC-010 gate_operator receives minimal gate DTO and cannot read raw OperationalSubject/Verification/Incident history.
T-AIRC-SEC-011 valid credential with revoked/suspended/expired Entitlement is denied.
T-AIRC-SEC-012 append-oriented GateScan/AdmissionRecord cannot be arbitrarily updated/deleted.
T-AIRC-SEC-013 service-role path cannot bypass permission, entitlement or scope checks.
T-AIRC-SEC-014 public request can access only explicit public projection DTOs.
T-AIRC-SEC-015 analyst multi-location result excludes unauthorized Locations.
T-AIRC-SEC-016 incident.raise does not grant incident.read_sensitive or restriction.apply.
T-AIRC-SEC-017 ticketing_operator cannot access safety/restriction data by purchase authority.
T-AIRC-SEC-018 AI recommendation cannot mutate Core without governed service and human-equivalent authority.
T-AIRC-SEC-019 Organization relationship alone does not allow cross-Tenant restriction enforcement.
T-AIRC-SEC-020 synthetic destructive fixtures only; no production target required for certification.
19. Open decisions / deferred runtime dependencies
AIRC-PB3-OD-001 exact Guest/public runtime authority — HOLD inherited from PB-002.
AIRC-PB3-OD-002 exact AIRenOS Purpose Authorization runtime API and decision TTL/re-evaluation semantics — HOLD / external dependency.
AIRC-PB3-OD-003 organization-wide restriction cross-Tenant enforcement — HOLD.
AIRC-PB3-OD-004 exact credential multi-active and anti-passback permission/override policy — defer PB-005.
AIRC-PB3-OD-005 custom Tenant-defined role bundles vs fixed role catalog — defer; baseline roles only.
AIRC-PB3-OD-006 fine-grained field/column security implementation technology — defer to baseline/stack selection; semantic requirement is frozen.
AIRC-PB3-OD-007 station/device/hardware operator scope below Location — defer to PB-005 if gate hardware requires it.
AIRC-PB3-OD-008 exact entitlement plan packaging/pricing — AIRenOS commercial design, not PB-003.
20. PB-003 closure and next gate
AIRC-PB-003 — RBAC, RLS & ENTITLEMENTS = CLOSED — DESIGN PASS WITH OPEN DEPENDENCIES. Product roles, atomic permission namespaces, entitlement catalog, RLS classes, sensitive-data controls, Purpose Authorization dependency, service-role policy, denial codes and acceptance matrix are sufficiently defined for Route/Page/UX/Public Surface design.
PB-003 closure is design/governance only. It does not certify runtime enforcement or create database policies. The next design gate is AIRC-PB-004 — Route, Page & UX Surface Catalog, requiring fresh RULE-DOC-20/21 reconciliation and explicit authorization before governed write.