# AIRenOS Identity & Session Authority — Sovereign Hosting Selection v0.1

Date: 2026-08-31
Status: DECIDED — TARGET SELECTED / NO DEPLOYMENT EXECUTED
Gate: ISA_F2_HOSTING_TARGET_SELECTION
Parent checkpoint: `542e7854598de0d1778adfcf297296c2fd66d577`

## 1. Decision

AIRenOS selects **OVHcloud Public Cloud — 3-AZ Milan (MIL)** as the primary governed hosting target for the first real Identity & Session Authority staging environment.

This decision selects an infrastructure target only. It does **not** certify DNS, TLS, a running Kubernetes cluster, a running Keycloak realm, a database, a real OIDC exchange, a browser login, or the K4-C3 handoff.

## 2. Why this target

The Identity & Session Authority is a critical AIRenOS control-plane capability. The target must therefore provide, inside a European jurisdiction and preferably in Italy, all of the following without forcing AIRenOS to invent a proprietary identity architecture:

- multi-availability-zone compute/orchestration;
- managed Kubernetes suitable for two or more Keycloak replicas;
- private networking and a managed load balancer;
- first-party Secret Manager and KMS;
- managed PostgreSQL with automatic failover and point-in-time recovery;
- infrastructure APIs / Terraform compatibility;
- European data-sovereignty posture;
- portability of the AIRenOS Keycloak OCI image and PostgreSQL data.

OVHcloud's current product-availability matrix exposes Managed Kubernetes Service, Load Balancer, Private Network, Secret Manager, KMS and Managed PostgreSQL in the **3-AZ Milan** region. Its Managed PostgreSQL Production tier provides two nodes, automatic failover, 14-day backup retention and a 99.95% SLA; the Advanced tier provides three nodes, 30-day retention and a 99.99% SLA. OVHcloud also states that EU customers can keep personal data hosted in the EU and describes technical/organizational measures intended to protect EU-hosted data from non-EU authority interference.

Provider facts were re-verified on 2026-08-31 before this decision was committed. They are external facts and must be re-verified again immediately before provisioning.

## 3. Rejected / secondary candidates for this gate

### Scaleway

Scaleway remains a strong European alternative and exposes Kapsule, Managed PostgreSQL, Secret Manager and KMS. However, its current availability matrix shows **Milan as a 1-AZ region**, while Paris, Amsterdam and Warsaw are 3-AZ. AIRenOS will not weaken the Identity HA target merely to remain in Italy. Scaleway Paris 3-AZ remains a valid portability / disaster-recovery alternative.

### Exoscale

Exoscale remains a strong European portability candidate with managed Kubernetes and managed PostgreSQL. Its current PostgreSQL service boundary states that primary clusters live in a **single zone**, with geo-replication/read-replica mechanisms available separately. That is less direct than the selected Milan 3-AZ target for the first authoritative Identity deployment.

## 4. Staging topology target

```text
Internet
  |
  v
OVHcloud Load Balancer / ingress
  |
  v
Private network / vRack
  |
  +--> Keycloak replica A (Kubernetes)
  |
  +--> Keycloak replica B (Kubernetes)
          |
          v
      Dedicated Managed PostgreSQL
      Production tier / Multi-AZ
```

Required staging controls:

1. Region: `MIL` / 3-AZ Milan.
2. Kubernetes: OVHcloud Managed Kubernetes Service; production-grade/HA control-plane tier must be provider-verified at execution time.
3. Keycloak image: AIRenOS governed image based on `quay.io/keycloak/keycloak:26.7.2` from the parent checkpoint.
4. Keycloak replicas: minimum `2`.
5. Pod anti-affinity / topology spread: mandatory so replicas are not intentionally co-located on one failure domain.
6. PodDisruptionBudget: mandatory.
7. Public exposure: only through governed load balancer / ingress.
8. Keycloak administrative surface: not public; network-restricted.
9. Database: dedicated Managed PostgreSQL, separate from AIRenOS business/control-plane databases.
10. Staging DB baseline: Production tier, two nodes / automatic failover / Multi-AZ, subject to live provider read-back before creation.
11. Production DB target: Advanced three-node class is preferred, but production remains a separate authorization gate.
12. Secrets: OVHcloud Secret Manager; no credentials committed to GitHub, Base44 or application configuration.
13. Encryption keys: KMS-backed where supported and justified.
14. Private connectivity between Kubernetes and PostgreSQL is mandatory where provider service capabilities permit it.
15. Backups and PITR must be enabled and restore-tested before any production certification.
16. Terraform/IaC is the required provisioning path; console-only configuration cannot be the canonical infrastructure definition.

