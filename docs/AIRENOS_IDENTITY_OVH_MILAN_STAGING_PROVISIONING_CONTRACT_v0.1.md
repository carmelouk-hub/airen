# AIRenOS Identity & Session Authority — OVHcloud Milan Staging Provisioning Contract v0.1

Date: 2026-08-31
Gate: `ISA_F2_OVH_MILAN_STAGING_PROVISIONING`
Status: `PROVISIONING_CONTRACT_IMPLEMENTED / REAL_APPLY_PENDING`
Base hosting-selection commit: `6442909f1b8a9c708be24996e9a5dfe976c9eb1d`

## 1. Purpose

This checkpoint converts the selected OVHcloud Milan 3-AZ hosting target into an executable, provider-schema-validated Infrastructure-as-Code contract while preserving the boundary between **deployable contract evidence** and **real provider evidence**.

No OVHcloud account, quota, resource, DNS record, TLS certificate, secret, Kubernetes workload, Keycloak realm/client or browser login is certified as live by this checkpoint.

## 2. Frozen provider/toolchain target

- Terraform CLI `1.16.0`.
- Terraform provider `ovh/ovh` `2.19.0`.
- Provider endpoint `ovh-eu`.
- OVHcloud Milan 3-AZ API region `EU-SOUTH-MIL`.
- Required zones: `eu-south-mil-a`, `eu-south-mil-b`, `eu-south-mil-c`.
- Kubernetes `1.34`, chosen as a conservative overlap between the current OVHcloud MKS range and the Keycloak 26.7 supported Kubernetes API range.
- Keycloak `26.7.2` remains the frozen authentication-engine version.
- PostgreSQL default major `17`, within both current Keycloak and OVHcloud support targets.

## 3. Provisioning topology contract

The Terraform module describes, for an already-existing OVHcloud Public Cloud project:

1. dedicated private network `airenos-identity-staging`;
2. dedicated private subnet `10.42.0.0/20`;
3. private gateway;
4. Managed Kubernetes Service Standard cluster in Milan;
5. one autoscaling node pool with `min_nodes=3`, `desired_nodes=3`, `max_nodes=6`, explicitly spread over the three Milan availability zones;
6. a dedicated PostgreSQL service for Keycloak with deletion protection and two nodes requested;
7. a dedicated `keycloak` logical database.

The Keycloak PostgreSQL service is not the AIRenOS canonical data authority. AIRenOS Identity, memberships, roles, permissions, entitlements and AIRenOS session lifecycle remain controlled by AIRenOS F0/F1/F2 stores and policies.

## 4. Provider/API naming reconciliation

Current OVHcloud commercial material uses the database tiers Discovery / Production / Advanced. The current Terraform provider schema still identifies PostgreSQL plans using `essential`, `business`, and `enterprise`.

The staging contract therefore uses:

`Terraform/API plan = business`

as the provider value corresponding to the intended current two-node Production-class target. It does not invent a `production` provider value.

## 5. PostgreSQL multi-AZ conflict — FAIL CLOSED

Provider documentation available on 2026-08-31 is inconsistent:

- the current OVHcloud 3-AZ reference architecture describes DBaaS nodes distributed across different availability zones and states that Production/Advanced databases can survive an availability-zone failure;
- an OVHcloud PostgreSQL high-availability guide updated in May 2026 states that Public Cloud Databases for PostgreSQL do not support multi-AZ and that nodes are placed in the same datacenter;
- other FAQ/security material also contains mixed statements.

AIRenOS therefore refuses to classify PostgreSQL as multi-AZ from static documentation alone.

The Terraform variable `postgresql_multiaz_preflight_verified` defaults to `false`, and a resource precondition blocks database creation until a live provider/account capability/topology read-back proves that the actual selected offer meets the governed staging requirement.

If the live provider cannot prove the topology, the database is not provisioned and architecture must be reconciled before continuing. No marketing statement may substitute for runtime/provider evidence.

## 6. Account, quota and region guards

The Terraform module also requires:

- `provider_account_preflight_verified = true` only after live account/project read-back;
- `quota_preflight_verified = true` only after live regional quota/flavor capability read-back;
- a live `ovh_cloud_project_region` read proving provider type `region-3-az`;
- provider-returned availability zones containing exactly the governed Milan A/B/C zone set.

All booleans default to false. Static tests and CI MUST NOT turn them true.

## 7. Terraform state and secrets

The configuration contains an intentionally empty `backend "s3" {}` contract. A live apply requires a dedicated encrypted, versioned and access-controlled OVHcloud Object Storage backend supplied at initialization time. GitHub CI initializes with `-backend=false` and never creates state remotely.

No provider credential or secret value is committed.

The module deliberately does **not** create a PostgreSQL user/password because credentials generated or passed through Terraform would become sensitive Terraform state. Secret Manager/KMS binding, database credentials and Keycloak bootstrap credentials are a live provider action after secure provider access exists.

The repository ignores local Terraform state and `*.tfvars`. `.terraform.lock.hcl` is intentionally not ignored and may later be governed as a reproducibility artifact.

## 8. Keycloak Kubernetes deployment template

`deploy/keycloak/kubernetes/staging/keycloak.yaml.tmpl` defines the intended workload contract:

- namespace `airenos-identity`;
- two Keycloak replicas;
- required inter-node host anti-affinity;
- topology spreading over `topology.kubernetes.io/zone`;
- PodDisruptionBudget `minAvailable: 1`;
- only a ClusterIP service;
- health probes on management port 9000;
- exact public/admin hostname targets already reserved by the Keycloak infrastructure contract;
- database/bootstrap values only via Kubernetes `secretKeyRef`;
- no `Secret` objects and no secret values;
- no public Ingress or LoadBalancer in this gate.

The image is deliberately set to:

`registry.invalid/airenos/keycloak@sha256:REQUIRED_GOVERNED_DIGEST`

so the template cannot silently deploy a floating or ungoverned image. A later live gate must substitute the immutable digest of the exact governed Keycloak build.

## 9. CI evidence boundary

The dedicated Identity & Session Authority workflow is extended to run:

- existing F0/F1/F2 and Keycloak contract tests;
- the new static OVH Milan provisioning contract test;
- `terraform fmt -check`;
- `terraform init -backend=false`;
- `terraform validate`.

It MUST NOT execute Terraform plan/apply/destroy and receives no OVHcloud credentials.

Passing CI proves only that the provisioning contract is internally consistent with the pinned provider schema and AIRenOS architectural constraints.

## 10. Explicit non-claims

This checkpoint is not evidence of:

- OVHcloud account/project readiness;
- quota availability;
- live Milan 3-AZ API read-back;
- PostgreSQL multi-AZ topology;
- a created network, gateway, Kubernetes cluster, node pool or database;
- Secret Manager/KMS resources or secret bindings;
- DNS/TLS;
- a running Keycloak staging service;
- a live Keycloak realm/client;
- a real Authorization Code exchange;
- a real browser login;
- Base44 -> AIRenOS -> Kairos authenticated E2E.

## 11. Next governed gate

`ISA_F2_OVH_MILAN_REAL_PROVIDER_PREFLIGHT_AND_APPLY`

That gate requires secure OVHcloud provider/API access outside source control and chat, then provider-authenticated read-back of account, project, region, availability zones, quotas, selected flavors and PostgreSQL topology before any write is authorized.
