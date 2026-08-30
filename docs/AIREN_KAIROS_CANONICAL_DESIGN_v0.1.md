AIREN KAIROS — Canonical Design v0.1 — 2026-08-30

STATE: CANONICAL_DESIGN_FROZEN_v0.1 / IMPLEMENTATION_NOT_YET_STARTED
PROTOCOL: RULE-DOC-20 + RULE-DOC-21
HUMAN AUTHORITY: Google Drive document 1ljI-xA8lMCq8hNS1sySCBtRun20DXSIzkCm46UVqT6A
BOOTSTRAP BRANCH: kairos/bootstrap-20260830
BASELINE SHA: d055fba86d938aa38cee648171425046c7d972a4

1. PURPOSE
AIRen Kairos is the AIRenOS Knowledge, Provenance & Intellectual Property Intelligence system. Its purpose is to make the entire AIRenOS project searchable, navigable, explainable and historically reconstructable across canonical documentation, engineering artifacts, source code, decisions, evidence, brands, intellectual-property candidates and tenant-facing learning material.

Kairos must answer not only “where is this information?” but also “what is authoritative?”, “where did it originate?”, “what superseded it?”, “which evidence proves it?”, “who may see it?”, “what IP value may it have?” and “how does it relate to the rest of AIRenOS?”.

2. COMMERCIAL CLASSIFICATION — GOVERNANCE BINDING
AIRen Kairos Control Plane = NON-COMMERCIAL INTERNAL MODULE.
Kairos Learn = PLAN-INCLUDED tenant-facing capability.
Future Kairos Intelligence / Enterprise Knowledge = ADD-ON.
These classifications are user-confirmed. They do not by themselves authorize pricing, production enablement, tenant billing or bundle composition.

3. AUTHORITY & ACCESS MODEL
3.1 Platform authority
Authenticated platform_super_admin identities for Carmelo and Filippo may access the complete authorized AIRenOS project knowledge surface, including source-code knowledge, canonical governance, architecture, evidence, provenance, engineering lineage, design history and IP registry.

3.2 Secret exclusion invariant
Kairos MUST NOT ingest or index secret values, credentials, API keys, bearer tokens, private keys, restricted-provider secrets, database passwords, .env secret material, PAN/CVV, client_secret values or equivalent sensitive runtime material. This exclusion applies even to platform_super_admin users. Kairos may index the existence, name, purpose, owner system and rotation/provenance metadata of a secret reference, but never the secret value.

3.3 Tenant authority
Future tenant users may search only the knowledge subgraph authorized for their tenant, role, plan, modules and entitlements. Tenant access is not a UI hide/show mechanism. Authorization MUST execute before retrieval, semantic expansion, vector search, answer generation or map expansion.

3.4 Fail-closed search rule
The system MUST resolve identity -> role -> tenant -> entitlements -> Knowledge ACL -> authorized corpus before any full-text or vector query. It is forbidden to query the global corpus first and redact unauthorized results afterward.

3.5 Cross-tenant invariant
Platform-internal knowledge, another tenant’s knowledge, source code, governance evidence, IP registry and non-authorized product documentation must be unreachable by construction from a tenant session.

4. SOURCE-OF-TRUTH MODEL
Kairos does not replace existing source authorities. It indexes and relates them.
Primary source classes include:
- Google Drive canonical Docs/Sheets/Slides and evidence.
- GitHub source code, Markdown, commits, branches, tags, workflow runs and governed artifacts.
- AIRenOS governance records, ADRs, provenance registers, changelogs and certification evidence.
- Runtime/provider evidence such as Render, Base44 and payment-provider proof where lawfully and safely represented.
- OCR-derived text only for images/scans/PDF pages that lack usable native text.

Every indexed object MUST retain a canonical source pointer and source type. Kairos is a knowledge authority resolver, not a destructive migration of the original evidence.

5. INGESTION STRATEGY
5.1 Native-first parsing
Google Docs, Markdown, source code, YAML, JSON, SQL, DOCX, text PDFs and structured tables must be parsed natively where possible.

