import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import * as canonical from "../../packages/airenpay/src/index.ts";
import * as compatibility from "../../packages/ristoairen/src/airenpay/index.ts";

const root = new URL("../../", import.meta.url).pathname;
const canonicalRoot = join(root, "packages/airenpay/src");
const compatibilityRoot = join(root, "packages/ristoairen/src/airenpay");
const thisTestFile = new URL(import.meta.url).pathname;
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);

const canonicalFiles = Object.freeze([
  "contracts.ts",
  "policy.ts",
  "authorization-expiry-policy.ts",
  "persistence-contracts.ts",
  "index.ts"
]);

async function walk(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(candidate));
    else files.push(candidate);
  }
  return files;
}

test("AP01-001 canonical AIRenPay package owns the provider-neutral bindings", () => {
  assert.equal(canonical.AIREN_PAY_ENTITLEMENT, "airen.pay");
  assert.deepEqual(Object.keys(compatibility).sort(), Object.keys(canonical).sort());
  for (const key of Object.keys(canonical) as Array<keyof typeof canonical>) {
    assert.equal(compatibility[key], canonical[key], `compatibility binding ${String(key)} must not fork`);
  }
});

test("AP01-002 canonical AIRenPay source depends directly on AIRenOS packages", async () => {
  for (const file of canonicalFiles) {
    const text = await readFile(join(canonicalRoot, file), "utf8");
    assert.doesNotMatch(text, /ristoairen/i, `${file} must not depend on RISTOAIREN`);
    assert.doesNotMatch(text, /stripe|paypal|adyen|nexi|worldline|sumup/i, `${file} must remain provider-neutral`);
  }
  const contracts = await readFile(join(canonicalRoot, "contracts.ts"), "utf8");
  const policy = await readFile(join(canonicalRoot, "policy.ts"), "utf8");
  assert.match(contracts, /\.\.\/\.\.\/booking-core\/src\/hold-contracts\.ts/);
  assert.match(policy, /\.\.\/\.\.\/booking-core\/src\/hold-contracts\.ts/);
});

test("AP01-003 RISTOAIREN AIRenPay paths are compatibility re-exports only", async () => {
  for (const file of canonicalFiles) {
    const text = (await readFile(join(compatibilityRoot, file), "utf8")).trim();
    assert.equal(text, `export * from "../../../airenpay/src/${file}";`);
  }
});

test("AP01-004 runtime, adapter, deployment and tests consume the canonical package", async () => {
  const forbidden = ["ristoairen", "src", "airenpay"].join("/");
  for (const scope of ["deploy", "packages", "tests"]) {
    for (const file of await walk(join(root, scope))) {
      if (!sourceExtensions.has(extname(file))) continue;
      if (file.startsWith(compatibilityRoot)) continue;
      if (file === thisTestFile) continue;
      const text = await readFile(file, "utf8");
      assert.equal(text.includes(forbidden), false, `${relative(root, file)} imports historical AIRenPay ownership`);
    }
  }
});
