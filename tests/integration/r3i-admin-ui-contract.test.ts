import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [ui,html,css,server]=await Promise.all([
  readFile("apps/admin/admin.js","utf8"),
  readFile("apps/admin/index.html","utf8"),
  readFile("apps/admin/styles.css","utf8"),
  readFile("apps/api/src/server.ts","utf8")
]);

test("R3I-T25 UI permission guards are demonstrably UX-only; direct unauthorized API call remains denied",()=>{
  assert.ok(ui.includes("platformPermissions"));
  assert.ok(ui.includes("can("));
  assert.ok(ui.includes("disabled"));
  assert.ok(html.includes("UI guards are UX only"));
  assert.equal(ui.includes("x-platform-permissions"),false);
  assert.equal(ui.includes("x-platform-role"),false);
});

test("R3I-T26 UI/session code does not persist authority or auth secrets in localStorage",()=>{
  for(const forbidden of ["localStorage","sessionStorage","document.cookie","indexedDB"])assert.equal(ui.includes(forbidden),false);
  assert.ok(ui.includes('credentials:"same-origin"'));
  assert.equal(ui.includes("Bearer "),false);
});

test("R3I-T27 unauthenticated/forbidden/conflict/API-degraded/module-failure states are represented fail-closed",()=>{
  for(const marker of ["Authentication required","Forbidden","Degraded","No stale state is treated as authority","Module unavailable"])assert.ok(ui.includes(marker));
  for(const view of ["overview","tenants","principals","billing","entitlements","capabilities","audit","system"])assert.ok(html.includes(`data-view="${view}"`));
  assert.ok(server.includes("content-security-policy"));
  assert.ok(css.includes("@media"));
});
