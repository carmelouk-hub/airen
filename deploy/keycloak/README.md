# AIRenOS self-hosted Keycloak authentication engine

This directory defines the deployable infrastructure contract for the primary AIRenOS upstream authentication engine. Keycloak is deliberately treated as a replaceable authentication component behind the provider-neutral F2 OIDC boundary. It is not the canonical AIRenOS Identity, Tenant, Role, Permission, Membership, Entitlement or Session authority.

## Frozen version

The OCI image is pinned to `quay.io/keycloak/keycloak:26.7.2`. Floating tags such as `latest` are forbidden. The image is built in Keycloak optimized production mode with PostgreSQL, health and metrics support enabled. `start-dev` is forbidden.

## Authority chain

The intended chain is:

`browser -> Keycloak authentication -> OIDC Authorization Code + PKCE -> AIRenOS F2 verifier -> canonical AIRenOS Identity lookup -> F0/F1 AIRenOS Session Authority -> AIRenOS bearer -> AIRenOS/Kairos authorization`

Keycloak-issued access tokens MUST NOT be forwarded as AIRenOS bearers. Keycloak roles, groups, organizations, tenant-like claims or entitlements MUST NOT become AIRenOS authorization authority. Base44 authentication remains presentation-only.

## Desired canonical endpoints

The infrastructure contract reserves these targets:

- public authentication hostname: `https://login.airenos.com`
- AIRenOS realm issuer: `https://login.airenos.com/realms/airenos`
- restricted administration hostname: `https://identity-admin.airenos.com`
- AIRenOS OIDC callback target: `https://session.airenos.com/oidc/callback`

These are target endpoints only. Source control does not prove DNS, certificates, routing, deployment or provider availability. The machine-context record MUST remain false for those live-evidence fields until independently verified.

## Production topology contract

A production deployment MUST provide:

1. at least two Keycloak runtime replicas behind a trusted reverse proxy/load balancer;
2. a dedicated production-grade PostgreSQL database for Keycloak, separate from the AIRenOS canonical database;
3. PostgreSQL credentials and any bootstrap administrator credential from a secret manager or deployment secret, never from GitHub, image layers, Base44 or checked-in environment files;
4. TLS on the public boundary, exact hostname configuration and no wildcard redirect URI;
5. a distinct administration hostname with network restriction; public exposure of the Keycloak Admin REST/UI surface is not part of the public login contract;
6. `/health/ready` and metrics available only according to the deployment monitoring policy;
7. backups, point-in-time recovery and tested restore procedures for the Keycloak PostgreSQL database;
8. infrastructure-as-code and an immutable image digest for promotion beyond staging.

Preview/experimental multi-cluster Keycloak features are not required by this baseline. Multi-region active/active is a later gate after single-region multi-AZ reliability is proven.

## OIDC realm/client contract

`realm-contract.json` is an AIRenOS governance contract, not a claim that a live Keycloak realm already exists. It fixes the intended realm `airenos` and public OIDC client `airenos-browser-session` with Authorization Code flow and PKCE S256. Implicit flow, Resource Owner Password/direct grants, service accounts for the browser client and wildcard redirect/origin rules are forbidden.

The real realm/client must later be created through a governed Keycloak configuration mechanism and read back from the live provider before F2 real-provider binding can close.

## Runtime secrets

The deployment may consume Keycloak runtime variables such as `KC_DB_URL`, `KC_DB_USERNAME`, `KC_DB_PASSWORD` and bootstrap-admin material, but their values are external deployment inputs. No value belongs in this repository.

The Keycloak database is an authentication-engine database only. AIRenOS canonical `Identity`, Tenant membership, role, permission, entitlement and AIRenOS session records remain in AIRenOS-controlled stores.

## Certification boundary

Building this image and validating this contract proves deployability and architecture boundaries only. It is NOT evidence of:

- a reachable Keycloak service;
- live DNS or TLS;
- a real Keycloak realm/client registration;
- a real browser login;
- a real Authorization Code exchange;
- Base44 -> AIRenOS -> Kairos authenticated E2E.

Those remain separate provider-verified gates and must not be simulated to obtain closure.
