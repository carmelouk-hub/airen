# AIRenClub PRODUCT BIBLE — v0.1 — Foundation Scope & Capability Architecture

**Status:** ACTIVE GOVERNED DRAFT — FOUNDATION DESIGN  
**Platform:** AIRenOS  
**Vertical:** AIRenClub — Nightlife Access, Safety & Flow Operating System  
**Runtime implementation:** not authorized by this document

## 0. Scope and authority

AIRenClub is a native AIRenOS vertical. It is not a standalone identity, billing, tenant, location, audit, or compliance platform. AIRenOS remains authoritative for Identity, Organization, Legal Entity, Tenant, Location, Product Catalog, subscription, SaaS billing, entitlements, Session Authority, platform roles, centralized audit, domain registry, secrets, shared services, and governance.

AIRenClub is provider independent. Base44 may serve as an Experience Layer and implementation environment but is not product authority. Country DiscoClub Palermo may become a validation tenant or pilot but must never become an architectural hardcode.

## 1. Product definition

AIRenClub governs the nightlife journey from event discovery and eligibility through ticket purchase, identity or age verification when required, arrival slot, access class, Priority/VIP, access credential, gate scan, attendance, incident review, future restriction, attribution, and operational intelligence.

Foundational principle: **the night begins digitally before the guest reaches the door.**

The QR is not the product. The operational product is the governed access entitlement. QR, Wallet, NFC, RFID, turnstile, or wearable are representations/adapters.

## 2. Non-negotiable principles

AIRC-P01 Platform First.  
AIRC-P02 Vertical Separation.  
AIRC-P03 Multi-Tenant by Design.  
AIRC-P04 Multi-Location by Design.  
AIRC-P05 Multi-Country by Design.  
AIRC-P06 Server Authority.  
AIRC-P07 AIRenOS Identity remains identity authority.  
AIRC-P08 Auditable Access.  
AIRC-P09 Governed AI.  
AIRC-P10 Privacy by Design.  
AIRC-P11 No Global Blacklist.  
AIRC-P12 Provider Portability.  
AIRC-P13 Incident facts and evidence, not unnecessary personal labels.  
AIRC-P14 Testable Architecture.

## 3. AIRenOS / AIRenClub boundary

### AIRenOS owns

Identity and Session Authority; Organization and Membership; Legal Entity; Tenant; Location; Product Catalog; subscription and SaaS billing; entitlements and feature flags; platform roles; domain registry; platform audit; secrets; shared integration governance; observability; global policy framework; Jurisdiction Engine and jurisdiction packs when materialized.

### AIRenClub owns

Club operating profile; Event and Event Session; Event Format; Venue Zone and Capacity Policy; Ticket Product; Access Entitlement; Access Credential; Arrival Slot; Boarding Group; Access Class; Priority and VIP; Gate and Gate Scan; Promoter and Community Attribution; Customer Club Relationship; Event Access Policy; Incident; Incident Review; Access Restriction; Event Experiment; Event Scorecard; nightlife analytics and domain intelligence.

### Shared capabilities

AIRenPay may serve operational payment flows when separately authorized. Messaging, identity verification, and other common services must be consumed through AIRenOS/shared contracts or adapters without duplicating authority.

## 4. Functional macro-architecture

A. Venue, Event & Capacity  
B. Ticketing & Access  
C. Arrival & Gate Flow  
D. Customer, Promoter & Community  
E. Safety & Restriction Governance  
F. Experience & Format  
G. Analytics & Intelligence  
H. Global Compliance Integration

## 5. Canonical customer journey

Discovery → Event → Eligibility Pre-Check → Ticket Selection → Identity/Age Verification when required → Purchase → Payment → Check-In → Arrival Slot → Access Class → Priority/VIP Upgrade → Digital Boarding Pass → Gate Assignment → Scan → Entry → Attendance → Event Interaction → Incident Review if any → Future Eligibility.

A venue may define a hard sales cutoff and enter LIVE GATE MODE. After cutoff, new door sales, arbitrary guest-list additions, or other unmanaged commercial overrides may be disabled according to venue policy.

## 6. Arrival Slot, Priority and Flow Engine

Arrival Slot distributes expected arrivals across time windows. Each slot may define capacity, access classes, gate allocation, and limits. Priority is both a premium service and a flow-management instrument. VIP may have dedicated windows or gates.

Manual configuration is the initial authority. Future AI may suggest or adapt parameters only inside explicit guardrails.

## 7. Safety, incidents and restrictions

Canonical lifecycle:

INCIDENT → REVIEW → ACCESS DECISION → RESTRICTION → EXPIRY/REVIEW

Candidate decisions: NO_ACTION, WARNING, PURCHASE_BLOCK, ACCESS_SUSPENSION, EVENT_BLOCK, TEMPORARY_BAN, PERMANENT_EXCLUSION.

Scope may be LOCATION, TENANT, or ORGANIZATION. Organization scope does not imply automatic global applicability. Jurisdiction determines applicability in each destination location.

**The incident originates at the Location. The decision belongs to the Tenant/Organization. Applicability is determined by Jurisdiction.**

## 8. Identity and multi-country compliance

AIRenClub should prefer verification adapters and minimized verification results over indiscriminate storage of document images.

