import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appSource = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const readmeSource = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const lifecycle = ["Requested", "Pending", "Confirmed", "Arrived", "Seated", "Completed"];
const modules = [
  "Booking",
  "Guest relationships",
  "Service operations",
  "Supplier relationships",
  "STELLA",
  "Governance evidence",
];

test("Tenant and Location remain unresolved and fail closed in the staging shell", () => {
  assert.match(appSource, /Tenant not resolved/);
  assert.match(appSource, /Location not resolved/);
  assert.match(appSource, /Fail closed/);
  assert.match(readmeSource, /Client-supplied Tenant or Location values are never authority\./);
});

test("Booking remains a gated design view pending T20 and Golden Restaurant E2E", () => {
  assert.match(appSource, /OPERATIONS LOCKED · T20/);
  assert.match(appSource, /Portable contract pending T20/);
  assert.match(appSource, /not an executable Booking runtime/);
  assert.match(readmeSource, /Booking is a locked design view until the portable contract, T20 and Golden Restaurant E2E are complete\./);
});

test("the canonical Booking design lifecycle keeps the six accepted active states", () => {
  for (const step of lifecycle) assert.match(appSource, new RegExp(`\\b${step}\\b`));
  assert.match(appSource, /Alternative terminal states: Cancelled · No show/);
});

test("the six restaurant operating surfaces remain visible", () => {
  for (const moduleName of modules) assert.match(appSource, new RegExp(moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("STELLA remains governed assistance without a direct operational-write path", () => {
  assert.match(appSource, /Governed assistance, no direct writes/);
  assert.match(readmeSource, /STELLA has no direct operational-write path\./);
});

test("AIRenOS Foundation remains external authority", () => {
  assert.match(appSource, /Foundation authority remains external/);
  assert.match(appSource, /trusted Tenant\/Location resolution, permissions, entitlements, idempotency, audit and outbox/);
  assert.match(readmeSource, /The app may consume only accepted AIRenOS contracts\./);
});

test("the staging shell contains no production-data or operational-entity claim", () => {
  assert.match(appSource, /No production fixtures or authoritative entities/);
  assert.match(appSource, /No operational data connected/);
  assert.match(readmeSource, /No production data, operational entities, connectors, agents or secrets are present\./);
});

test("Base44 is not presented as the source of AIRenOS authority", () => {
  assert.doesNotMatch(appSource, /Base44 authority/i);
  assert.doesNotMatch(readmeSource, /Base44.*authorit(?:y|ative)/i);
  assert.match(appSource, /Powered by AIRenOS/);
});
