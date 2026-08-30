import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { createServer as createNetServer } from "node:net";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";
import { startKairosHttpServer } from "../../apps/api/src/kairos-http-server.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL required");

const RUNTIME_ROLE = "airen_runtime_ci";
const PROVIDER = "k4c-auth";
const AUDIENCE = "airenos-foundation";
const AUTH_KEY = randomBytes(32).toString("hex");
const RUNTIME_PASSWORD = randomBytes(24).toString("hex");
const ALLOWED_ORIGIN = "https://airen-kairos-base44.example.test";

const IDS = Object.freeze({
  platformIdentity: "12000000-0000-4000-8000-000000000001",
  deniedIdentity: "12000000-0000-4000-8000-000000000002",
  source: "42000000-0000-4000-8000-000000000001",
  revision: "52000000-0000-4000-8000-000000000001",
  document: "62000000-0000-4000-8000-000000000001",
  rootNode: "72000000-0000-4000-8000-000000000001",
  childNode: "72000000-0000-4000-8000-000000000002",
  relation: "82000000-0000-4000-8000-000000000001",
});

type Json = Record<string, any>;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Unable to allocate test port"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function provisionRuntimeLogin(): void {
  const result = spawnSync("psql", [DATABASE_URL!, "-v", "ON_ERROR_STOP=1", "-v", `runtime_password=${RUNTIME_PASSWORD}`, "-f", "tests/deployment/provision_runtime_login.sql"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`Runtime login provisioning failed: ${result.stderr || result.stdout}`);
}

function runtimeDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  parsed.username = RUNTIME_ROLE;
  parsed.password = RUNTIME_PASSWORD;
  return parsed.toString();
}

function issueToken(subject: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: PROVIDER,
    aud: AUDIENCE,
    sub: subject,
    sid: `k4c-${randomUUID()}`,
    iat: now - 5,
    exp: now + 300,
  })).toString("base64url");
  return `${payload}.${createHmac("sha256", AUTH_KEY).update(payload).digest("base64url")}`;
}

async function requestJson(
  port: number,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
): Promise<{ status: number; body: Json; headers: Record<string, string | string[] | undefined> }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: "127.0.0.1", port, path, method, headers }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body: Json = {};
        try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
        resolve({ status: response.statusCode ?? 0, body, headers: response.headers });
      });
    });
    request.on("error", reject);
    request.end();
  });
}

async function cleanup(root: Pool): Promise<void> {
  await root.query("DELETE FROM kairos.knowledge_relations WHERE id=$1", [IDS.relation]);
  await root.query("DELETE FROM kairos.knowledge_coordinates WHERE node_id IN ($1,$2)", [IDS.rootNode, IDS.childNode]);
  await root.query("DELETE FROM kairos.knowledge_nodes WHERE id IN ($1,$2)", [IDS.rootNode, IDS.childNode]);
  await root.query("DELETE FROM kairos.knowledge_documents WHERE id=$1", [IDS.document]);
  await root.query("DELETE FROM kairos.knowledge_source_revisions WHERE id=$1", [IDS.revision]);
  await root.query("DELETE FROM kairos.knowledge_sources WHERE id=$1", [IDS.source]);
  await root.query("DELETE FROM authz.platform_role_assignments WHERE identity_id=$1 AND role_key='k4c_test_admin'", [IDS.platformIdentity]);
  await root.query("DELETE FROM authz.role_permission_grants WHERE scope_kind='platform' AND role_key='k4c_test_admin' AND permission_key='kairos.knowledge.read.internal'");
  await root.query("DELETE FROM identity.provider_subject_links WHERE provider_key=$1 AND provider_subject IN ('k4c-platform','k4c-denied')", [PROVIDER]);
  await root.query("DELETE FROM identity.identities WHERE id IN ($1,$2)", [IDS.platformIdentity, IDS.deniedIdentity]);
}

async function seed(root: Pool): Promise<void> {
  await cleanup(root);
  await root.query(`
    INSERT INTO identity.identities(id,display_name,status) VALUES
      ('${IDS.platformIdentity}','K4-C Platform User','active'),
      ('${IDS.deniedIdentity}','K4-C Unprivileged User','active');

    INSERT INTO identity.provider_subject_links(identity_id,provider_key,provider_subject) VALUES
      ('${IDS.platformIdentity}','${PROVIDER}','k4c-platform'),
      ('${IDS.deniedIdentity}','${PROVIDER}','k4c-denied');

    INSERT INTO authz.permission_registry(permission_key,description)
      VALUES ('kairos.knowledge.read.internal','Read AIRen Kairos platform-internal knowledge')
      ON CONFLICT(permission_key) DO NOTHING;
    INSERT INTO authz.platform_role_assignments(identity_id,role_key,status)
      VALUES ('${IDS.platformIdentity}','k4c_test_admin','active');
    INSERT INTO authz.role_permission_grants(scope_kind,role_key,permission_key,effect)
      VALUES ('platform','k4c_test_admin','kairos.knowledge.read.internal','allow');

    INSERT INTO kairos.knowledge_sources(id,source_key,source_type,canonical_pointer,title,visibility_class,tenant_id,status)
      VALUES ('${IDS.source}','k4c:internal','AIRENOS_INTERNAL','aos://k4c/internal','K4-C Internal Source','PLATFORM_INTERNAL',NULL,'CURRENT');
    INSERT INTO kairos.knowledge_source_revisions(
      id,source_id,revision_key,content_hash,parser_kind,native_text_available,secret_scan_status,contains_secret_values,observed_at,is_current
    ) VALUES ('${IDS.revision}','${IDS.source}','r1','${"d".repeat(64)}','native-test',true,'PASS',false,now(),true);
    INSERT INTO kairos.knowledge_documents(
      id,source_revision_id,title,document_kind,authority_state,authority_weight,visibility_class,tenant_id,source_anchor,required_platform_permission,status
    ) VALUES ('${IDS.document}','${IDS.revision}','K4-C Internal','TEST','CURRENT_CANONICAL',115,'PLATFORM_INTERNAL',NULL,'k4c-root','kairos.knowledge.read.internal','ACTIVE');
    INSERT INTO kairos.knowledge_nodes(id,document_id,node_type,title,body_text,source_anchor) VALUES
      ('${IDS.rootNode}','${IDS.document}','DOMAIN','AIRen Kairos','K4-C platform graph root','k4c-root-node'),
      ('${IDS.childNode}','${IDS.document}','MODULE','Kairos Control Plane','K4-C Base44 control plane node','k4c-child-node');
    INSERT INTO kairos.knowledge_coordinates(coordinate,node_id,status) VALUES
      ('AOS.KAIROS.K4C','${IDS.rootNode}','ACTIVE'),
      ('AOS.KAIROS.K4C.CONTROL_PLANE','${IDS.childNode}','ACTIVE');
    INSERT INTO kairos.knowledge_relations(id,from_node_id,to_node_id,relation_type,confidence,metadata)
      VALUES ('${IDS.relation}','${IDS.rootNode}','${IDS.childNode}','IMPLEMENTS',1.0,'{}');
  `);
}

