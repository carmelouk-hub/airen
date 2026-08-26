import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Control Plane shell exposes read-only Architecture Explorer launcher', () => {
  assert.match(index, /class="architecture-launcher"/);
  assert.match(index, /href="\/architecture-explorer\.html"/);
  assert.match(index, />\s*Architecture Explorer\s*<small>READ ONLY<\/small>/);
});

test('Launcher is static navigation, not a runtime authority path', () => {
  assert.doesNotMatch(index, /fetch\s*\(/);
  assert.doesNotMatch(index, /base44\.entities/i);
  assert.doesNotMatch(index, /window\.location\s*=/);
});

test('Existing React root and entrypoint remain intact', () => {
  assert.match(index, /<div id="root"><\/div>/);
  assert.match(index, /<script type="module" src="\/src\/main\.jsx"><\/script>/);
});
