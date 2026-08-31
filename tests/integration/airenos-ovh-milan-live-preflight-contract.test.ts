import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

const versions = read("infra/ovh/milan-staging/preflight/versions.tf");
const variables = read("infra/ovh/milan-staging/preflight/variables.tf");
const main = read("infra/ovh/milan-staging/preflight/main.tf");
const outputs = read("infra/ovh/milan-staging/preflight/outputs.tf");
const runner = read("scripts/ovh-milan-provider-preflight.sh");
const docs = read("docs/airenos-identity-ovh-milan-live-provider-preflight.md");
const machine = JSON.parse(read("machine-context/airenos-identity-session-authority-f2-ovh-milan-live-preflight.json"));

test("live preflight is pinned and contains no managed Terraform resources", () => {
  const terraform = [versions, variables, main, outputs].join("\n");

  assert.match(versions, /required_version\s*=\s*"= 1\.16\.0"/);
  assert.match(versions, /version\s*=\s*"= 2\.19\.0"/);
  assert.match(versions, /endpoint\s*=\s*"ovh-eu"/);
  assert.doesNotMatch(terraform, /^\s*resource\s+"/m);
  assert.doesNotMatch(terraform, /backend\s+"/);
});

test("provider-authenticated preflight reads project, exact Milan 3-AZ, worker quota and database capabilities", () => {
  assert.match(main, /data\s+"ovh_cloud_project"\s+"project"/);
  assert.match(main, /data\s+"ovh_cloud_project_region"\s+"milan"/);
  assert.match(main, /self\.status\s*==\s*"UP"/);
  assert.match(main, /self\.type\s*==\s*"region-3-az"/);
  assert.match(variables, /"eu-south-mil-a"/);
  assert.match(variables, /"eu-south-mil-b"/);
  assert.match(variables, /"eu-south-mil-c"/);
  assert.match(main, /data\s+"ovh_cloud_project_flavors"\s+"worker"/);
  assert.match(main, /flavor\.available/);
  assert.match(main, /flavor\.quota\s*>=\s*var\.minimum_worker_quota/);
  assert.match(main, /data\s+"ovh_cloud_project_database_capabilities"\s+"database"/);
  assert.match(main, /lower\(engine\.name\)\s*==\s*"postgresql"/);
  assert.match(variables, /default\s*=\s*"17"/);
  assert.match(variables, /default\s*=\s*"business"/);
});

test("capability preflight cannot certify PostgreSQL physical multi-AZ or authorize apply", () => {
  assert.match(outputs, /output\s+"postgresql_multiaz_topology_proven"/);
  assert.match(outputs, /output\s+"live_apply_authorized"/);
  assert.match(outputs, /value\s*=\s*false/g);
  assert.equal(machine.read_only_preflight.postgresql_multiaz_topology_proven, false);
  assert.equal(machine.read_only_preflight.live_apply_authorized, false);
  assert.equal(machine.execution.postgresql_multiaz_topology_proof, "OPEN_FAIL_CLOSED");
  assert.match(docs, /cannot by themselves prove where a future two-node database service will be physically placed/i);
});

test("runner enforces OAuth2 service account and forbids provider writes", () => {
  assert.match(runner, /OVH_CLIENT_ID/);
  assert.match(runner, /OVH_CLIENT_SECRET/);
  assert.match(runner, /OVH_CLOUD_PROJECT_SERVICE/);
  assert.match(runner, /unset OVH_ACCESS_TOKEN OVH_APPLICATION_KEY OVH_APPLICATION_SECRET OVH_CONSUMER_KEY/);
  assert.match(runner, /terraform .* plan/);
  assert.match(runner, /terraform .* show -json/);
  assert.doesNotMatch(runner, /terraform[^\n]*(?:apply|destroy|import)/);
  assert.doesNotMatch(runner, /echo[^\n]*OVH_CLIENT_SECRET/);
  assert.equal(machine.authentication.governed_method, "OAUTH2_SERVICE_ACCOUNT_CLIENT_CREDENTIALS");
});

test("sanitized evidence preserves exact non-claim and no secret output fields", () => {
  assert.match(runner, /evidence_schema: "airenos\.ovh\.milan\.provider-preflight\.v1"/);
  assert.match(runner, /postgresql_multiaz_topology_proven/);
  assert.match(runner, /live_apply_authorized/);
  assert.doesNotMatch(outputs, /^output\s+".*(?:secret|token|credential|password|client_secret)/mi);
  assert.equal(machine.execution.live_provider_authenticated_readback_executed, false);
  assert.equal(machine.execution.terraform_apply_executed, false);
  assert.equal(machine.execution.provider_write_executed, false);
});

test("GitHub secret/environment binding remains an explicit unverified prerequisite", () => {
  assert.equal(machine.authentication.github_environment_expected, "airenos-ovh-staging");
  assert.equal(machine.authentication.github_environment_verified, false);
  assert.equal(machine.authentication.real_secret_binding_verified, false);
  assert.match(docs, /cannot inspect, create or configure GitHub Actions Environments or repository\/environment secrets/i);
  assert.match(docs, /No workflow that consumes these values is activated by this checkpoint/i);
});