test("K4-C real HTTP session reaches only ACL-authorized Kairos graph and rejects Base44 self-asserted authority", async () => {
  const root = new Pool({ connectionString: DATABASE_URL });
  let service: Awaited<ReturnType<typeof startKairosHttpServer>> | undefined;
  try {
    await seed(root);
    provisionRuntimeLogin();
    const port = await freePort();
    service = await startKairosHttpServer({
      NODE_ENV: "test",
      APP_BASE_DOMAIN: "airenos.test",
      AUTH_ADAPTER: "signed-session",
      AUTH_PROVIDER_KEY: PROVIDER,
      AUTH_AUDIENCE: AUDIENCE,
      SECRET_MANAGER_ADAPTER: "env",
      DATABASE_URL_SECRET_REF: "secret://env/K4C_DATABASE_URL",
      AUTH_SESSION_KEY_SECRET_REF: "secret://env/K4C_AUTH_KEY",
      K4C_DATABASE_URL: runtimeDatabaseUrl(DATABASE_URL),
      K4C_AUTH_KEY: AUTH_KEY,
      KAIROS_CORS_ALLOWED_ORIGINS: ALLOWED_ORIGIN,
      HOST: "127.0.0.1",
      PORT: String(port),
      RELEASE_REVISION: process.env.GITHUB_SHA ?? "k4c-local",
      SHUTDOWN_TIMEOUT_MS: "5000",
    });

    const ready = await requestJson(port, "GET", "/health/ready");
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, "READY");

    const preflight = await requestJson(port, "OPTIONS", "/api/kairos/v1/graph?root=AOS.KAIROS.K4C", {
      origin: ALLOWED_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "Authorization, X-Correlation-Id",
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers["access-control-allow-origin"], ALLOWED_ORIGIN);

    const badPreflight = await requestJson(port, "OPTIONS", "/api/kairos/v1/graph", {
      origin: ALLOWED_ORIGIN,
      "access-control-request-method": "GET",
      "access-control-request-headers": "Authorization, X-Airen-Role",
    });
    assert.equal(badPreflight.status, 403);

    const unauthenticated = await requestJson(port, "GET", "/api/kairos/v1/graph?root=AOS.KAIROS.K4C", { origin: ALLOWED_ORIGIN });
    assert.equal(unauthenticated.status, 401);

    const platform = await requestJson(port, "GET", "/api/kairos/v1/graph?root=AOS.KAIROS.K4C", {
      origin: ALLOWED_ORIGIN,
      authorization: `Bearer ${issueToken("k4c-platform")}`,
      "x-correlation-id": "k4c-platform-http-001",
    });
    assert.equal(platform.status, 200, JSON.stringify(platform.body));
    assert.equal(platform.headers["access-control-allow-origin"], ALLOWED_ORIGIN);
    assert.deepEqual(new Set(platform.body.graph.nodes.map((node: Json) => node.nodeId)), new Set([IDS.rootNode, IDS.childNode]));
    assert.ok(platform.body.graph.edges.some((edge: Json) => edge.fromNodeId === IDS.rootNode && edge.toNodeId === IDS.childNode));

    const unprivileged = await requestJson(port, "GET", "/api/kairos/v1/graph?root=AOS.KAIROS.K4C", {
      origin: ALLOWED_ORIGIN,
      authorization: `Bearer ${issueToken("k4c-denied")}`,
      "x-airen-role": "platform_super_admin",
      "x-airen-tenant-id": "21000000-0000-4000-8000-000000000001",
    });
    assert.equal(unprivileged.status, 200, JSON.stringify(unprivileged.body));
    assert.deepEqual(unprivileged.body.graph.nodes, [], "client-supplied role/tenant headers must not create Kairos authority");
    assert.deepEqual(unprivileged.body.graph.edges, []);

    const wrongOrigin = await requestJson(port, "GET", "/api/kairos/v1/graph?root=AOS.KAIROS.K4C", {
      origin: "https://evil.example.test",
      authorization: `Bearer ${issueToken("k4c-platform")}`,
    });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.headers["access-control-allow-origin"], undefined);
  } finally {
    if (service) await service.stop();
    await cleanup(root);
    await root.query(`DROP ROLE IF EXISTS ${RUNTIME_ROLE}`);
    await root.end();
  }
});
