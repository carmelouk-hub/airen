import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/architecture-explorer.html', import.meta.url), 'utf8');

const sourcePaths = [
  'packages/identity/src/index.ts',
  'packages/authorization/src/index.ts',
  'packages/tenant/src/index.ts',
  'packages/persistence-postgres/src/index.ts',
  'packages/persistence-postgres/src/risto-booking-repository.ts',
  'apps/api/src/ristoairen-booking-api.ts'
];

const sourceBlobs = [
  'b0ee6060c5a28f7d1aa216f223054bea4d06d9d9',
  'ea4e48220eb040b5e555593715a0b50df0181d80',
  'fa2f500f8a1a7e725067de40711d20f81f41a922',
  '6d040134f58072b67c5c3f67a640b578136380b4',
  '468232abf7621039de744fe6822053b1843781f8',
  '6661d5528da34814f7d443751447aee253432820'
];

test('Explorer declares read-only Base44 boundary', () => {
  assert.match(html, /READ ONLY/);
  assert.match(html, /BASE44 = EXPERIENCE ONLY/);
  assert.match(html, /Foundation rimane l'unica fonte operativa autorevole/);
  assert.match(html, /R3 PROTECTED/);
});

test('Explorer v0.3 exposes RistoAIRen as a connected vertical without JavaScript', () => {
  assert.match(html, /v0\.3 · RISTOAIREN CONNECTED/);
  assert.match(html, /RistoAIRen Vertical Connection/);
  assert.match(html, /RISTOAIREN VERTICAL/);
  assert.equal((html.match(/class="vnode /g) ?? []).length, 5);
  assert.doesNotMatch(html, /<script\b/i);
});

test('RistoAIRen dependency chain preserves Foundation-first authority', () => {
  for (const marker of [
    'AIRenOS FOUNDATION',
    'GOVERNED EXCHANGE',
    'RISTOAIREN',
    'FIRST PORTABLE DOMAIN',
    'EXPERIENCE LAYER',
    'Foundation ↔ Vertical',
    'T20 · PASS BOUNDED',
    'GOLDEN / PUBLICATION · NOT AUTHORIZED'
  ]) assert.match(html, new RegExp(marker));
});

test('RistoAIRen connection pins governed boundary and staging sources', () => {
  assert.match(html, /8e0c79796e59b970c7e7cb3e8170abcd8de155ad/);
  assert.match(html, /eb666f018812a684576506ef05f5c02555603d19/);
  assert.match(html, /468232abf7621039de744fe6822053b1843781f8/);
});

test('Vertical view keeps core authority in AIRenOS Foundation', () => {
  for (const label of [
    'Identity',
    'Tenant / Location',
    'Membership / RBAC',
    'Entitlements',
    'Trusted DB scope / RLS',
    'Audit / Outbox'
  ]) assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok((html.match(/AIRenOS Foundation/g) ?? []).length >= 6);
  assert.match(html, /Restaurant domain logic/);
  assert.match(html, /RistoAIRen vertical/);
});

test('Explorer retains six real code drawers and pinned source blobs', () => {
  assert.equal((html.match(/class="code-drawer"/g) ?? []).length, 6);
  for (const path of sourcePaths) assert.match(html, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const blob of sourceBlobs) assert.match(html, new RegExp(blob));
});

test('Displayed excerpts contain verified Foundation and T20 boundary markers', () => {
  for (const marker of [
    'AUTHENTICATION_REQUIRED',
    'MEMBERSHIP_REQUIRED',
    'TENANT_RESOLUTION_FAILED',
    'airen.identity_id',
    'PostgresRistoBookingMutationTransaction',
    'RETRYABLE_FAILURE'
  ]) assert.match(html, new RegExp(marker));
});

test('Vertical visualization adds no runtime authority path', () => {
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.doesNotMatch(html, /base44\.entities/i);
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(html, /<button\b/i);
});
