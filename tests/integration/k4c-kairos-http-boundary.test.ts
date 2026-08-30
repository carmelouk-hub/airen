import test from "node:test";
import assert from "node:assert/strict";
import { AppError } from "../../packages/shared-contracts/src/index.ts";
import { evaluateKairosCors, parseKairosAllowedOrigins } from "../../apps/api/src/kairos-http-server.ts";

test("K4-C Kairos CORS accepts exact HTTPS origins only and never wildcard authority", () => {
  const origins = parseKairosAllowedOrigins("https://app.example.test,https://preview.example.test");
  assert.deepEqual([...origins], ["https://app.example.test", "https://preview.example.test"]);

  assert.throws(
    () => parseKairosAllowedOrigins("*"),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => parseKairosAllowedOrigins("https://app.example.test/path"),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
  assert.throws(
    () => parseKairosAllowedOrigins("http://app.example.test"),
    (error: unknown) => error instanceof AppError && error.code === "RUNTIME_CONFIGURATION_INVALID",
  );
});

test("K4-C preflight exposes only GET and the explicit Kairos browser headers", () => {
  const origins = parseKairosAllowedOrigins("https://app.example.test");
  const allowed = evaluateKairosCors({
    method: "OPTIONS",
    origin: "https://app.example.test",
    requestedMethod: "GET",
    requestedHeaders: "Authorization, X-Correlation-Id",
    allowedOrigins: origins,
  });
  assert.equal(allowed.kind, "preflight");
  if (allowed.kind === "preflight") {
    assert.equal(allowed.headers["access-control-allow-origin"], "https://app.example.test");
    assert.equal(allowed.headers["access-control-allow-methods"], "GET, OPTIONS");
    assert.match(allowed.headers["access-control-allow-headers"], /authorization/);
  }

  const wrongOrigin = evaluateKairosCors({ method: "GET", origin: "https://evil.example.test", allowedOrigins: origins });
  assert.equal(wrongOrigin.kind, "deny");

  const wrongMethod = evaluateKairosCors({
    method: "OPTIONS",
    origin: "https://app.example.test",
    requestedMethod: "POST",
    allowedOrigins: origins,
  });
  assert.equal(wrongMethod.kind, "deny");

  const forgedScopeHeader = evaluateKairosCors({
    method: "OPTIONS",
    origin: "https://app.example.test",
    requestedMethod: "GET",
    requestedHeaders: "Authorization, X-Airen-Role",
    allowedOrigins: origins,
  });
  assert.equal(forgedScopeHeader.kind, "deny");
});

test("K4-C same-origin/server calls do not receive synthetic browser authority", () => {
  const decision = evaluateKairosCors({ method: "GET", allowedOrigins: new Set() });
  assert.equal(decision.kind, "pass");
  if (decision.kind === "pass") assert.deepEqual(decision.headers, {});
});