Provisioning must distinguish country, subdivision, city where relevant, legal entity, venue location, timezone, currency, operating locale, customer locale, and jurisdiction. Language and law are separate dimensions.

Jurisdiction Packs are versioned and governed. AI may monitor and propose regulatory updates but cannot autonomously promote legal rules into production.

## 9. Event Format Engine and community

Event formats such as Golden Hour, Cosplay, Afrobeat, Y2K, or Sober Night are business experiments, not hardcoded product types.

Event Format must support audience, daypart, venue zones, music profile, bar/food references, access profile, arrival strategy, partners, content profile, and policies.

Partner types may include PROMOTER, CREATOR, INFLUENCER, COMMUNITY, UNIVERSITY, BRAND, MEDIA, ASSOCIATION, and PARTNER.

## 10. Event Experiment and Scorecard

New formats may be run as governed experiments with hypothesis, target, success criteria, and KEEP / ADJUST / RETIRE outcomes.

Target KPIs include total revenue, contribution margin, revenue per guest, ticket/bar/VIP/Priority revenue, acquisition cost, conversion, attendance, no-show, arrival deviation, gate throughput, peak queue time, incident rate, promoter/partner ROI, repeat rate, customer lifetime indicators, satisfaction, and social conversion.

## 11. AI maturity

LEVEL 1 MANUAL  
LEVEL 2 ASSISTED  
LEVEL 3 ADAPTIVE  
LEVEL 4 PREDICTIVE

For significant access restrictions, the initial model requires human review according to policy and jurisdiction. AI has no implicit permanent-ban authority.

## 12. Blue Ocean positioning

Eliminate unmanaged door selling, manual lists, arbitrary promoter overrides, commercial negotiation with security, and QR-as-authority.

Reduce random queues, crowding, fraud, conflict, untracked discretion, and manual identity processes.

Raise predictability, safety, prepaid revenue, customer knowledge, attribution, auditability, capacity control, and experience quality.

Create Digital Boarding Pass, Arrival Slot, Boarding Group, Priority Gate, Identity Pre-Clearance, Hard Sales Cutoff, Live Gate Mode, Access Eligibility, Event Format Engine, Predictive Boarding, and Global Jurisdiction Awareness.

## 13. Capability foundation

AIRC-CAP-001 Venue Profile  
AIRC-CAP-002 Event  
AIRC-CAP-003 Event Session  
AIRC-CAP-004 Venue Zone  
AIRC-CAP-005 Capacity Policy  
AIRC-CAP-006 Event Access Policy  
AIRC-CAP-007 Ticket Product  
AIRC-CAP-008 Purchase Intent  
AIRC-CAP-009 Access Entitlement  
AIRC-CAP-010 Access Credential  
AIRC-CAP-011 Arrival Slot  
AIRC-CAP-012 Boarding Group  
AIRC-CAP-013 Access Class  
AIRC-CAP-014 Priority  
AIRC-CAP-015 VIP  
AIRC-CAP-016 Gate  
AIRC-CAP-017 Gate Scan  
AIRC-CAP-018 Live Gate Mode  
AIRC-CAP-019 Customer Club Profile  
AIRC-CAP-020 Promoter  
AIRC-CAP-021 Community Partner  
AIRC-CAP-022 Attribution  
AIRC-CAP-023 Incident Register  
AIRC-CAP-024 Incident Review  
AIRC-CAP-025 Access Restriction  
AIRC-CAP-026 Restriction Review  
AIRC-CAP-027 Event Format  
AIRC-CAP-028 Audience Segment  
AIRC-CAP-029 Event Experiment  
AIRC-CAP-030 Event Scorecard  
AIRC-CAP-031 Nightlife Analytics  
AIRC-CAP-032 AI Access Assist  
AIRC-CAP-033 Adaptive Flow  
AIRC-CAP-034 Predictive Boarding  
AIRC-CAP-035 Mobility Integration — FUTURE  
AIRC-CAP-036 Multi-Venue Control Tower

## 14. Governed implementation sequence

AIRC-PB-001 Product Foundation  
AIRC-PB-002 Entity & Data Contract  
AIRC-PB-003 RBAC, RLS & Entitlements  
AIRC-PB-004 Route, Page & UX Surface Catalog  
AIRC-PB-005 Backend & Integration Contracts  
AIRC-BL-001 Baseline Selection  
AIRC-MAT incremental materialization sequence  
AIRC-GJ1 Golden Club Journey  
AIRC-PILOT real validation only after certification and separate authorization

## 15. First MVP boundary

Initial MVP target: Club Setup, Event Management, Ticket Purchase foundation, Access Credential, Gate Scan, Arrival Slot, Priority/VIP, Incident Register, and read-only Dashboard.

Community Partner expansion, advanced Jurisdiction Packs, adaptive AI, predictive AI, and Mobility remain later phases unless separately promoted.

No real payment, real identity document, real PII, real restriction, real gate hardware, or production activation is authorized by this Product Bible alone.

## 16. Initial canonical state

AIRenClub is confirmed as an AIRenOS vertical. Foundation design is authorized. Runtime, persistent schema, Base44 app creation, LIVE integrations, and production remain subject to subsequent governed gates.

RISTOAIREN execution priority remains separate and unchanged.
