#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'AIRenOS OVH preflight: %s\n' "$1" >&2
  exit 2
}

[[ -n "${OVH_CLIENT_ID:-}" ]] || fail "OVH_CLIENT_ID is required through the approved secret channel."
[[ -n "${OVH_CLIENT_SECRET:-}" ]] || fail "OVH_CLIENT_SECRET is required through the approved secret channel."
[[ -n "${OVH_CLOUD_PROJECT_SERVICE:-}" ]] || fail "OVH_CLOUD_PROJECT_SERVICE is required."

if [[ -n "${OVH_ENDPOINT:-}" && "${OVH_ENDPOINT}" != "ovh-eu" ]]; then
  fail "OVH_ENDPOINT must be ovh-eu for the governed Milan staging preflight."
fi

export OVH_ENDPOINT="ovh-eu"
export TF_IN_AUTOMATION=1

# Enforce the governed OAuth2 service-account path and prevent accidental fallback
# to legacy application/consumer keys or a different pre-existing access token.
unset OVH_ACCESS_TOKEN OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY

command -v terraform >/dev/null 2>&1 || fail "terraform is required."
command -v jq >/dev/null 2>&1 || fail "jq is required."

workdir="infra/ovh/milan-staging/preflight"
tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
umask 077

terraform -chdir="$workdir" init -backend=false -input=false >/dev/null
terraform -chdir="$workdir" validate >/dev/null
terraform -chdir="$workdir" plan \
  -input=false \
  -lock=false \
  -refresh=true \
  -out="$tmpdir/preflight.tfplan" \
  -var="cloud_project_service=${OVH_CLOUD_PROJECT_SERVICE}" >/dev/null

terraform -chdir="$workdir" show -json "$tmpdir/preflight.tfplan" \
  | jq '{
      evidence_schema: "airenos.ovh.milan.provider-preflight.v1",
      generated_at_utc: (now | todateiso8601),
      terraform_version: .terraform_version,
      account: .planned_values.outputs.account.value,
      milan_region: .planned_values.outputs.milan_region.value,
      worker_flavor: .planned_values.outputs.worker_flavor.value,
      postgresql_capability: .planned_values.outputs.postgresql_capability.value,
      postgresql_multiaz_topology_proven: .planned_values.outputs.postgresql_multiaz_topology_proven.value,
      live_apply_authorized: .planned_values.outputs.live_apply_authorized.value,
      evidence_classification: .planned_values.outputs.evidence_classification.value
    }' > "$tmpdir/evidence.json"

jq -e '
  .postgresql_multiaz_topology_proven == false and
  .live_apply_authorized == false and
  .milan_region.status == "UP" and
  .milan_region.type == "region-3-az" and
  (.milan_region.availability_zones | sort) == ["eu-south-mil-a","eu-south-mil-b","eu-south-mil-c"]
' "$tmpdir/evidence.json" >/dev/null || fail "sanitized evidence failed governed fail-closed assertions."

if [[ -n "${AIRENOS_OVH_PREFLIGHT_EVIDENCE_PATH:-}" ]]; then
  install -m 600 "$tmpdir/evidence.json" "$AIRENOS_OVH_PREFLIGHT_EVIDENCE_PATH"
fi

cat "$tmpdir/evidence.json"
