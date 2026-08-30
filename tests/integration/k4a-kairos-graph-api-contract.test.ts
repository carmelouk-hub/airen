import test from "node:test";
import assert from "node:assert/strict";
import { AppError, type PlatformSecurityContext, type UUID } from "../../packages/shared-contracts/src/index.ts";
import type { AuthenticationAdapter } from "../../packages/identity/src/index.ts";
import type { RolePermissionResolver } from "../../packages/authorization/src/index.ts";
import type {
  KairosGraphNodeDetail,
  KairosGraphQueryStore,
  KairosGraphRequest,
  KairosGraphSecurityContext,
  KairosGraphSubgraph,
  KairosTimelineEvent,
} from "../../packages/kairos/src/graph.ts";
import type { KnowledgeSearchHit } from "../../packages/kairos/src/index.ts";
import { dispatchKairosApiRequest, isKairosApiRequest } from "../../apps/api/src/kairos-api.ts";

const IDENTITY = "10000000-0000-4000-8000-000000004001" as UUID;
const NODE = "70000000-0000-4000-8000-000000004001" as UUID;
const DOC = "60000000-0000-4000-8000-000000004001" as UUID;

class FakeGraph implements KairosGraphQueryStore {
  contexts: KairosGraphSecurityContext[] = [];
  graphRequests: KairosGraphRequest[] = [];

  async readSubgraph(input: KairosGraphRequest, context: KairosGraphSecurityContext): Promise<KairosGraphSubgraph> {
    this.contexts.push(context);
    this.graphRequests.push(input);
    return Object.freeze({
      rootCoordinate: "AOS.KAIROS",
      nodes: Object.freeze([Object.freeze({
        nodeId: NODE, documentId: DOC, coordinate: "AOS.KAIROS.K4", nodeType: "DESIGN",
        title: "Kairos K4", bodyExcerpt: "secured graph", authorityState: "CURRENT_CANONICAL",
        authorityWeight: 115, visibilityClass: "PLATFORM_INTERNAL", sourceType: "AIRENOS_INTERNAL",
        canonicalPointer: "aos://kairos/k4", sourceAnchor: "k4", metadata: Object.freeze({}),
      })]),
      edges: Object.freeze([]),
    });
  }

  async readNodeDetail(nodeId: UUID, context: KairosGraphSecurityContext): Promise<KairosGraphNodeDetail | null> {
    this.contexts.push(context);
    if (nodeId !== NODE) return null;
    return Object.freeze({
      nodeId: NODE, documentId: DOC, coordinate: "AOS.KAIROS.K4", nodeType: "DESIGN",
      title: "Kairos K4", bodyExcerpt: "secured graph", bodyText: "secured graph detail",
      authorityState: "CURRENT_CANONICAL", authorityWeight: 115, visibilityClass: "PLATFORM_INTERNAL",
      sourceType: "AIRENOS_INTERNAL", canonicalPointer: "aos://kairos/k4", sourceAnchor: "k4", metadata: Object.freeze({}),
    });
  }

  async readTimeline(_nodeId: UUID, _limit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KairosTimelineEvent[]> {
    this.contexts.push(context);
    return Object.freeze([]);
  }

  async searchLexical(_query: string, _limit: number | undefined, context: KairosGraphSecurityContext): Promise<readonly KnowledgeSearchHit[]> {
    this.contexts.push(context);
    return Object.freeze([]);
  }
}

function deps(graph: FakeGraph, authenticated = true) {
  const authentication: AuthenticationAdapter = {
    async authenticate() {
      return authenticated ? Object.freeze({
        identityId: IDENTITY,
        providerKey: "test",
        providerSubject: "k4-super-admin",
        platformRoles: Object.freeze(["super_admin"]),
      }) : null;
    },
  };
  const roles: RolePermissionResolver = {
    async platformPermissions() { return Object.freeze(["kairos.knowledge.read.internal"]); },
    async tenantPermissions() { return Object.freeze([]); },
    async locationPermissions() { return Object.freeze([]); },
  };
  return Object.freeze({ authentication, roles, graph });
}

function request(url: string, authorization = "Bearer opaque-session") {
  return Object.freeze({
    method: "GET",
    url,
    headers: Object.freeze({
      authorization,
      "x-correlation-id": "k4a-api-contract-0001",
      "x-airen-platform-role": "attacker_declared_role_must_be_ignored",
    }),
  });
}

test("K4-A API recognizes only the Kairos prefix", () => {
  assert.equal(isKairosApiRequest("/api/kairos/v1/graph"), true);
  assert.equal(isKairosApiRequest("/api/admin/v1/tenants"), false);
});

test("K4-A graph API derives authority from authenticated principal, never caller-declared role headers", async () => {
  const graph = new FakeGraph();
  const result = await dispatchKairosApiRequest(request("/api/kairos/v1/graph?root=aos.kairos&nodeLimit=20&edgeLimit=40"),deps(graph));
  assert.equal(result.status,200);
  assert.equal(graph.contexts.length,1);
  const context = graph.contexts[0] as PlatformSecurityContext;
  assert.equal(context.scopeKind,"platform");
  assert.equal(context.actorIdentityId,IDENTITY);
  assert.deepEqual(context.platformRoles,["super_admin"]);
  assert.deepEqual(context.platformPermissions,["kairos.knowledge.read.internal"]);
  assert.deepEqual(graph.graphRequests[0],{ rootCoordinate: "aos.kairos", nodeLimit: 20, edgeLimit: 40 });
});

test("K4-A API fails authentication closed before graph access", async () => {
  const graph = new FakeGraph();
  const result = await dispatchKairosApiRequest(request("/api/kairos/v1/graph",""),deps(graph,false));
  assert.equal(result.status,401);
  assert.equal(result.body.error,"AUTHENTICATION_REQUIRED");
  assert.equal(graph.contexts.length,0);
});

test("K4-A node detail preserves unauthorized/not-found indistinguishability at API boundary", async () => {
  const graph = new FakeGraph();
  const hidden = "70000000-0000-4000-8000-000000004099";
  const result = await dispatchKairosApiRequest(request(`/api/kairos/v1/nodes/${hidden}`),deps(graph));
  assert.equal(result.status,404);
  assert.equal(result.body.error,"NOT_FOUND");
});

test("K4-A malformed graph parameters fail validation without querying the store", async () => {
  const graph = new FakeGraph();
  const result = await dispatchKairosApiRequest(request("/api/kairos/v1/graph?nodeLimit=not-a-number"),deps(graph));
  assert.equal(result.status,400);
  assert.equal(result.body.error,"VALIDATION_FAILED");
  assert.equal(graph.contexts.length,0);
});
