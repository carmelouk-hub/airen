AIRenClub — Route, Page & UX Surface Catalog
v0.1 — AIRC-PB-004
STATUS: CANONICAL DESIGN CONTRACT — PB-004 CLOSED / DESIGN PASS WITH OPEN DEPENDENCIES. This document freezes the semantic route/surface catalog, actor/scope requirements, permission/entitlement mapping, public-projection boundary and canonical user journeys for AIRenClub. It does not freeze final graphic design and does not authorize Base44/runtime implementation.
0. Authority and lineage
AIRenClub is a native AIRenOS vertical. AIRenOS owns Identity, Session, Organization, ProductAccess, Tenant/Location membership, ProductSubscription, Entitlements, Purpose Authorization, Jurisdiction and platform governance. AIRenClub owns the Nightlife operational surfaces defined here.
Upstream authority: AIRenClub PB-002 Entity & Data Contract and PB-003 RBAC/RLS/Entitlements Contract. AIRenOS Vertical Contract requires every route to declare route_id, path, route_type, public/private state, required product, entitlement, permission, Tenant context, Location context and fallback behavior.
RISTOAIREN Route/Page/UX Catalog was used only as a design-pattern precedent. AIRenClub route semantics are defined independently for nightlife.
1. Canonical UX formula
ROUTE / SURFACE → Actor → SecurityContext or validated Public Context → Permission → Entitlement → Tenant/Location/Event scope → Backend Function or Public Projection → DTO → UX State.
A route is never authority. Knowing or guessing a URL cannot grant access. Menu visibility, disabled buttons and frontend guards improve UX only; server-side authorization and RLS remain mandatory.
2. Surface classes
SURFACE-A — AIRenOS Entry / Product Handoff. AIRenOS product launcher, Tenant/Location context selection, subscription/readiness handoff.
SURFACE-B — AIRenClub Management Console. Desktop/tablet configuration, event setup, ticketing, access planning and analytics.
SURFACE-C — AIRenClub Operational Workstation. High-frequency event/gate operations.
SURFACE-D — Mobile Manager / Mobile Ops. Alerts, live flow, operational review and limited approvals.
SURFACE-E — Public Discovery. Public venue/event/ticket projections resolved through TenantDomain.
SURFACE-F — Guest Transaction & Boarding. Purchase, policy acknowledgement, Arrival Slot, boarding pass and credential presentation. Design-defined now; runtime remains blocked where Guest Runtime Authority is unresolved.
SURFACE-G — External Display / Signage. Read-only event/gate/boarding information from sanctioned projections.
SURFACE-H — Future Kiosk / Turnstile / Hardware UI. RESERVED until PB-005/adapter contracts.
3. Device profiles
DEV-01 DESKTOP_ADMIN — configuration, events, ticketing, roles, analytics, incident review.
DEV-02 TABLET_OPS — event floor/access operations and mobile management.
DEV-03 MOBILE_MANAGER — live metrics, alerts, quick operational actions.
DEV-04 GATE_SCANNER — dedicated high-frequency scan/admission surface with minimal data.
DEV-05 PUBLIC_WEB — responsive discovery and event information.
DEV-06 GUEST_MOBILE — purchase/boarding pass/arrival/gate instructions.
DEV-07 EVENT_DISPLAY — public or staff signage/read-only flow information.
DEV-08 KIOSK_TURNSTILE — FUTURE / RESERVED.
4. Route naming and context
Canonical Surface IDs are provider-independent. Physical URLs may change by implementation. Suggested authenticated pattern: /app/:tenantSlug/:locationSlug/club/<domain>. Suggested public pattern: hostname resolved by AIRenOS TenantDomain → public AIRenClub route. Guest transaction routes must never trust tenant_id/location_id from query/body as authority.
Location-scoped surfaces must expose the active Location context clearly. Multi-location surfaces must display the explicit authorized Location set and may not interpret missing Location as wildcard.
5. AIRenOS entry and core navigation
AIRC-UX-001 — Product Entry / AIRenOS Handoff. Private. Actors: AIRenOS-authorized product users. Required product: airenclub. Entitlement: airenclub.core.enabled. Purpose: validate ProductAccess, Tenant/Location context and redirect to allowed AIRenClub surface. Fallback: access/subscription/readiness state, never guessed Tenant.
AIRC-UX-002 — Context Selector. Private. Permission: access.location_scope.read. Shows only authorized Tenants/Locations. A context switch triggers server validation and SecurityContext refresh.
AIRC-UX-003 — AIRenClub Navigation Shell. Private. Permission/entitlement-aware menu. Hidden route ≠ authorization. Navigation groups: Club, Events, Ticketing, Access, Gate, Safety, Analytics, Administration.
6. Management dashboard surfaces
AIRC-UX-010 — Club Dashboard. Private, Location-scoped. Actors: tenant_admin, club_manager; subsets for event/access managers. Entitlements: core plus active modules. Data: current event/session status, ticket sales summary, expected arrivals, current arrival slot load, gate readiness, admissions, incidents count, operational alerts. Source: sanctioned read models, not raw cross-domain dumps.
AIRC-UX-011 — Multi-Location Control Tower. Private. Permission: analytics.multi_location.read. Entitlement: airenclub.multi_location_control_tower.enabled. RLS-C4. Only explicitly authorized Locations contribute. Activation: DESIGN_READY, runtime depends on later projection materialization.
AIRC-UX-012 — Live Event Overview. Private, Session-scoped. Actors: club_manager, event_manager, access_manager. Shows sales cutoff, attendance forecast, Arrival Slot load, Priority/VIP mix, gate assignments, scan/admission counters and incident alerts.
7. Club configuration surfaces
AIRC-UX-020 — Club Operating Profile. Private. Permission: club.profile.read/update. Location-scoped. Purpose: nightlife-specific profile attached to AIRenOS Location.
AIRC-UX-021 — Venue Zones. Private. Permission: venue.zone.read/manage. Location-scoped. Manages named operational zones and zone relationships without redefining AIRenOS Location.
AIRC-UX-022 — Gates. Private. Permission: gate.read/manage. Entitlement: airenclub.gate.enabled. Location-scoped. Configures gate identity and operational availability; hardware adapter configuration remains PB-005.
AIRC-UX-023 — Capacity Policies. Private. Permissions: capacity.policy.read/configure; high-impact approval via capacity.policy.approve. Location/Event scope. Physical/safety limits cannot be increased by commercial UI without governed policy.
AIRC-UX-024 — Access Class Catalog. Private. Permissions: access_class.read/configure/publish. Tenant-scoped. Standard, Priority and VIP are configurations, not separate entitlement models.
8. Event design and programming surfaces
AIRC-UX-030 — Events. Private. Permission: event.read; mutations by event.create/update/publish/cancel. Entitlement: airenclub.events.enabled. Location-scoped event list/calendar.
AIRC-UX-031 — Event Workspace. Private. Event detail shell with tabs/sections: Overview, Sessions, Format, Access Policy, Ticket Products, Capacity, Arrival & Boarding, Gates, Sales, Live, Scorecard.
AIRC-UX-032 — Event Session Editor. Private. Permissions: event.session.read/create/update/open/close. Defines operational occurrence/time window.
AIRC-UX-033 — Event Format Library. Private. Permissions: event.format.read/manage/publish. Tenant-scoped. Stores configurable format profiles; no Golden Hour/Cosplay/Afrobeat hardcoding in route logic.
AIRC-UX-034 — Event Access Policy. Private. Permissions: event.access_policy.read/configure/publish. Customer-visible projection includes only published relevant policy fields.
AIRC-UX-035 — Ticket Products. Private. Permissions: ticket_product.read/create/update/publish/sales.close. Entitlement: airenclub.ticketing.enabled. Pricing authority ultimately belongs to server-side contract.
AIRC-UX-036 — Arrival & Boarding Planner. Private. Permissions: arrival_slot.read/configure/open/close; boarding_group.read/configure/call/close. Entitlement: airenclub.arrival_flow.enabled. Shows capacity by slot, forecast, class mix and gate plan.
AIRC-UX-037 — Priority / VIP Configuration. Private. Entitlement: airenclub.priority_vip.enabled. Permissions: access_class.* plus relevant slot/gate configuration. Priority is represented as service/flow configuration, not duplicate ticket authority.
9. Ticketing and purchase support surfaces
AIRC-UX-040 — Sales & Purchases. Private. Permissions: purchase.read, with purchase.read_private for personal/contact fields. Entitlement: airenclub.ticketing.enabled. Search/filter by event/session/state without exposing safety data.
AIRC-UX-041 — Purchase Detail / Support. Private. Actors: ticketing_operator, club_manager, tenant_admin as permitted. Functions: purchase support, bounded cancellation/compensation request, entitlement/credential status. Incident/restriction history is excluded.
AIRC-UX-042 — Capacity Reservation Monitor. Private. Read-only operational view for managers. Capacity hold mutations remain SYSTEM_GOVERNED; no manual generic CRUD.
AIRC-UX-043 — Credential Support. Private. Permissions: credential.read_status; credential.issue/rotate/revoke only for authorized access roles. Raw bearer token is never shown as reusable internal data.
10. Access planning surfaces
AIRC-UX-050 — Access Operations Dashboard. Private, Session-scoped. Actors: access_manager, club_manager. Shows active entitlements aggregate, slot load, boarding groups, gate assignments, credential readiness and admission progress.
AIRC-UX-051 — Access Entitlement Detail. Private/minimized. Permission: access_entitlement.read; mutations by grant/suspend/revoke/class_change. Sensitive subject fields require their own permission; the page never treats credential validity as access authority.
AIRC-UX-052 — Access Allocation Planner. Private. Permissions: access_allocation.read/assign/reassign. Entitlement: airenclub.arrival_flow.enabled. Enforces same EventSession/Slot/BoardingGroup scope.
AIRC-UX-053 — Boarding Group Board. Private operational board with call/close actions. Can feed signage projection without exposing private guest records.
11. Gate and admission surfaces
AIRC-UX-060 — Live Gate Mode Control. Private. Actors: access_manager, club_manager. Permissions: live_gate.read/activate/close. Entitlement: airenclub.gate.enabled. Entering LIVE_GATE mode is explicit, visible and auditable; it does not create a commercial override permission.
AIRC-UX-061 — Gate Scanner. Private operational surface optimized for DEV-04. Permission: gate.scan.execute. Shows only minimal validated response: ALLOW/DENY/REVIEW, access class, arrival/boarding context, minimal holder display field when policy permits, and reason category safe for operator. It must not expose raw verification, CRM or incident history.
AIRC-UX-062 — Admission Action. Private. Permission: admission.record. Successful scan does not silently equal admission unless the governed service records AdmissionRecord. Duplicate/anti-passback outcome is explicit.
AIRC-UX-063 — Admission Log. Private. Permission: admission.read. Append-oriented timeline for authorized Session/Location. Correction requires admission.correct and explicit reason.
AIRC-UX-064 — Gate Assignment. Private. Permission: gate_assignment.read/manage. Assigns configured Gate to Session/classes/slots/groups only within same Location.
AIRC-UX-065 — Gate Incident Quick Raise. Private. Permission: incident.raise. Minimal fast form designed for gate staff; creating Incident never creates Restriction.
12. Safety and restriction surfaces
AIRC-UX-070 — Incident Register. Private. Entitlement: airenclub.incidents.enabled. Permission: incident.read; sensitive detail requires incident.read_sensitive plus Purpose policy.
AIRC-UX-071 — Incident Detail. Private. Shows factual timeline, subjects, evidence references and correction history according to permissions. No stigmatizing free-form person label is used as a decision shortcut.
AIRC-UX-072 — Incident Review. Private, CORE_LATER. Permission: incident.review. Human-authenticated workflow; Purpose Authorization required where sensitive data is processed.
AIRC-UX-073 — Access Decision. Private, DESIGN_READY / RUNTIME_BLOCKED. Permission: access_decision.approve. Requires restrictions entitlement, Jurisdiction/Purpose dependencies and human authority.
AIRC-UX-074 — Restrictions. Private, DESIGN_READY / RUNTIME_BLOCKED. Permissions: restriction.read/apply/revoke/review. Entitlement: airenclub.restrictions.enabled. Organization-wide cross-Tenant effect remains blocked.
13. Analytics surfaces
AIRC-UX-080 — Event Analytics. Private. Permission: analytics.read. Entitlement: airenclub.analytics.enabled. Shows sanctioned aggregated metrics: ticket conversion, attendance, no-show, arrival deviation, slot load, gate throughput, queue indicators, Priority/VIP revenue, incident rate and repeat indicators when available.
AIRC-UX-081 — Event Scorecard. Private, CORE_LATER. Links EventFormat/Experiment outcomes to approved KPIs; no raw sensitive customer/safety data.
AIRC-UX-082 — Multi-Location Analytics. Private. Permission: analytics.multi_location.read. Entitlement: multi_location_control_tower. RLS-C4 explicit authorized Location set.
14. Access administration surfaces
AIRC-UX-090 — AIRenClub Roles & Access. Private. Actors: tenant_admin with governed authority. Permissions: access.product_role.read/assign/revoke. Does not expose or mutate AIRenOS platform roles.
AIRC-UX-091 — Location Scope. Private. Shows current Location memberships from AIRenOS references. AIRenClub can request governed changes where supported but cannot directly rewrite AIRenOS membership records.
AIRC-UX-092 — Entitlements & Module Availability. Private/read-only product status. Shows module enabled/disabled state from AIRenOS ProductSubscription/Entitlements. Commercial changes route back to AIRenOS authority.
15. Public discovery surfaces
AIRC-PUB-001 — Public Venue Landing. Public. TenantDomain-resolved. Projection: published ClubOperatingProfile and approved venue content only.
AIRC-PUB-002 — Public Events. Public. Projection: published Event/EventSession/EventFormat summary, availability state and customer-visible policy markers.
AIRC-PUB-003 — Event Detail. Public. Projection: event/session, published Access Policy, TicketProduct projection, ArrivalSlot availability projection, AccessClass options and deliberate Partner/public content.
AIRC-PUB-004 — Ticket Selection. Public. Entitlement dependency: airenclub.ticketing.enabled. Reads sanctioned offers/availability only. Any purchase mutation requires guest/public application-service contract and does not accept raw tenant_id as authority.
AIRC-PUB-005 — Public Policy / Code of Conduct. Public. Shows the exact published customer-visible EventAccessPolicy version and applicable arrival/access conditions.
16. Guest transaction and boarding surfaces
AIRC-GST-001 — Checkout. DESIGN_READY / RUNTIME_BLOCKED pending Guest Runtime Authority and PB-005 contracts. Journey: selected offer → eligibility → contact/minimized subject data → policy acceptance → capacity hold → payment handoff → result.
AIRC-GST-002 — Purchase Result. DESIGN_READY / RUNTIME_BLOCKED. Shows confirmed/pending/failed/compensation-required result without exposing provider secrets.
AIRC-GST-003 — Digital Boarding Pass. DESIGN_READY / RUNTIME_BLOCKED until secure guest retrieval/session contract. Canonical cards: Event, Session, status, Arrival Slot, Boarding Group, Access Class, Gate when assigned, credential state and customer-visible policy reminders.
AIRC-GST-004 — Arrival Slot Selection/Change. DESIGN_READY / RUNTIME_BLOCKED. Uses live sanctioned availability and governed reassignment; cannot exceed capacity.
AIRC-GST-005 — Credential Presentation. DESIGN_READY / RUNTIME_BLOCKED. Renders QR/Wallet/NFC representation from secure credential service. Credential is not the legal/operational entitlement itself.
AIRC-GST-006 — Gate Instructions. DESIGN_READY. Shows gate, arrival window, boarding status and public-safe operational instructions. Must degrade safely if assignment is unavailable.
AIRC-GST-007 — Ticket/Access Support. DESIGN_READY / RUNTIME_BLOCKED. Provides recovery/contact path without exposing internal purchase, identity-verification or restriction reasoning.
17. External display surfaces
AIRC-DSP-001 — Boarding / Arrival Display. Read-only sanitized projection: current boarding groups, public gate instructions and operational timing. No names, credentials or private guest information.
AIRC-DSP-002 — Event Information Screen. Public-safe event/format content and status.
AIRC-DSP-003 — Gate Status Screen. Staff/public variant depending deployment. Must never reveal credential or incident data.
18. UX states and failure behavior
Every interactive surface must support at least: LOADING, READY, EMPTY, VALIDATION_ERROR, AUTHORIZATION_DENIED, ENTITLEMENT_DISABLED, PURPOSE_REVIEW_REQUIRED when relevant, CONFLICT/STALE_VERSION, OFFLINE_OR_DEGRADED, RETRYABLE_FAILURE and TERMINAL_FAILURE.
A disabled module should route to an entitlement/module-availability state, not a broken page. A denied permission should not reveal hidden resource existence. Cross-Tenant/cross-Location attempts fail closed.
Critical mutations require explicit success/failure feedback and idempotent retry behavior where backend contract requires it. Optimistic UI cannot fabricate successful admission, payment or restriction state.
19. Gate degraded/offline UX
Gate operation is safety-critical. Offline or stale state must be visually explicit. The client must not silently treat cached eligibility as current authority.
PB-004 freezes only the UX rule: OFFLINE/DEGRADED is a distinct state and any offline admission policy must be defined in PB-005/Test Contract before implementation. No offline bypass is authorized here.
20. Canonical customer journey
Public Discovery → Event Detail → Ticket Selection → Checkout → Purchase Result → Digital Boarding Pass → Arrival Slot → Access Class/Priority/VIP → Credential Presentation → Gate Instructions → Gate Scan → Admission.
This journey mirrors the PB-002 Golden Club Journey but separates public discovery, guest transaction, private operational validation and admission fact. The night starts digitally before arrival; the gate should primarily validate pre-existing governed rights rather than negotiate them.
21. Canonical operator journey
AIRenOS Handoff → Club Dashboard → Event Workspace → Session → Ticket/Capacity → Arrival & Boarding Planner → Gate Assignment → Live Gate Mode → Gate Scanner/Admission → Live Overview → Incident Quick Raise when necessary → End-of-event Analytics.
22. Surface activation matrix
DESIGN_ACTIVE for first implementation planning: AIRC-UX-001..003; 010; 020..024; 030..037; 040..043; 050..053; 060..065; 070..071; 080; 090..092; AIRC-PUB-001..005.
DESIGN_READY / RUNTIME_BLOCKED pending PB-002/PB-003 dependencies: Incident Review where sensitive Purpose flow is required; Access Decision; Restrictions; Checkout; Purchase Result; Digital Boarding Pass secure retrieval; Arrival Slot guest mutation; Credential Presentation; Guest support.
CORE_LATER/FUTURE: Event Scorecard, advanced Control Tower, AI/adaptive surfaces, Mobility, kiosk/turnstile hardware-specific UI.
23. PB-004 acceptance criteria
T-AIRC-UX-001 unauthorized route access is denied server-side even if URL is known.
T-AIRC-UX-002 hidden menu item is not used as security evidence.
T-AIRC-UX-003 Location-scoped surface cannot display foreign-Location data.
T-AIRC-UX-004 Multi-Location surfaces aggregate only authorized Locations.
T-AIRC-UX-005 module-disabled route shows entitlement state and no protected data.
T-AIRC-UX-006 public routes consume only sanctioned public projections.
T-AIRC-UX-007 public event URL manipulation cannot select arbitrary Tenant authority.
T-AIRC-UX-008 Gate Scanner exposes only minimal gate DTO.
T-AIRC-UX-009 valid credential UI cannot override revoked Entitlement.
T-AIRC-UX-010 successful scan does not fabricate AdmissionRecord.
T-AIRC-UX-011 incident quick-raise does not create restriction state.
T-AIRC-UX-012 sensitive incident detail is permission+Purpose gated.
T-AIRC-UX-013 guest transactional routes remain unavailable when Guest Runtime Authority is unavailable.
T-AIRC-UX-014 stale/conflict state cannot silently overwrite newer state.
T-AIRC-UX-015 offline gate state is explicitly distinguishable from current online authority.
T-AIRC-UX-016 route catalog remains Tenant-neutral and contains no hardcoded Country/Corte/other customer logic.
24. Open decisions
AIRC-PB4-OD-001 final URL scheme and router implementation — defer to baseline selection.
AIRC-PB4-OD-002 secure guest access/session/retrieval mechanism for Boarding Pass — HOLD inherited from PB-002.
AIRC-PB4-OD-003 offline gate admission behavior — defer PB-005/Test Contract; no bypass authorized.
AIRC-PB4-OD-004 device/hardware binding and turnstile/kiosk UI — future adapter contract.
AIRC-PB4-OD-005 final visual design system and responsive component library — implementation design, not route authority.
AIRC-PB4-OD-006 notification/deep-link behavior into guest Boarding Pass — defer PB-005.
AIRC-PB4-OD-007 exact restriction/decision UX remains blocked until Jurisdiction/Purpose/runtime dependencies are resolved.
25. PB-004 closure and next gate
AIRC-PB-004 — ROUTE, PAGE & UX SURFACE CATALOG = CLOSED — DESIGN PASS WITH OPEN DEPENDENCIES. AIRenClub now has a provider-independent surface catalog mapped to actor, permission, entitlement, Tenant/Location scope, public projection boundary and canonical journeys.
PB-004 does not authorize UI implementation. The next design gate is AIRC-PB-005 — Backend & Integration Contracts, where application services, public/guest functions, payment/identity/gate adapters, idempotency, audit, offline behavior and provider boundaries will be defined before baseline/Base44 selection.