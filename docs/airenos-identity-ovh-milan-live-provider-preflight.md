# AIRenOS Identity — OVHcloud Milan real-provider preflight

## Purpose

This gate creates a provider-authenticated, strictly read-only preflight runner for the governed OVHcloud Milan staging target. It is the bridge between the already validated Terraform provisioning contract and any future real provider apply.

It does **not** provision infrastructure and it must never be cited as evidence that Kubernetes, PostgreSQL, networking, DNS, TLS, Keycloak or any other staging resource exists.

## Authentication boundary

The governed runner intentionally uses the OVH Terraform provider OAuth2 service-account path:

- `OVH_ENDPOINT=ovh-eu`
- `OVH_CLIENT_ID`
- `OVH_CLIENT_SECRET`

The provider supports OAuth2 scoped service accounts compatible with OVHcloud IAM. The live runner explicitly unsets `OVH_ACCESS_TOKEN`, `OVH_APPLICATION_KEY`, `OVH_APPLICATION_SECRET` and `OVH_CONSUMER_KEY` so that this gate cannot silently fall back to a legacy credential path.

`OVH_CLIENT_SECRET` must exist only in an approved secret channel. It must never be pasted into ChatGPT, committed to GitHub, stored in Google Drive/Base44, included in Terraform variables/state, or printed to logs.

The OAuth2 service account should receive the minimum IAM read permissions required to inspect the selected Public Cloud project, region, flavors/quota and database capabilities. Write/order/delete permissions are not required by this gate.

## GitHub execution boundary

The intended future execution surface is a protected GitHub Actions Environment named `airenos-ovh-staging` with required reviewers and branch restrictions. The current ChatGPT GitHub connector cannot inspect, create or configure GitHub Actions Environments or repository/environment secrets. Therefore this checkpoint makes **no claim** that the Environment or secrets exist.

Before a provider-authenticated run, an authorized operator must create/verify that protected Environment in GitHub and place only these credentials there:

- secret: `OVH_CLIENT_ID`
- secret: `OVH_CLIENT_SECRET`
- non-secret environment value: `OVH_CLOUD_PROJECT_SERVICE`

No workflow that consumes these values is activated by this checkpoint. A live workflow may be introduced only after the Environment protection itself has been independently verified.

## Read-only Terraform preflight

`infra/ovh/milan-staging/preflight` contains **data sources only**. There are no managed Terraform resources and no backend/state configuration.

A real run authenticates to OVHcloud and fails closed unless it can read and verify:

1. the existing Public Cloud project;
2. `EU-SOUTH-MIL` with provider status `UP`;
3. region type `region-3-az`;
4. the exact availability-zone set `eu-south-mil-a`, `eu-south-mil-b`, `eu-south-mil-c`;
5. worker flavor `b3-8` as available with quota for at least three workers;
6. project database capabilities containing PostgreSQL 17;
7. provider/API database plan `business`;
8. PostgreSQL flavor `b3-8`.

The runner creates only an ephemeral local plan in a mode-0700 temporary directory, extracts an allowlisted sanitized evidence object, deletes the plan on exit and emits no provider credential.

The runner contains no `terraform apply`, `terraform destroy`, resource import, provider write, DNS change, secret creation or state backend initialization.

## PostgreSQL Multi-AZ remains unproven

Project database capabilities can demonstrate that PostgreSQL/version/plan/flavor are available. They cannot by themselves prove where a future two-node database service will be physically placed or whether the service will survive an availability-zone failure.

Therefore the sanitized evidence always records:

`postgresql_multiaz_topology_proven = false`

and:

`live_apply_authorized = false`

No project-capability response may be promoted into physical PostgreSQL multi-AZ evidence. `postgresql_multiaz_preflight_verified` in the provisioning stack must remain false until a separate provider/account topology proof establishes the actual service behavior required by AIRenOS. If OVHcloud cannot provide that proof, the database architecture must be redesigned before any apply.

## Operator command

After secure OAuth2 service-account binding exists outside source control, the governed runner is:

```text
scripts/ovh-milan-provider-preflight.sh
```

Do not prefix the command with inline secret assignments and do not copy its environment into support tickets, chat or documentation.

## Status

`READ_ONLY_LIVE_PREFLIGHT_RUNNER_IMPLEMENTED / OAUTH2_SECRET_BINDING_PENDING / PROVIDER_READBACK_NOT_EXECUTED / REAL_APPLY_NOT_AUTHORIZED`
