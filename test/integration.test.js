const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { Discovery } = require('../src/discovery');
const { TransferServer, sendTransfer } = require('../src/transfer');

test('two devices: real UDP discovery → accepted HTTP offer → folder + 3 MiB stream → identical SHA256', { timeout: 20000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hop-e2e-'));
  const outgoing = path.join(root, 'source');
  const incoming = path.join(root, 'Downloads', 'Hop');
  await fs.mkdir(path.join(outgoing, 'Trip', 'nested'), { recursive: true });
  await fs.mkdir(path.join(outgoing, 'Trip', 'empty'), { recursive: true });
  const fixtures = { 'Trip/hello.txt': Buffer.from('Hello, nearby. 你好，Hop。'), 'Trip/nested/photo.bin': randomBytes(4097), 'large.bin': randomBytes(3 * 1024 * 1024) };
  for (const [name, data] of Object.entries(fixtures)) await fs.writeFile(path.join(outgoing, name), data);
  const a = { id: 'integration-mac', name: 'Studio Mac', platform: 'mac' };
  const b = { id: 'integration-win', name: 'Surface', platform: 'win' };
  const offers = [];
  const serverA = new TransferServer({ device: a, downloadDir: path.join(root, 'A'), onOffer: async () => true });
  const serverB = new TransferServer({ device: b, downloadDir: incoming, onOffer: async offer => { offers.push(offer); return true; } });
  const da = new Discovery({ device: a, port: 0, bindAddress: '127.0.0.1', targets: () => [] });
  const db = new Discovery({ device: b, port: 0, bindAddress: '127.0.0.1', targets: () => [] });
  t.after(async () => { await da.stop(); await db.stop(); await serverA.close(); await serverB.close(); await fs.rm(root, { recursive: true, force: true }); });
  a.port = await serverA.start({ host: '127.0.0.1' });
  b.port = await serverB.start({ host: '127.0.0.1' });
  await da.start(); await db.start();
  da.targets = () => [{ address: '127.0.0.1', port: db.boundPort }];
  db.targets = () => [{ address: '127.0.0.1', port: da.boundPort }];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UDP peer discovery failed')), 3000);
    da.once('peers', () => { clearTimeout(timer); resolve(); });
    db.announce(); da.announce();
  });
  const progress = [];
  await sendTransfer({ peer: da.getPeers()[0], device: a, paths: [path.join(outgoing, 'Trip'), path.join(outgoing, 'large.bin')], onProgress: p => progress.push(p) });
  assert.equal(offers.length, 1);
  for (const [name, bytes] of Object.entries(fixtures)) {
    const actual = await fs.readFile(path.join(incoming, name));
    const hash = b => createHash('sha256').update(b).digest('hex');
    assert.equal(hash(actual), hash(bytes), name);
  }
  assert.ok((await fs.stat(path.join(incoming, 'Trip', 'empty'))).isDirectory());
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1).bytes, progress.at(-1).total);
});
