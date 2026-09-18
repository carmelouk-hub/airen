import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Gate122 forces fresh upstream authentication on staging OIDC start", async () => {
  const source = await readFile(
    new URL("../../apps/api/src/session-authority-staging-server.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /authorizationUrl\.searchParams\.set\("prompt", "login"\)/);
  assert.equal(source.includes('authorizationUrl.searchParams.set("prompt", "none")'), false);
});
