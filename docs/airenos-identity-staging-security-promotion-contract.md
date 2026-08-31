# AIRenOS Identity — staging security promotion & session handoff contract

Status target: `STATIC_CONTRACT_ONLY / LIVE_BINDINGS_OPEN`.

This document defines the gates that must exist between the current AIRenOS Identity infrastructure contracts and a real staging login path. It deliberately creates no provider resources and certifies no live secret, image, DNS, TLS, Keycloak, browser or Kairos evidence.

## 1. Authority remains unchanged

Keycloak remains a replaceable upstream authentication engine behind the provider-neutral AIRenOS F2 OIDC adapter. It MUST NOT become authority for canonical AIRenOS Identity, Tenant, Membership, Role, Permission, Entitlement or AIRenOS Session state.

The governed chain remains:

`browser -> Keycloak -> Authorization Code + PKCE S256 -> AIRenOS F2 verification -> canonical AIRenOS Identity resolution -> AIRenOS Session Authority -> AIRenOS bearer -> authorization -> Kairos retrieval`

A Keycloak access token is never an AIRenOS bearer. Browser-, Base44- or Keycloak-asserted tenant, role, scope or entitlement values are never authorization authority.

## 2. Secret Manager / KMS boundary

AIRenOS already uses a provider-neutral secret-reference boundary. This gate does not replace that abstraction. A future OVHcloud binding may use OVHcloud Secret Manager behind the AIRenOS secret adapter and OVHcloud KMS for key protection only after live region, IAM and workload-identity capabilities have been read back from the real account.

Runtime material includes the Keycloak database URL/username/password, bootstrap administrator material, any registry pull credential that proves necessary, and TLS private-key material. The AIRenOS session-signing private key remains owned by AIRenOS Session Authority rather than Keycloak.

Raw secret values are prohibited from Git, Google Drive, Base44, committed Terraform inputs, OCI image layers, CI logs and chat. This contract commits no Kubernetes Secret values and selects no External Secrets operator or workload-identity mechanism before real MKS/IAM evidence exists.

`SECRET_MANAGER_KMS_BINDING = OPEN / NOT_EXECUTED`

## 3. Immutable Keycloak image promotion

The source build remains `deploy/keycloak/Containerfile`, rooted in the pinned `quay.io/keycloak/keycloak:26.7.2` image. A successful local build is contract evidence only.

Staging promotion requires all of the following:

1. a real private registry target whose provider/region availability and access policy have been proven;
2. build provenance tied to the governed AIRenOS commit;
3. a successful push of the AIRenOS-built image;
4. an immutable deployment reference in the form `registry/repository@sha256:<64-lowercase-hex>`;
5. an independent read-back of that digest from the registry;
6. registry vulnerability-scan evidence;
7. zero unresolved Critical findings by default; unresolved High findings require a separately recorded explicit security acceptance.

The digest of the upstream Keycloak base image is NOT the digest of the promoted AIRenOS image. A local Docker image ID is also NOT registry promotion proof. The existing Kubernetes template therefore keeps `REQUIRED_GOVERNED_DIGEST` until the real registry promotion gate passes.

`KEYCLOAK_IMMUTABLE_IMAGE_PROMOTION = OPEN / NOT_EXECUTED`

## 4. DNS and TLS boundary

Canonical targets remain:

- `login.airenos.com` — public authentication endpoint;
- `identity-admin.airenos.com` — restricted administration endpoint;
- `session.airenos.com` — AIRenOS session callback boundary;
- callback URI: `https://session.airenos.com/oidc/callback`.

Closure requires exact provider read-back of the DNS records, a publicly trusted TLS chain for public endpoints, certificate SAN verification, and protection of private-key material inside the governed secret/KMS boundary. The administration surface requires network restriction and is not authorized for generic public exposure.

External traffic must use HTTPS. The existing Keycloak internal HTTP setting is acceptable only behind a live-proven trusted proxy/TLS termination boundary. HSTS preload is not authorized by this contract.

No DNS record, certificate or ingress/load-balancer resource is created here.

`DNS_TLS = OPEN / NOT_PROVEN`

## 5. Session handoff boundary

A real runtime handoff must prove the complete chain, not a synthetic equivalent:

1. browser begins OIDC Authorization Code flow with PKCE S256 against the live Keycloak issuer;
2. `session.airenos.com` receives the real authorization callback;
3. the AIRenOS F2 adapter validates provider metadata, signature, issuer, audience, nonce, time and code exchange according to the existing F2 contract;
4. AIRenOS resolves the provider subject to canonical Identity;
5. AIRenOS Session Authority issues its own Ed25519-signed session/bearer;
6. tenant/role/permission/entitlement authority is resolved by AIRenOS, never copied from browser or Keycloak claims;
7. Kairos authorizes before retrieval;
8. Base44 remains presentation-only and the exact-origin handoff boundary remains enforced;
9. the authenticated Base44 -> AIRenOS Session -> Kairos journey is proven end-to-end in a real browser.

No deterministic fixture, mocked provider, fabricated token, local preview fallback or simulated browser flow may close this gate.

`K4_C3_RUNTIME_DEPLOY_SESSION_HANDOFF_PROOF = OPEN / NOT_YET_EXECUTED`

## 6. Provider dependency pause

OVHcloud account onboarding is intentionally paused while the company fiscal data required for account completion is pending. This does not invalidate the static contracts already certified and it does not authorize billable provider creation.

`OVHCLOUD_ACCOUNT_ONBOARDING = PAUSED / EXTERNAL_FISCAL_DATA_PENDING`

## 7. Non-claims

This contract is not evidence of:

- an OVH Secret Manager or KMS instance;
- a registry or image push;
- an immutable registry digest read-back;
- DNS ownership or active records;
- issued or installed TLS certificates;
- a deployed Keycloak staging service;
- a live realm/client;
- a real Authorization Code exchange;
- a real browser login;
- Base44 -> AIRenOS -> Kairos authenticated E2E;
- K4-C3 closure.

All such fields remain fail-closed until independently proven against real systems.