5.2 OCR-only-when-required
OCR is a fallback for scanned PDFs, image-only documents, screenshots and other content that lacks extractable text. Native text must not be degraded into OCR when a higher-fidelity parser exists.

5.3 Document decomposition
Each source must be decomposed into stable logical units: document, section, heading, paragraph/chunk, table, code symbol, commit, evidence item or other typed unit. Each unit preserves source coordinates sufficient to reopen the original location.

5.4 Incremental ingestion
Kairos must support idempotent incremental ingestion using source revision/version/hash checkpoints. A changed source creates new provenance/version relations rather than silently overwriting historical meaning.

6. CORE KNOWLEDGE MODEL
Bootstrap entities:
- KnowledgeDocument
- KnowledgeSection
- KnowledgeNode
- KnowledgeRelation
- KnowledgeSource
- KnowledgeSourceRevision
- KnowledgeCoordinate
- KnowledgeAuthorityState
- KnowledgeAcl
- KnowledgeEmbedding
- KnowledgeSearchIndexEntry
- KnowledgeProvenanceEvent
- IpCandidate
- IpAsset
- BrandAsset
- EvidenceLink

The model must remain extensible without making a vector database the source of truth. Embeddings are derived search artifacts, not canonical knowledge records.

7. AUTHORITY RANKING
At minimum Kairos must recognize:
CURRENT_CANONICAL
GOVERNANCE_BINDING
CERTIFIED
CLOSED_PASS
CURRENT
DESIGN_FROZEN
EVIDENCE
HISTORICAL
FAILED_CLOSED
SUPERSEDED
DRAFT
UNVERIFIED

Search ranking MUST prefer higher authority and current applicability while preserving historical lineage. Historical failures such as the preserved D4-A fail-closed attempts must remain discoverable and connected to the later correction and PASS; they must never be rewritten out of history.

8. PERMANENT KAIROS COORDINATES
Every important knowledge node should receive a stable human-readable coordinate independent of storage provider. Initial convention:
AOS.<DOMAIN>.<SUBDOMAIN>.<MODULE>.<NODE>
Examples:
AOS.RISTO.BOOKING.AIRENPAY.D4C
AOS.RISTO.BOOKING.HOLD.B2
AOS.CORE.IDENTITY
AOS.GOV.RULE-DOC-21
AOS.KAIROS.IP

Coordinates identify knowledge concepts; source pointers identify evidence locations. One concept may have many evidence/source revisions.

9. SEARCH ARCHITECTURE
Kairos uses hybrid retrieval:
- PostgreSQL full-text search for exact lexical/title/code/identifier matching.
- Vector/semantic search for natural-language conceptual retrieval.
- Metadata/graph filtering for source type, module, gate, authority, date, tenant, role, IP class and provenance.
- Graph traversal for dependencies, supersession, implementation lineage and evidence relationships.

The recommended initial owned persistence is PostgreSQL with native full-text capabilities and pgvector, subject to benchmark and security validation. External search engines may be added later without changing canonical ownership.

10. QUERY PIPELINE
AUTHENTICATED USER
-> Identity Resolution
-> Platform/Tenant Role Resolution
-> Entitlement Resolution
-> Knowledge ACL Resolution
-> Authorized Corpus/Subgraph
-> Lexical + Semantic + Graph Retrieval
-> Authority Ranking
-> Provenance/Evidence Validation
-> Answer / Search Results / Map

Any inability to resolve authority or scope fails closed.

11. KAIROS MAP
Kairos Map is an interactive knowledge graph, not a decorative sitemap. It must support hierarchical and relational views such as:
AIRenOS
-> Core
-> Verticals
-> RISTOAIREN
-> Booking
-> BookingHold
-> AIRenPay
-> Booking Channel Hub
-> Governance
-> Infrastructure
-> AI
-> Tenants
-> Evidence
-> Commercial Architecture
-> Intellectual Property

Search results may highlight the corresponding nodes and paths. A tenant sees only an authorized subgraph.

