import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/architecture-explorer.html', import.meta.url), 'utf8');

test('Explorer declares read-only Base44 boundary', () => {
  assert.match(html, /READ ONLY/);
  assert.match(html, /BASE44 = EXPERIENCE ONLY/);
});

test('Explorer preserves Foundation authority framing', () => {
  assert.match(html, /Foundation rimane l'unica fonte operativa autorevole/);
  assert.match(html, /R3 PROTECTED/);
});

test('Explorer exposes real architecture paths without runtime actions', () => {
  for (const path of [
    'packages/identity/src/index.ts',
    'packages/authorization/src/index.ts',
    'packages/tenant/src/index.ts',
    'packages/persistence-postgres/src/index.ts',
    'packages/persistence-postgres/src/risto-booking-repository.ts',
    'apps/api/src/ristoairen-booking-api.ts'
  ]) assert.match(html, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.doesNotMatch(html, /base44\.entities/i);
});
