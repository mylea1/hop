const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings } = require('../src/main/settings');

test('device identity, theme, destination and trust survive restart; trust can be cleared', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  const initial = new Settings(file, { downloadDir: root, name: 'Studio' });
  initial.update({ theme: 'dark', downloadDir: path.join(root, 'Received') });
  initial.trust({ id: 'device-b', name: 'Surface' });
  const restored = new Settings(file, { downloadDir: root });
  assert.equal(restored.data.id, initial.data.id);
  assert.equal(restored.data.theme, 'dark');
  assert.equal(restored.data.downloadDir, path.join(root, 'Received'));
  assert.ok(restored.isTrusted('device-b'));
  restored.clearTrust();
  assert.equal(new Settings(file, { downloadDir: root }).isTrusted('device-b'), false);
  assert.throws(() => restored.update({ name: 'Should not stick', theme: 'invalid' }));
  assert.equal(restored.data.name, 'Studio');
});

test('corrupt settings retained as backup and replaced with usable defaults', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hop-settings-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'settings.json');
  fs.writeFileSync(file, 'broken');
  const settings = new Settings(file, { downloadDir: root, name: 'Mac' });
  assert.equal(settings.data.name, 'Mac');
  assert.ok(settings.data.id);
  assert.ok(fs.readdirSync(root).some(name => name.startsWith('settings.json.corrupt-')));
});
