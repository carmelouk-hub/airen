# AIRENOS IDENTITY F2.5 — RENDER-FIRST STAGING AUTHORIZATION

Date: 2026-09-04
Governance: RULE-DOC-20 / RULE-DOC-21
Classification: GOVERNED INFRASTRUCTURE DIRECTION / NON-PRODUCTION LIVE STAGING AUTHORIZATION
Parent checkpoint: F2.4 `04c5e7e2e2022426aefa896ffc9e7ae25ac1b418`

## 1. Decision

Following the F2.4 static provider apply packet and the subsequent provider benchmark, AIRenOS adopts Render Frankfurt as the current execution provider for non-production staging and as the preferred candidate for the first limited commercial production phase, subject to a later separate production authorization.

This decision is append-only. It does not rewrite F2.4. Where F2.4 described OVHcloud Milan as the canonical future infrastructure target, F2.5 supersedes that provider-direction assumption for the present execution roadmap while preserving every security, authority-separation, secret-handling, protected-boundary, and proof requirement established by F2.1–F2.4.

Hetzner and OVHcloud remain future infrastructure candidates. AIRenOS must remain provider-neutral and portable by design; Render must not become part of AIRenOS business or authority semantics.

## 2. Current provider role

Render Frankfurt is authorized for the current non-production staging path, including the dedicated AIRenOS Identity staging boundary required to prove the F2.x authority chain.

Render remains infrastructure only. It is never the authority for Identity semantics, ProductAccess, Entitlement, licensing, subscription, billing, tenant governance, or business data policy.

Base44 remains a replaceable Experience Layer only.

## 3. Early-commercial direction

The intended near-term operating strategy is Render-first for initial customers and controlled pilots. A later production gate may authorize a limited commercial production topology on Render after staging evidence, security, backup/restore, observability, capacity, and cost controls are proven.

F2.5 DOES NOT authorize production. It records Render as the preferred first-production candidate only.

Infrastructure migration or expansion toward Hetzner, OVHcloud, or another provider will be driven by measured technical/economic triggers rather than an arbitrary date. Provider portability must therefore be preserved from the start.

## 4. Provider-neutral invariants

AIRenOS application and authority layers must remain portable through standard components and contracts, including:

- containerized runtimes;
- standard PostgreSQL interfaces;
- standard OIDC / OAuth2 protocols;
- Keycloak without Render-specific authority semantics;
- standard health/readiness endpoints;
- environment/secret indirection rather than provider-specific business logic;
- exportable backup and restore procedures;
- no dependency of CORE business logic on Render proprietary APIs.

## 5. Protected Render boundaries

Existing RISTOAIREN / AIRen Booking Render resources are protected and must not be deleted, mutated, repurposed, or reused as the AIRenOS Identity state boundary.

The following currently existing resources remain outside F2.5 Identity scope:

- `ristoairen-booking-rbl01c2-20260827`;
- `ristoairen-postgres-rbl01c2`;
- `ristoairen-rbl01c2-db`.

Identity staging must use dedicated resources.

## 6. Non-production apply authorization

The operator has explicitly authorized proceeding with the necessary Render connections and setup to begin the AIRenOS staging path.

This authorization permits non-production provider writes required for the staging proof only when all of the following are true:

1. fresh RULE-DOC-21 reconciliation has passed;
2. existing protected resources remain untouched;
3. the resource is dedicated to AIRenOS Identity staging;
4. the action is reversible and non-production;
5. no secret is exposed to chat, Git, Drive, Base44, CI logs, or unprotected state;
6. any billable action is separately bounded by an explicit cost review and authorization.

A no-cost/free staging resource may be created under this authorization when it satisfies those constraints.

## 7. Cost boundary

The current operating objective is low-cost validation through initial pilots and early customers. No paid Render resource is implicitly authorized merely because Render has been selected as the provider.

Until an explicit billable-resource authorization is recorded, paid compute, paid database plans, persistent disks, paid Key Value, paid workspace upgrades, or equivalent chargeable resources remain NOT AUTHORIZED.

Provider payment-card entry is outside chat and must occur only in the provider payment interface.

## 8. Ordered staging path

The F2.4 evidence order remains authoritative, adapted to the Render-first provider decision:

1. create a dedicated Identity PostgreSQL staging boundary;
2. apply governed Identity schema/migrations and least-privilege runtime role;
3. deploy/configure dedicated Keycloak staging;
4. configure OIDC Authorization Code + PKCE S256 client;
5. deploy the F2.3 Session Authority runtime on Render Frankfurt;
6. bootstrap the real staging Ed25519 signing key only inside the approved provider/secret boundary;
7. read back public JWK material only;
8. bind public verification material to Foundation;
9. independently compare thumbprint/read-back;
10. prove real OIDC Authorization Code + PKCE S256;
11. prove real AIRenOS Session issuance and verification;
12. prove RA-01 ProductAccess/effective-entitlement/handoff E2E;
13. attach Experience Layer separately after authority proof.

A failure at any step stops later promotion.

## 9. Production boundary

`PRODUCTION = FALSE`

No customer production traffic, production realm/client, production signing key, production database, production billing activation, or production Experience attachment is authorized by F2.5.

A distinct future production authorization remains mandatory.

## 10. Governance invariants

- no history rewrite;
- no amend/reset/force;
- PR #4 remains OPEN / DRAFT / UNMERGED;
- main, R3, RISTOAIREN, AIRen Booking, AIRenPay, Kairos, RA-01, AOS-05 and previous F2.x checkpoints remain protected;
- no secret values in governance evidence;
- remote provider read-back and cross-source reconciliation are required after governed writes;
- partial proof never promotes a later gate.

## 11. Gate state

`RENDER_FIRST_STAGING_DIRECTION = AUTHORIZED`

`NON_PRODUCTION_RENDER_CONNECTIONS = AUTHORIZED_WITHIN_BOUNDARIES`

`NO_COST_DEDICATED_STAGING_RESOURCE_CREATION = AUTHORIZED`

`PAID_RESOURCE_CREATION = NOT_AUTHORIZED_WITHOUT_SEPARATE_COST_BOUND`

`PRODUCTION = FALSE`

END OF F2.5 RENDER-FIRST STAGING AUTHORIZATION