12. KAIROS VOICE
Kairos Voice is a natural-language input surface over the same secured search API. Voice transcription must not bypass authorization. Example intents include finding a chapter, opening a certified gate, explaining a function, locating a decision, showing dependencies, or navigating a map node.

13. KAIROS LEARN
Kairos Learn is the PLAN-INCLUDED tenant-facing surface. It may explain only functions, procedures and modules available to the authorized tenant/user. It must not expose AIRenOS internal governance, source code, platform evidence, other tenants, internal infrastructure or restricted IP information.

Kairos Learn should reduce onboarding/support burden by providing contextual “how to use this function” knowledge from an authorized product/manual corpus.

14. BASE44 BOUNDARY
Base44 may be used as an accelerator for Kairos UI, search bar, voice controls, map/navigation and authenticated experience surfaces.

Base44 MUST NOT become the canonical repository for Kairos knowledge, embeddings, provenance, source coordinates, authority ranking, ACL rules, IP registry or search authority. Those assets remain AIRenOS-owned and provider-independent behind AIRenOS APIs/storage.

The architecture must permit replacement of Base44 by future AIRenOS Web/Desktop/Mobile clients without re-ingesting or migrating the canonical Kairos knowledge layer.

15. INTELLECTUAL PROPERTY LAYER
Kairos must maintain a structured IP map. Candidate classifications include:
PATENT_REVIEW
COPYRIGHT
TRADEMARK
DESIGN_REVIEW
TRADE_SECRET
KNOW_HOW
DATABASE_RIGHT_REVIEW
CONTRACTUAL_RIGHT
REVIEW_REQUIRED
NOT_PROTECTABLE

Kairos may detect and flag IP candidates but must not make the final legal determination of patentability, registrability, ownership or infringement. Those decisions require qualified human/legal review where appropriate.

16. IP PROVENANCE
For an IP-relevant concept Kairos should be able to reconstruct:
- first known appearance
- authors/contributors where lawfully documented
- date/time and source revision
- related ADR/design decision
- implementation commits
- certification/evidence lineage
- successor/superseded versions
- public-disclosure status where known
- commercial classification
- related brands/domains
- open-source dependency considerations

This supports copyright records, trademark portfolios, patent-attorney preparation, trade-secret governance, investor IP due diligence and chain-of-title review.

17. BRAND REGISTRY
Kairos should support BrandAsset records for names and visual identities such as AIRen, AIRenOS, RISTOAIREN, AIRenPay, AIRen Kairos and future vertical/module names. Suggested fields: owner entity, first-use evidence, status, classes/jurisdictions, logo version, domain, related product/module, registration/application references and licensing status.

18. PROVENANCE & DUE DILIGENCE
Kairos Provenance must connect concept -> design -> source -> commit -> CI -> runtime evidence -> certification. The target is a continuously maintained internal due-diligence graph capable of showing what is proprietary, what is third-party/open-source, who/what originated it, and which evidence supports the claim.