## 5. AIRenOS authority boundary remains unchanged

OVHcloud and Keycloak are infrastructure/authentication dependencies, not AIRenOS authorities.

- Keycloak authenticates the upstream human subject.
- AIRenOS Identity Directory remains the canonical AIRenOS principal authority.
- AIRenOS resolves TenantMembership, platform role, tenant role and entitlements server-side.
- AIRenOS Session Authority issues the credential consumed by AIRenOS services.
- Keycloak roles, groups, tenant-like values or entitlements are non-authoritative.
- A Keycloak access token is not automatically an AIRenOS service bearer.
- Base44 authentication is never an AIRenOS credential.
- Browser-provided tenant/role/scope remains non-authoritative.

## 6. Staging vs production

The first live environment is explicitly **staging**.

Staging may use the minimum provider-supported multi-AZ PostgreSQL Production profile and a cost-conscious Kubernetes worker footprint while preserving two Keycloak replicas and failure-domain separation.

Production must be re-authorized separately and must reassess:

- three-node PostgreSQL / Advanced tier;
- worker sizing and autoscaling;
- WAF / DDoS posture;
- backup retention and off-site recovery;
- observability and security-event export;
- EU-only operational/support options where contractually required;
- formal RTO/RPO;
- key rotation and break-glass access;
- second-region disaster recovery.

## 7. Portability requirement

The selection of OVHcloud must not create architectural lock-in.

AIRenOS therefore preserves:

- standard OCI image for Keycloak;
- PostgreSQL-standard data model and backup/export path;
- Kubernetes manifests / Helm-compatible deployment model;
- OIDC/OAuth standards at the authentication boundary;
- provider-neutral AIRenOS identity adapter;
- DNS-controlled issuer hostname owned by AIRenOS, not by the provider;
- Terraform modules separated from application/domain logic.

A future migration to Scaleway, Exoscale, another European provider, private cloud or on-prem must not require redesigning AIRenOS identity semantics.

## 8. Canonical hostname targets

These remain design targets and are **not claimed live**:

- Public authentication hostname: `https://login.airenos.com`
- AIRenOS upstream issuer target: `https://login.airenos.com/realms/airenos`
- Administrative hostname target: `https://identity-admin.airenos.com`
- AIRenOS callback target: `https://session.airenos.com/oidc/callback`

No DNS or TLS evidence exists until provider and DNS read-back prove it.

## 9. Provider evidence snapshot

Verified 2026-08-31 from current official provider material:

- OVHcloud Public Cloud region availability: Milan is listed as a 3-AZ region; Managed Kubernetes Service, Load Balancer, Private Network, Secret Manager, KMS and PostgreSQL are available there.
- OVHcloud Managed PostgreSQL: Production = two nodes, automatic failover, 14-day backup retention, SLA 99.95%; Advanced = three nodes, 30-day retention, SLA 99.99%.
- Scaleway product availability: Milan currently exposes one availability zone; Paris/Amsterdam/Warsaw expose three.
- Exoscale Managed PostgreSQL service boundary: primary clusters live in one zone.

External references:

- https://www.ovhcloud.com/it/public-cloud/regions-availability/
- https://www.ovhcloud.com/it/public-cloud/postgresql/
- https://www.ovhcloud.com/it/about-us/data-sovereignty/
- https://www.scaleway.com/it/product-availability-by-region/
- https://community.exoscale.com/product/dbaas/service-specific/postgresql/service-boundaries/limits-and-quotas/

## 10. Explicit non-evidence

At this checkpoint:

- OVHcloud account/project readiness: NOT VERIFIED
- quota readiness: NOT VERIFIED
- MIL MKS plan/provider API read-back: NOT EXECUTED
- Kubernetes cluster: NOT CREATED
- PostgreSQL instance: NOT CREATED
- load balancer: NOT CREATED
- Secret Manager secrets: NOT CREATED
- Keycloak deployment: NOT EXECUTED
- realm/client provider read-back: NOT EXECUTED
- DNS: NOT PROVEN
- TLS: NOT PROVEN
- real Authorization Code + PKCE exchange: NOT EXECUTED
- real browser login: NOT CERTIFIED
- Base44 -> AIRenOS -> Kairos authenticated E2E: NOT EXECUTED
- production change: NONE

## 11. Next governed gate

`ISA_F2_OVH_MILAN_STAGING_PROVISIONING`

The next gate may create only an isolated staging foundation after another RULE-DOC-20/21 reconciliation and fresh provider read-back. It must begin with IaC and provider/account/quota verification, and must fail closed if the exact 3-AZ/Multi-AZ capabilities cannot be demonstrated.
