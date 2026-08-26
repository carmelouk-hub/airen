import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

test('Control Plane rail exposes native Architecture entry', () => {
  assert.match(app, /id: "architecture", label: "Architecture", icon: Network/);
  assert.match(app, /activeView === "architecture"/);
  assert.match(app, /<ArchitectureReview \/>/);
});

test('Architecture view embeds the verified Explorer with no iframe capabilities', () => {
  assert.match(app, /src="\/architecture-explorer\.html"/);
  assert.match(app, /sandbox=""/);
  assert.match(app, /referrerPolicy="no-referrer"/);
  assert.match(app, /BASE44 = EXPERIENCE ONLY · FOUNDATION REMAINS AUTHORITATIVE/);
});

test('Legacy fixed launcher is removed from the shell', () => {
  assert.doesNotMatch(index, /architecture-launcher/);
  assert.doesNotMatch(index, /href="\/architecture-explorer\.html"/);
});

test('Architecture integration adds no runtime authority path', () => {
  assert.doesNotMatch(app, /fetch\s*\(/);
  assert.doesNotMatch(app, /base44\.entities/i);
  assert.doesNotMatch(app, /window\.location\s*=/);
});

test('Existing React root and entrypoint remain intact', () => {
  assert.match(index, /<div id="root"><\/div>/);
  assert.match(index, /<script type="module" src="\/src\/main\.jsx"><\/script>/);
});