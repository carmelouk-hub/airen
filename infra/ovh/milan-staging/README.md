# AIRenOS Identity — OVHcloud Milan staging provisioning contract

This directory is a governed Infrastructure-as-Code contract for the first real AIRenOS Identity staging environment on OVHcloud Public Cloud. It is deliberately fail-closed: source control and CI may prove syntax, provider schema and architecture boundaries, but they MUST NOT be treated as evidence that OVHcloud resources exist.

## Frozen toolchain and location

- Terraform CLI: `1.16.0`
- OVH Terraform provider: `ovh/ovh` `2.19.0`
- OVH endpoint: `ovh-eu`
- OVHcloud region API identifier: `EU-SOUTH-MIL`
- Region name: Milan 3-AZ
- Required availability zones: `eu-south-mil-a`, `eu-south-mil-b`, `eu-south-mil-c`
- Kubernetes version: `1.34`
- Keycloak image contract: `quay.io/keycloak/keycloak:26.7.2`; promotion to staging additionally requires an immutable governed image digest.

The live OVHcloud Public Cloud project must already exist. This module does not order, create, transfer or bill a Public Cloud project.

## What this contract intends to provision

When and only when the live preflight gates have been satisfied, the module describes:

1. a dedicated private network and subnet in `EU-SOUTH-MIL`;
2. a private gateway;
3. an OVHcloud Managed Kubernetes Service cluster on the Standard plan;
4. a worker node pool with at least three workers distributed over all three Milan availability zones;
5. a dedicated PostgreSQL cluster and `keycloak` database for the authentication engine only.

AIRenOS canonical Identity, Tenant, Membership, Role, Permission, Entitlement and AIRenOS Session Authority data remain outside the Keycloak database.

## Mandatory live preflight — fail closed

The following Terraform variables default to `false` and MUST remain false until evidence comes from the real OVHcloud account/provider APIs:

- `provider_account_preflight_verified`
- `quota_preflight_verified`
- `postgresql_multiaz_preflight_verified`

`terraform apply` must fail while any required live gate is false.

The region itself is also read back from the provider. The contract requires provider type `region-3-az` and the exact three Milan availability zones before network or compute provisioning may proceed.

### PostgreSQL multi-AZ evidence conflict

OVHcloud documentation available on 2026-08-31 is internally inconsistent. The current 3-AZ reference architecture describes DBaaS nodes distributed across availability zones and Production/Advanced plans tolerating an AZ failure, while a PostgreSQL HA guide updated in May 2026 still states that Public Cloud Databases for PostgreSQL do not support multi-AZ and place nodes in the same datacenter.

AIRenOS therefore does not infer multi-AZ PostgreSQL from product marketing or from the region being 3-AZ. `postgresql_multiaz_preflight_verified` may become true only after a live provider/account capability and topology read-back proves that the selected PostgreSQL offer actually satisfies the AIRenOS staging requirement. If that cannot be proven, this module MUST NOT create the PostgreSQL service and the database topology must be redesigned before proceeding.

The Terraform provider still names the two-node PostgreSQL tier `business`; current OVHcloud product material calls the corresponding commercial tier `Production`. The code intentionally uses the provider/API value `business`, not an invented `production` value.

## Secrets and state

No OVH credential, database password, Keycloak bootstrap credential, TLS private key or session-signing key belongs in GitHub, Drive, Base44, Terraform variables committed to source, image layers or CI logs.

For a future live run, OVH provider credentials must be injected through an approved secret channel using provider-supported environment variables such as:

- `OVH_ENDPOINT`
- `OVH_APPLICATION_KEY`
- `OVH_APPLICATION_SECRET`
- `OVH_CONSUMER_KEY`

`TF_VAR_cloud_project_service` may identify the existing Public Cloud project, but provider credentials MUST NOT be pasted into chat or committed anywhere.

This module deliberately does not create a PostgreSQL user/password in Terraform because generated credentials would become Terraform state. Database credentials and Keycloak bootstrap material must instead be created/bound through the governed OVHcloud Secret Manager/KMS live procedure after provider access exists.

Terraform state is sensitive even without explicit password resources because provider resources may expose kubeconfig, endpoints or operational metadata. The live gate MUST initialize the empty S3 backend block with a dedicated encrypted, versioned, access-controlled OVHcloud Object Storage backend. Local state and `*.tfvars` are ignored by source control.

## CI boundary

Normal GitHub CI is restricted to:

```text
terraform fmt -check
terraform init -backend=false
terraform validate
```

CI MUST NOT execute `terraform plan`, `terraform apply`, `terraform destroy`, OVH API writes, DNS changes or secret creation. Static/deterministic tests are contract evidence only.

## Keycloak deployment boundary

`deploy/keycloak/kubernetes/staging/keycloak.yaml.tmpl` is intentionally not directly deployable. Its image reference contains `REQUIRED_GOVERNED_DIGEST`; the live gate must replace that only with the digest of the exact governed Keycloak image. The template requires two replicas, zone spreading, a PodDisruptionBudget and Kubernetes Secret references, while defining no Secret values itself.

Public DNS, TLS termination, the restricted administration hostname, live realm/client registration, Authorization Code exchange and browser login are later provider-verified gates. A Kubernetes manifest or successful Terraform validation is not evidence of any of them.

## Status

`PROVISIONING_CONTRACT_READY / REAL_APPLY_PENDING`

No OVHcloud resource creation is certified by this directory.
