import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

async function text(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("OVH Milan provisioning contract pins toolchain and remote-state boundary", async () => {
  const versions = await text("infra/ovh/milan-staging/versions.tf");

  assert.match(versions, /required_version\s*=\s*"= 1\.16\.0"/);
  assert.match(versions, /source\s*=\s*"ovh\/ovh"/);
  assert.match(versions, /version\s*=\s*"= 2\.19\.0"/);
  assert.match(versions, /backend\s+"s3"/);
  assert.match(versions, /endpoint\s*=\s*"ovh-eu"/);
});

test("OVH Milan provisioning contract is pinned to exact region and three zones", async () => {
  const variables = await text("infra/ovh/milan-staging/variables.tf");
  const main = await text("infra/ovh/milan-staging/main.tf");

  assert.match(variables, /default\s*=\s*"EU-SOUTH-MIL"/);
  for (const zone of ["eu-south-mil-a", "eu-south-mil-b", "eu-south-mil-c"]) {
    assert.ok(variables.includes(zone), `missing governed availability zone ${zone}`);
  }
  assert.match(variables, /default\s*=\s*"1\.34"/);
  assert.match(main, /data\s+"ovh_cloud_project_region"\s+"milan"/);
  assert.match(main, /region-3-az/);
  assert.match(main, /availability_zones/);
});

test("real provider and PostgreSQL topology evidence default to fail closed", async () => {
  const variables = await text("infra/ovh/milan-staging/variables.tf");
  const main = await text("infra/ovh/milan-staging/main.tf");

  for (const gate of [
    "provider_account_preflight_verified",
    "quota_preflight_verified",
    "postgresql_multiaz_preflight_verified",
  ]) {
    const start = variables.indexOf(`variable "${gate}"`);
    assert.notEqual(start, -1, `missing gate ${gate}`);
    const section = variables.slice(start, start + 500);
    assert.match(section, /default\s*=\s*false/);
    assert.ok(main.includes(gate), `gate ${gate} is not enforced`);
  }

  assert.match(main, /Do not infer it from marketing or region availability alone/);
});

test("Kubernetes contract requires standard 3-AZ worker topology", async () => {
  const main = await text("infra/ovh/milan-staging/main.tf");

  assert.match(main, /resource\s+"ovh_cloud_project_kube"\s+"identity"/);
  assert.match(main, /plan\s*=\s*"standard"/);
  assert.match(main, /resource\s+"ovh_cloud_project_kube_nodepool"\s+"identity"/);
  assert.match(main, /desired_nodes\s*=\s*3/);
  assert.match(main, /min_nodes\s*=\s*3/);
  assert.match(main, /availability_zones\s*=\s*var\.availability_zones/);
});

test("PostgreSQL contract uses provider API plan, deletion protection and explicit two-node request", async () => {
  const main = await text("infra/ovh/milan-staging/main.tf");

  assert.match(main, /resource\s+"ovh_cloud_project_database"\s+"keycloak"/);
  assert.match(main, /engine\s*=\s*"postgresql"/);
  assert.match(main, /plan\s*=\s*"business"/);
  assert.match(main, /deletion_protection\s*=\s*true/);
  assert.equal((main.match(/\bnodes\s*\{/g) ?? []).length, 2);
  assert.ok(main.includes("postgresql_multiaz_preflight_verified"));
  assert.doesNotMatch(main, /ovh_cloud_project_database_postgresql_user/);
});

test("Terraform outputs and sources contain no committed provider or database secret material", async () => {
  const files = await Promise.all([
    text("infra/ovh/milan-staging/versions.tf"),
    text("infra/ovh/milan-staging/variables.tf"),
    text("infra/ovh/milan-staging/main.tf"),
    text("infra/ovh/milan-staging/outputs.tf"),
    text("infra/ovh/milan-staging/README.md"),
  ]);
  const joined = files.join("\n");

  assert.doesNotMatch(joined, /OVH_APPLICATION_KEY\s*=\s*["'][^"']+/);
  assert.doesNotMatch(joined, /OVH_APPLICATION_SECRET\s*=\s*["'][^"']+/);
  assert.doesNotMatch(joined, /OVH_CONSUMER_KEY\s*=\s*["'][^"']+/);
  assert.doesNotMatch(joined, /password\s*=\s*["'][^"']+/i);
  assert.doesNotMatch(await text("infra/ovh/milan-staging/outputs.tf"), /kubeconfig|password|consumer_key|application_secret/i);
});

test("Keycloak staging manifest is non-deployable until governed digest and secret bindings exist", async () => {
  const manifest = await text("deploy/keycloak/kubernetes/staging/keycloak.yaml.tmpl");

  assert.match(manifest, /replicas:\s*2/);
  assert.match(manifest, /topologyKey:\s*topology\.kubernetes\.io\/zone/);
  assert.match(manifest, /kind:\s*PodDisruptionBudget/);
  assert.match(manifest, /minAvailable:\s*1/);
  assert.match(manifest, /type:\s*ClusterIP/);
  assert.match(manifest, /secretKeyRef:/);
  assert.match(manifest, /REQUIRED_GOVERNED_DIGEST/);
  assert.doesNotMatch(manifest, /kind:\s*Secret\b/);
  assert.doesNotMatch(manifest, /kind:\s*(Ingress|Gateway)\b/);
  assert.doesNotMatch(manifest, /type:\s*LoadBalancer/);
});

test("machine context preserves real-provider non-claims", async () => {
  const raw = await text("machine-context/airenos-identity-session-authority-f2-ovh-milan-provisioning.json");
  const context = JSON.parse(raw);

  assert.equal(context.status, "PROVISIONING_CONTRACT_READY_REAL_APPLY_PENDING");
  assert.equal(context.terraform.ci_apply, false);
  assert.equal(context.fail_closed_guards.provider_account_preflight_verified_default, false);
  assert.equal(context.fail_closed_guards.postgresql_multiaz_preflight_verified_default, false);
  assert.equal(context.live_evidence.provider_connector_available_in_session, false);
  assert.equal(context.live_evidence.kubernetes_cluster, "NOT_CREATED");
  assert.equal(context.live_evidence.postgresql, "NOT_CREATED");
  assert.equal(context.live_evidence.real_browser_login, "NOT_CERTIFIED");
  assert.equal(context.production_side_effects, "NONE");
});
