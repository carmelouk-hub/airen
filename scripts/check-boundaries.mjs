import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const runtimeRoots = ["apps", "packages", "db/migrations"];
const forbidden = [/@base44\/sdk/i, /base44\.entities/i, /asServiceRole/i, /BASE44_APP_ID/i];
const suspiciousSecretValue = /(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i;
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".sql", ".yml", ".yaml"]);

async function walk(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const p = join(path, e.name);
    if (e.isDirectory()) files.push(...await walk(p)); else files.push(p);
  }
  return files;
}

let failures = [];
for (const rr of runtimeRoots) {
  for (const file of await walk(join(root, rr))) {
    const ext = file.slice(file.lastIndexOf("."));
    if (!allowedExtensions.has(ext)) continue;
    const text = await readFile(file, "utf8");
    for (const rx of forbidden) if (rx.test(text)) failures.push(`${relative(root,file)}: forbidden Base44 runtime coupling ${rx}`);
    if (suspiciousSecretValue.test(text)) failures.push(`${relative(root,file)}: possible committed secret value`);
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Boundary check PASS: no Base44 Foundation runtime coupling or obvious committed secret values detected.");
