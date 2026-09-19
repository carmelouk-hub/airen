AIRenClub PRODUCT BIBLE
v0.1 — Foundation Scope & Capability Architecture
STATO: ACTIVE GOVERNED DRAFT — FOUNDATION DESIGN. PIATTAFORMA MADRE: AIRenOS. VERTICALE: AIRenClub — Nightlife Access, Safety & Flow Operating System. RUNTIME IMPLEMENTATION: NON ANCORA AUTORIZZATA DA QUESTO DOCUMENTO.
0. SCOPO E AUTORITÀ
Questa Product Bible definisce AIRenClub come verticale nativo di AIRenOS. Non descrive una app isolata e non autorizza la creazione di una seconda piattaforma identità, billing, tenant, location, audit o compliance. AIRenOS rimane l’autorità superiore per Identity, Organization, Legal Entity, Tenant, Location, Product Catalog, subscription, billing SaaS, entitlements, Session Authority, platform roles, audit centralizzato, domain registry, secrets, shared services e governance.
AIRenClub deve essere provider independent. Base44 può costituire Experience Layer e ambiente di implementazione, ma non diventa authority del prodotto. Il codice, i contratti e i dati operativi devono restare portabili, testabili e separati dalle specificità di un singolo club.
Country DiscoClub Palermo può diventare un caso reale di validazione o pilot, ma non è AIRenClub e non deve diventare un hardcode di architettura.
1. DEFINIZIONE DEL PRODOTTO
AIRenClub è il Nightlife Access, Safety & Flow Operating System di AIRenOS. Il suo obiettivo non è vendere soltanto biglietti, ma governare l’intero ciclo che collega evento, identità, idoneità all’accesso, acquisto, fascia di arrivo, classe di accesso, Priority, VIP, credenziale digitale, gate, ingresso, comportamento durante l’evento, incidenti, future restrizioni, community, attribution e intelligence operativa.
Principio fondante: la serata non comincia davanti alla discoteca. Comincia digitalmente prima dell’arrivo. Quando il cliente raggiunge il club, il sistema deve già conoscere il suo diritto di accesso e le condizioni applicabili, riducendo il più possibile negoziazioni commerciali, code non governate, liste manuali e conflitti alla porta.
Il QR non è il prodotto. È una possibile rappresentazione della credenziale. Il diritto di accesso governato è il prodotto operativo. In futuro la stessa credenziale potrà essere rappresentata tramite QR dinamico, Wallet, NFC, RFID, tornello, wearable o altri adapter.
2. PRINCIPI NON NEGOZIABILI
AIRC-P01 Platform First. AIRenOS precede AIRenClub e governa le authority di piattaforma.
AIRC-P02 Vertical Separation. AIRenClub è un verticale AIRenOS e non una seconda piattaforma.
AIRC-P03 Multi Tenant by Design. Ogni dato operativo dichiara tenant_id quando applicabile.
AIRC-P04 Multi Location by Design. Il prodotto supporta gruppi con più club e più città.
AIRC-P05 Multi Country by Design. La lingua dell’interfaccia e la giurisdizione applicabile sono concetti distinti.
AIRC-P06 Server Authority. Il client e la presentazione Base44 non costituiscono confine di sicurezza.
AIRC-P07 Identity Separation. AIRenOS Identity rimane authority; AIRenClub mantiene soltanto proiezioni e relazioni operative necessarie.
AIRC-P08 Auditable Access. Acquisto, cambio classe, gate scan, incident review e restriction decision devono essere ricostruibili.
AIRC-P09 Governed AI. L’AI osserva, prevede, propone e può operare soltanto entro policy esplicite; non acquisisce authority implicita sul Core.
AIRC-P10 Privacy by Design. Verifica identità non equivale automaticamente a conservazione della copia del documento.
AIRC-P11 No Global Blacklist. Le restrizioni sono limitate a Location, Tenant o Organization e la loro applicabilità dipende dalla giurisdizione.
AIRC-P12 Provider Portability. Ticketing, identity verification, payment, gate hardware e messaging devono essere integrabili tramite adapter.
AIRC-P13 Customer Safety Without Labels. Gli incidenti memorizzano fatti, evidenze, review e decisioni; il sistema non classifica persone con etichette personali non necessarie.
AIRC-P14 Testable Architecture. Ogni capability critica deve avere acceptance criteria e prove riproducibili.
3. CONFINE AIRenOS E AIRenClub
3.1 AIRenOS possiede
Identity e Session Authority; Organization e Membership; Legal Entity; Tenant; Location; Product Catalog; subscription e billing SaaS; entitlements e feature flags; platform roles; domain registry; audit di piattaforma; secrets; shared integration governance; osservabilità; global policy framework; Jurisdiction Engine e relativi pack quando materializzati.
3.2 AIRenClub possiede
Club operating profile; event e event session; event format; venue zone e capacity policy; ticket product; access entitlement; access credential; arrival slot; boarding group; access class; Priority e VIP; gate configuration e gate scan; promoter e community attribution; customer club relationship; event access policy; incident; incident review; access restriction; event experiment; event scorecard; nightlife analytics e domain intelligence.
3.3 Shared capability
AIRenPay può essere utilizzato come capability condivisa per il pagamento operativo quando autorizzato. Messaging, identity verification provider e altri servizi comuni devono essere consumati tramite contratti AIRenOS o adapter condivisi senza duplicare authority.
4. MACRO ARCHITETTURA FUNZIONALE
A. Venue, Event & Capacity: club profile, venue areas, event, session, capacity, sales cutoff, operating window, event policy.
B. Ticketing & Access: ticket product, purchase intent, payment handoff, access entitlement, digital boarding pass, credential lifecycle, transfer policy futura.
C. Arrival & Gate Flow: arrival slot, boarding group, gate assignment, Priority, VIP, scan, anti passback, occupancy, realtime gate state, live gate mode.
D. Customer, Promoter & Community: customer club profile, promoter, creator, influencer, community, university, brand, media e partner attribution.
E. Safety & Restriction Governance: incident register, factual evidence, review, warning, temporary restriction, purchase block, access suspension, permanent exclusion dove consentita, expiry e appeal or review flow.
F. Experience & Format: Event Format Engine, daypart, audience segment, venue zones, bar and food experience references, code of conduct, special access rules, partner activation, experiment design.
G. Analytics & Intelligence: event scorecard, conversion, attendance, no show, arrival deviation, queue time, gate throughput, revenue per guest, Priority revenue, promoter ROI, incident rate, repeat rate, customer lifetime indicators, format performance.
H. Global Compliance Integration: language, timezone, currency, country, subdivision, local policy pack, identity rules, age rules, incident retention, restriction safeguards, consumer rights, audit and data handling requirements.
5. CUSTOMER JOURNEY CANONICO
Discovery → Event → Eligibility Pre Check → Ticket Selection → Identity or Age Verification quando richiesta → Purchase → Payment → Check In → Arrival Slot → Access Class → Priority or VIP Upgrade → Digital Boarding Pass → Gate Assignment → Scan → Entry → Attendance → Event Interaction → Incident Review eventuale → Future Eligibility.
Il sistema deve poter applicare un sales cutoff. Dopo il cutoff, una venue può entrare in LIVE GATE MODE: niente nuove vendite alla porta, niente inserimenti arbitrari, niente nuove guest list salvo workflow governati espressamente configurati. La security valida credenziali e policy, non negozia il diritto commerciale di ingresso.
6. ARRIVAL SLOT, PRIORITY E FLOW ENGINE
Arrival Slot governa la distribuzione temporale degli ingressi. Ogni fascia può avere capacità, regole, gate e limiti propri. Priority non è soltanto upselling: è una classe di servizio e uno strumento di controllo dei flussi. VIP può avere policy dedicate, finestre più ampie o gate distinti.
Il gestore mantiene sempre la possibilità di configurare manualmente fasce, capienza, cutoff, prezzo Priority, limiti percentuali e gate. L’AI futura può suggerire o adattare tali parametri solo entro guardrail espliciti.
7. SAFETY, INCIDENTI E RESTRIZIONI
Lifecycle canonico: INCIDENT → REVIEW → ACCESS DECISION → RESTRICTION → EXPIRY OR REVIEW.
Tipologie di decisione candidate: NO_ACTION, WARNING, PURCHASE_BLOCK, ACCESS_SUSPENSION, EVENT_BLOCK, TEMPORARY_BAN, PERMANENT_EXCLUSION. Le enum definitive saranno congelate nel Data Dictionary e nella policy layer.
Lo scope di una decisione può essere LOCATION, TENANT o ORGANIZATION. Una decisione Organization wide non implica automaticamente applicazione mondiale. Il Jurisdiction Engine determina se e come la restrizione può essere applicata nella Location di destinazione.
Principio: l’incidente nasce nella Location. La decisione appartiene al Tenant o Organization. L’applicabilità viene determinata dalla Jurisdiction.
Un tentativo di acquisto futuro deve poter essere bloccato prima del checkout quando una restriction applicabile è attiva, evitando di spostare il conflitto davanti al locale.
8. IDENTITY E COMPLIANCE MULTI PAESE
AIRenClub deve preferire verification adapter e risultati minimizzati, non l’archiviazione indiscriminata di immagini di documenti. La strategia dati deve poter distinguere identity_status, age_status, verification_method, verification_level, verified_at e provider_reference dalle copie documentali.
Il provisioning deve distinguere country, subdivision, city quando rilevante, legal entity, venue location, timezone, currency, operating locale, customer locale e jurisdiction. Lingua e legge non sono sinonimi.
Il Jurisdiction Pack è versionato e governato. Deve poter definire identity policy, age verification, retention, privacy notice, restriction safeguards, consumer rules, ticket and refund policy, automated decision safeguards, data transfer requirements e audit. L’AI può monitorare modifiche normative e proporre aggiornamenti, ma non può promuovere autonomamente una regola legale in produzione.
9. EVENT FORMAT ENGINE E COMMUNITY
Il prodotto non deve hardcodare format come Golden Hour, Cosplay, Afrobeat, Y2K o Sober Night. Questi sono esperimenti di business. AIRenClub deve offrire un Event Format Engine configurabile con audience, daypart, zone, music profile, bar and food references, access profile, arrival strategy, partner, content profile e policy.
Promoter non equivale a Community Partner. Il modello target deve supportare PROMOTER, CREATOR, INFLUENCER, COMMUNITY, UNIVERSITY, BRAND, MEDIA, ASSOCIATION e PARTNER, ciascuno con attribution link, QR o campaign code e metriche di conversione, attendance e revenue.
Event Access Policy deve consentire regole specifiche per età, dress policy, props, bag size, outside drinks, photography, code of conduct, special security checks e acceptance requirements. Le regole devono essere comunicate prima dell’acquisto quando materialmente rilevanti.
10. EVENT EXPERIMENT E SCORECARD
Ogni nuovo format può essere trattato come esperimento governato con hypothesis, target, success criteria e outcome KEEP, ADJUST o RETIRE. L’obiettivo è trasformare il calendario del club in un sistema che apprende dai risultati.
KPI target: revenue totale, contribution margin, revenue per guest, ticket revenue, bar revenue, VIP revenue, Priority revenue, acquisition cost, conversion rate, attendance rate, no show rate, average arrival deviation, gate throughput, peak queue time, incident rate, promoter ROI, partner ROI, repeat rate, customer lifetime indicators, satisfaction e social conversion.
11. AI MATURITY MODEL
LEVEL 1 MANUAL. Il gestore decide fasce, capienza, prezzi e gate.
LEVEL 2 ASSISTED. L’AI analizza e suggerisce.
LEVEL 3 ADAPTIVE. L’AI modifica parametri entro policy e guardrail autorizzati.
LEVEL 4 PREDICTIVE. Il sistema anticipa domanda, congestione, staffing, gate load, Priority demand e comportamento operativo.
Per restriction e decisioni che incidono significativamente sull’accesso del cliente, il modello iniziale richiede human review secondo policy e Jurisdiction Pack. L’AI non assume authority implicita di ban permanente.
12. BLUE OCEAN PRODUCT POSITIONING
Eliminare: vendita improvvisata alla porta, liste manuali, aggiunte non governate, negoziazione commerciale con security, QR trattato come authority.
Ridurre: code casuali, assembramenti, frodi, conflitti, discrezionalità non tracciata, processi documentali manuali.
Aumentare: prevedibilità, sicurezza, ricavo anticipato, conoscenza cliente, attribution, auditabilità, controllo della capienza, qualità dell’esperienza.
Creare: Digital Boarding Pass, Arrival Slot, Boarding Group, Priority Gate, Identity Pre Clearance, Hard Sales Cutoff, Live Gate Mode, Access Eligibility, Event Format Engine, Predictive Boarding e Global Jurisdiction Awareness.
13. CAPABILITY FOUNDATION
AIRC-CAP-001 Venue Profile. AIRC-CAP-002 Event. AIRC-CAP-003 Event Session. AIRC-CAP-004 Venue Zone. AIRC-CAP-005 Capacity Policy. AIRC-CAP-006 Event Access Policy. AIRC-CAP-007 Ticket Product. AIRC-CAP-008 Purchase Intent. AIRC-CAP-009 Access Entitlement. AIRC-CAP-010 Access Credential. AIRC-CAP-011 Arrival Slot. AIRC-CAP-012 Boarding Group. AIRC-CAP-013 Access Class. AIRC-CAP-014 Priority. AIRC-CAP-015 VIP. AIRC-CAP-016 Gate. AIRC-CAP-017 Gate Scan. AIRC-CAP-018 Live Gate Mode. AIRC-CAP-019 Customer Club Profile. AIRC-CAP-020 Promoter. AIRC-CAP-021 Community Partner. AIRC-CAP-022 Attribution. AIRC-CAP-023 Incident Register. AIRC-CAP-024 Incident Review. AIRC-CAP-025 Access Restriction. AIRC-CAP-026 Restriction Review. AIRC-CAP-027 Event Format. AIRC-CAP-028 Audience Segment. AIRC-CAP-029 Event Experiment. AIRC-CAP-030 Event Scorecard. AIRC-CAP-031 Nightlife Analytics. AIRC-CAP-032 AI Access Assist. AIRC-CAP-033 Adaptive Flow. AIRC-CAP-034 Predictive Boarding. AIRC-CAP-035 Mobility Integration FUTURE. AIRC-CAP-036 Multi Venue Control Tower.
14. IMPLEMENTATION SEQUENCE GOVERNATA
AIRC-PB-001 Product Foundation: Product Bible, boundary, capability census e AIRenOS dependency map.
AIRC-PB-002 Entity & Data Contract: entity model, lifecycle, data classification, retention hooks e normalization rules.
AIRC-PB-003 RBAC, RLS & Entitlements: roles, permission families, Tenant and Location scope, server enforcement e product entitlements.
AIRC-PB-004 Route, Page & UX Surface Catalog: manager console, event setup, ticket purchase, customer boarding dashboard, gate mode, incident review, control tower.
AIRC-PB-005 Backend & Integration Contracts: application services, payment adapter, identity verification adapter, gate adapter, notification adapter, AIRenOS edges.
AIRC-BL-001 Baseline Selection: scelta governata della codebase e del Base44 target solo dopo i contratti di prodotto.
AIRC-MAT sequence: materializzazione incrementale delle entità e dei servizi senza produzione reale.
AIRC-GJ1 Golden Club Journey: fixture sintetiche end to end da evento a gate, con sicurezza, audit e isolamento Tenant and Location.
AIRC-PILOT: eventuale validazione reale solo dopo certificazione delle foundation e autorizzazione separata.
15. CONFINI DEL PRIMO MVP
MVP target: Club Setup, Event Management, Ticket Purchase foundation, Access Credential, Gate Scan, Arrival Slot, Priority and VIP, Incident Register, read only Dashboard. Community Partner, advanced Jurisdiction Packs, adaptive AI, predictive AI e Mobility restano successive salvo promozione governata.
Nessun pagamento reale, documento reale, PII reale, restriction reale, gate hardware reale o produzione viene autorizzato dalla sola Product Bible.
16. STATO CANONICO INIZIALE
AIRenClub è confermato come verticale AIRenOS. La progettazione Foundation è autorizzata. La creazione di runtime, Base44 app, schema persistente, integrazioni live e produzione richiede i gate successivi e relativa evidenza. La priorità esecutiva RISTOAIREN rimane separata e non viene modificata da questo documento.
17. AIRenOS VERTICAL CONTRACT RECONCILIATION
Riconciliazione eseguita contro il documento canonico 06 — AIRenOS Vertical Contract — v0.1. Esito Foundation: MATCH CON OBBLIGHI DOWNSTREAM ESPLICITI. AIRenClub rispetta la separazione Control Plane / Operational Domain e non introduce authority parallele a AIRenOS.
17.1 Product Manifest — foundation freeze
product_id: airenclub
product_code: AIRENCLUB
name: AIRenClub
product_type: vertical
industry: nightlife_entertainment
product_version: 0.1-foundation
contract_version: 0.1
status: FOUNDATION_DESIGN
tenant_model: multi_tenant
location_model: multi_location
identity_provider: airenos
authorization_model: airenos_plus_product_roles
billing_provider: airenos
audit_provider: shared_plus_product
ai_mode: governed
public_tenant_resolution: domain_registry
operational_security: tenant_rls_plus_rbac
supported_environments target: INTERNAL, DEMO, SANDBOX, STAGING, PRODUCTION. Nessun ambiente runtime AIRenClub è dichiarato attivo da questo freeze.
bootstrap_contract_version: PENDING AIRC-PB-002/AIRC-PB-005
migration_contract_version: PENDING AIRC-BL-001/AIRC-MAT
test_contract_version: PENDING AIRC-GJ1
17.2 Quindici contratti obbligatori AIRenOS
01 Product Manifest — FOUNDATION FROZEN in questa Bible.
02 Tenant Bootstrap Contract — REQUIRED, da materializzare dopo Domain Model e Backend Contract.
03 Location Bootstrap Contract — REQUIRED, con country, locale, timezone, currency, business profile e Jurisdiction binding.
04 Role Catalog — PENDING AIRC-PB-003.
05 Permission Catalog — PENDING AIRC-PB-003; permission granulari domain.action.
06 Entitlement Catalog — PENDING AIRC-PB-003 e successiva registrazione AIRenOS Product Catalog.
07 Route Manifest — PENDING AIRC-PB-004.
08 Domain Model Contract — NEXT GATE AIRC-PB-002.
09 Audit Event Catalog — PENDING AIRC-PB-003/AIRC-PB-005.
10 AI Capability Manifest — FOUNDATION GOVERNANCE DEFINED; dettaglio PENDING AIRC-PB-005.
11 Public Projection Contract — PENDING AIRC-PB-004/AIRC-PB-005.
12 Health & Readiness Contract — PENDING AIRC-PB-005.
13 Migration Contract — PENDING AIRC-BL-001/AIRC-MAT.
14 Test Contract — PENDING AIRC-GJ1; dovrà includere multi-tenant, multi-location, role-authenticated, public/private, incident/restriction e gate credential proofs.
15 Cleanup & Deprovision Contract — PENDING AIRC-PB-005; suspension non equivale a deletion.
17.3 Dependency map
AIRenOS hard dependencies: Identity & Session Authority; Organization & Membership; Legal Entity; Product Registry/Catalog; ProductSubscription; Entitlements; Tenant; Location; TenantDomain/Domain Registry; Platform Audit; Secret Management; Observability; shared integration governance; Jurisdiction Engine quando materializzato.
Shared optional/conditional dependencies: AIRenPay per pagamenti operativi autorizzati; Notification infrastructure; identity/age verification adapters; storage; messaging; provider abstraction.
AIRenClub operational authority: Venue/Event/Capacity; Ticket & Access; Arrival/Gate Flow; Customer Club Relationship; Promoter/Community Attribution; Safety/Incident/Restriction; Experience/Format; Nightlife Analytics & governed domain AI.
RISTOAIREN relationship: eventuale F&B o hospitality integration avviene tramite contratto tra verticali/shared services. AIRenClub non assume ownership di Menu, Orders, KDS, Inventory o altri domini RISTOAIREN e RISTOAIREN non diventa authority degli accessi AIRenClub.
17.4 Foundation gate conclusion
AIRC-PB-001 PRODUCT FOUNDATION = CLOSED — FOUNDATION DESIGN PASS. Il Vertical Contract AIRenOS è riconciliato a livello di ownership, manifest, capability boundary e obblighi downstream. Questo PASS non è runtime, non certifica sicurezza implementata e non autorizza Base44, schema persistente, provider LIVE o produzione.
NEXT AUTHORIZED DESIGN GATE: AIRC-PB-002 — Entity & Data Contract. Prima di qualsiasi materializzazione verranno definiti entità, lifecycle, scope Tenant/Location, PII classification, retention class, parent relations, cross-tenant constraints, public projection e AI read/write policy.