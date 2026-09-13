import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AppError, type SecurityContext } from "../../packages/shared-contracts/src/index.ts";
import {
  AIREN_PAY_ENTITLEMENT,
  assertAirenPayRuntimeAccess,
  resolveAirenPayRuntimeReadiness
} from "../../packages/airenpay/src/index.ts";

function boolEnv(name: string): boolean {
  return process.env[name] === "1" || process.env[name]?.toLowerCase() === "true";
}

function runtimeConfig() {
  return {
    enabled: boolEnv("AIRENPAY_RUNTIME_ENABLED"),
    providerMode: process.env.AIRENPAY_PROVIDER_MODE ?? "TEST"
  } as const;
}

function proofContext(url: URL): SecurityContext {
  const proofMode = boolEnv("AIRENPAY_STAGING_PROOF_MODE");
  const requestedEntitled = url.searchParams.get("proof") === "entitled";
  const entitlements = proofMode && requestedEntitled ? [AIREN_PAY_ENTITLEMENT] : [];
  return Object.freeze({
    correlationId: "airenpay-runtime-035-staging",
    actorIdentityId: "staging-proof-actor",
    platformRoles: [],
    platformPermissions: [],
    tenantId: "staging-proof-tenant",
    locationId: "staging-proof-location",
    permissions: [],
    entitlements
  });
}

function json(res: ServerResponse, status: number, body: Readonly<Record<string, unknown>>) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

export function handleAirenPayRuntimeRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://airenpay-staging.local");

  if (req.method === "GET" && url.pathname === "/health/live") {
    return json(res, 200, {
      service: "airenpay-runtime",
      environment: "staging",
      live: true,
      providerCallsEnabled: false
    });
  }

  if (req.method === "GET" && url.pathname === "/v1/airenpay/readiness") {
    try {
      const readiness = resolveAirenPayRuntimeReadiness(proofContext(url), runtimeConfig());
      return json(res, 200, { ...readiness, environment: "staging", providerCallsEnabled: false });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      return json(res, 503, { error: code, environment: "staging", providerCallsEnabled: false });
    }
  }

  if (req.method === "GET" && url.pathname === "/v1/airenpay/access") {
    try {
      const readiness = assertAirenPayRuntimeAccess(proofContext(url), runtimeConfig());
      return json(res, 200, { ...readiness, access: "allowed", environment: "staging", providerCallsEnabled: false });
    } catch (error) {
      const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
      return json(res, 403, { access: "denied", error: code, environment: "staging", providerCallsEnabled: false });
    }
  }

  return json(res, 404, { error: "NOT_FOUND" });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number.parseInt(process.env.PORT ?? "10000", 10);
  createServer(handleAirenPayRuntimeRequest).listen(port, "0.0.0.0", () => {
    console.log(`AIRenPay staging runtime listening on ${port}`);
  });
}
