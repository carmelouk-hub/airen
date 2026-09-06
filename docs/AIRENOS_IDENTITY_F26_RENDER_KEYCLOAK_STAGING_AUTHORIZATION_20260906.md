# AIRenOS Identity F2.6 — Render Keycloak Staging Authorization

State: AUTHORIZED / IMPLEMENTATION CANDIDATE  
Environment: Render Frankfurt staging only  
Governance: RULE-DOC-20/21

## Authorization

The human authority approved continuation of the previously proposed Render-first plan without reducing or consolidating the existing services. The total AIRenOS Identity staging cost ceiling is updated from USD 45/month to USD 60/month.

The authorized target remains:

- Render Hobby workspace, unchanged;
- one Keycloak staging web service on Render Standard, 2 GB, Frankfurt;
- one AIRenOS Session Authority staging web service on Render Starter with a 1 GB persistent signing-key disk, only after Keycloak and OIDC readiness pass;
- the existing dedicated AIRenOS Identity managed PostgreSQL service;
- no production, high availability, service consolidation or provider migration.

## F2.6 scope

F2.6 may prepare, test and deploy only the staging Keycloak authentication engine. It does not deploy Session Authority, bind Foundation public keys, attach Base44, prove a browser login or enable a tenant.

Keycloak must use a separate logical database and a dedicated runtime principal within the current managed PostgreSQL service. It must not reuse the AIRenOS Identity logical database, schema, owner or application runtime principal. The Keycloak runtime principal may own only its authentication-engine database and objects and must have no SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION authority.

All database and bootstrap-administrator credentials remain provider-side secrets. No password, complete database URL, token or private key may enter GitHub, Drive, chat, Base44 source or CI/log output.

## Service contract

- image source is pinned to Keycloak 26.7.2;
- optimized production mode is mandatory and `start-dev` is forbidden;
- plan is Render Standard, region Frankfurt, single staging instance;
- Render edge TLS terminates before the service; Keycloak listens on HTTP port 10000 and trusts the provider-controlled X-Forwarded boundary;
- readiness is `/health/ready` on the main listener and includes database connectivity;
- automatic deploy is disabled;
- the public staging hostname is provider-generated; canonical `login.airenos.com` and the restricted administrative hostname remain later DNS/network gates;
- Keycloak authenticates only the upstream subject and never becomes AIRenOS Identity, tenant, role, permission, entitlement, billing, product-access or Session authority.

## Ordered apply and rollback

1. Validate this static contract and the governed image in CI.
2. Freshly reconcile GitHub and Drive.
3. Create the isolated Keycloak logical database and runtime credential through a secret-safe provider session.
4. Read back database separation and least-privilege role attributes without returning secrets.
5. Freshly reconcile GitHub and Drive again.
6. Create the Standard staging service with automatic deploy disabled and provider-side secrets.
7. Verify deploy status, readiness, logs, exact Keycloak version and database connectivity.
8. Register the live evidence append-only in GitHub and canonical Drive documents.

If the service cannot become healthy, rollback is suspension or deletion of only the new F2.6 service after preserving diagnostic evidence. Existing RISTOAIREN, AIRen Booking, AIRenPay, Identity database content and certified branches remain untouched.

## Preserved hard boundaries

- `airenos_identity_bootstrap_f25` remains active;
- bootstrap IP allowlist remains unchanged;
- PR #4 remains OPEN / DRAFT / UNMERGED;
- R3 and `main` remain unchanged;
- no production or Corte delle Stelle mutation;
- no force push, reset, amend or history rewrite;
- no cost beyond the total USD 60/month Identity staging ceiling;
- no Session Authority creation until Keycloak and OIDC readiness pass.