19. INITIAL CENSUS ROOTS — DISCOVERED 2026-08-30
The first read-only census identified, among other authorities:
- AIRenOS Platform Bible — Analisi Funzionale, Architettura e Product Operating Model — v0.1 — Drive 1ZlppAFqaJvhWUxwHyUdMJIaREBPzSAsn9hy7kupX9DA
- 00 — AIRenOS Documentation Index & Governance Registry — v0.1 — Drive 1p8ES5MBaJjWQdm9q8IDNnXu2tC5vDLxo3JTmvJkz_fI
- 01 — AIRenOS Functional Domain Map — v0.1 — Drive 1uF838nQbsO1FtVeZXM_UbCIvRzWKa38r8OvEIT_ID8c
- 05 — AIRenOS Security & Audit Bible — v0.1 — Drive 1ORReANVGIWVtGNEGKW9M_0Oe2nvxG44HR_My0aeDIXA
- ADR-000 — AIRenOS Architecture Decision Register — v1.0 — Drive 1DcX-DC7ubmRIkz8kIHE5RhkfBtqExMGr1gyUcGpAqIk
- PROV-000 — AIRenOS Technical Provenance & Artifact Lineage Register — v1.0 — Drive 1n3x0q9XUVt7saWLXvVgB1HYMzwppp0ykIzXH15DVN3k
- CHANGELOG-000 — AIRenOS Canonical Engineering Changelog — v1.0 — Drive 1GSZHCB279V1RzAqHITSS1UvtrwZP1js1S6ZwiNKtshw
- 07 — RISTOAIREN Functional Domain Map — v0.1 — Drive 1QAof-o8wHK4vLFhLguOlF1Y4y8rC8Ydp1UTQmIia0nE
- 08 — RISTOAIREN Entity & Data Dictionary — v0.1 — Drive 16d_ItmtJgDktWxYQXbZB7FzTJMVIKFSVzYfF5xd8ZLc
- 09 — RISTOAIREN RBAC & RLS Matrix — v0.1 — Drive 1MhfahuVL7M_1APUnzqXZY_9sCBu-1veToHxTBGGw8mY
- 11 — RISTOAIREN Route, Page & UX Surface Catalog — v0.1 — Drive 1XtnPRG4OC3q4JpJCSAPjKFW3Kiimg-jDOblxmC6ZCYE
- RULE-DOC-20 — Canonical Chat Handoff & Continuity Protocol — Drive 1L2yqy6XiKVsdbXe6vrVmlvFXRJCUFoXncnXeu7Bbpos
- Current canonical handoff CHAT-HANDOFF-20260827-01 — Drive 18dpqVkJw8cNySS2hEquu8ZP73MnObvJCbPJHuvtP4BU
- AIREN BOOKING CHANNEL HUB + AIRENPAY — Canonical Design v0.1 — Drive 1c4O5bsu00OyG-qw_cSnq84VD8DH68FaYzPqxhW5E67A
- GitHub repository carmelouk-hub/airen including source, docs, tests, workflows, migrations and evidence mirrors.

This is a seed census, not yet a claim of completeness. K2 must discover, deduplicate, classify and link the full corpus.

20. IMPLEMENTATION PHASES
K0 — Governance & Classification: CLOSED for bootstrap authorization/classification.
K1 — Canonical Design: this v0.1 document.
K2 — Historical/Current Census: enumerate sources, classify authority, build initial coordinate map and ingestion manifest.
K3 — Ingestion & Search Foundation: persistence schema, source adapters, native parsing/OCR fallback, full-text/vector indexes, ACL-resolved search API.
K4 — Interactive Map: secured graph navigation and filtered subgraphs.
K5 — Voice & Intelligence: voice input and grounded answers with source/provenance citations.

21. NON-GOALS OF v0.1
- No production tenant exposure.
- No migration of canonical Bible content out of Drive.
- No replacement of GitHub as code authority.
- No ingestion of secret values.
- No automatic legal conclusion that an item is patentable/registrable.
- No Base44 dependency for canonical storage/search authority.
- No weakening of RLS/RBAC/entitlements for convenience.
- No AIRenPay D4-D refund execution as part of Kairos bootstrap.

22. AIRENPAY RESUME POINT
Gate D4-C is CLOSED_PASS on RBL commit d055fba86d938aa38cee648171425046c7d972a4. Gate D4-D Refund TEST is explicitly deferred and remains the next payment gate after the initial Kairos bootstrap checkpoint. No refund is authorized or executed by this document.

23. GOVERNANCE CHANGE RULE
Changes to Kairos authority model, secret-exclusion invariant, pre-retrieval authorization, tenant isolation, canonical-source ownership, commercial classification, or IP-provenance semantics require a governed design revision/amendment. Historical certified evidence must not be rewritten to simplify the graph.

24. NEXT ACTION
Create an exact GitHub Markdown mirror of this v0.1 design on kairos/bootstrap-20260830; remote-read both authorities; then produce K2 Initial Census v0.1 with a machine-usable source manifest and stable Kairos coordinates. No runtime ingestion code is authorized until the census/ACL model has been reconciled.
