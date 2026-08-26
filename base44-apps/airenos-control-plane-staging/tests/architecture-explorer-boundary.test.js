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

test('Explorer v0.5 exposes RistoAIRen domain galaxy and restaurant journey without JavaScript', () => {
  assert.match(html, /v0\.5 · RESTAURANT JOURNEY FLOW/);
  assert.match(html, /RistoAIRen Vertical Connection/);
  assert.match(html, /RistoAIRen Domain Galaxy/);
  assert.match(html, /DOMAIN GALAXY/);
  assert.equal((html.match(/class="vnode /g) ?? []).length, 5);
  assert.equal((html.match(/class="planet /g) ?? []).length, 38);
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

test('Domain galaxy distinguishes live Booking from Golden targets and Reserved Next', () => {
  assert.match(html, /packages\/ristoairen\/src\/booking/);
  assert.match(html, /RUNTIME · T20 PASS BOUNDED/);
  for (const domain of [
    'Customer &amp; CRM',
    'Arrival · Check-In · Table',
    'ServiceSession',
    'Order',
    'Production · KDS · Bar',
    'Bill · Payment · Cash',
    'Events',
    'Gift Voucher',
    'Content · Journal · SEO',
    'Media &amp; Visual AI',
    'ATMOS',
    'STELLA',
    'Inventory',
    'Procurement',
    'Recipes &amp; Cost',
    'Production Orchestrator',
    'QSR QuickFlow'
  ]) assert.match(html, new RegExp(domain.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  assert.match(html, /RESERVED NEXT/);
  assert.match(html, /GOLDEN SPEC · target canonico, non runtime certificato/);
});

test('Galaxy states that non-Booking presence is not runtime certification', () => {
  assert.match(html, /La presenza in questa mappa non equivale a runtime implementato/);
  assert.match(html, /salvo Booking/);
  assert.match(html, /DOC-015 Golden Restaurant E2E Specification/);
});

test('Restaurant journey follows DOC-015 canonical sequence and preserves Foundation controls', () => {
  for (const step of [
    'Discovery','Booking','Customer','Arrival','Check-In','Table','ServiceSession','Order',
    'Production Routing','Kitchen / Bar','Ready','Serve','Bill','Payment','Close','CRM Update',
    'Analytics / Event','Audit','STELLA Observation','Insight → Governed Proposal'
  ]) assert.match(html, new RegExp(step.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')));
  for (const control of ['Tenant/Location','SecurityContext','RLS','idempotency','permissions','audit','outbox'])
    assert.match(html, new RegExp(control, 'i'));
  assert.match(html, /Non dichiara implementati i passaggi Golden non ancora runtime-certified/);
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