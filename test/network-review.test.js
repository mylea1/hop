'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { TransferServer, sendTransfer } = require('../src/transfer');

const receiver = { id: 'review-receiver', name: 'Review PC', platform: 'win' };
const sender = { id: 'review-sender', name: 'Review Mac', platform: 'mac' };

async function fixture(t, onOffer = () => true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hop-review-'));
  const downloadDir = path.join(root, 'received');
  const server = new TransferServer({ device: receiver, downloadDir, onOffer });
  t.after(async () => { await server.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, downloadDir, server };
}

test('HTTP service can retry after an occupied-port startup failure', async t => {
  const f = await fixture(t);
  const occupied = http.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  const port = occupied.address().port;
  try {
    await assert.rejects(f.server.start({ host: '127.0.0.1', port }), { code: 'EADDRINUSE' });
  } finally { await new Promise(resolve => occupied.close(resolve)); }
  assert.equal(await f.server.start({ host: '127.0.0.1', port }), port);
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 200);
});

test('accepted offer ID stays reserved while destination directories are allocated', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const port = await f.server.start({ host: '127.0.0.1' });
  const allocate = f.server.allocateDirectories.bind(f.server);
  let release, enter;
  const entered = new Promise(resolve => { enter = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let allocations = 0;
  f.server.allocateDirectories = async session => {
    if (++allocations === 1) { enter(); await held; }
    return allocate(session);
  };
  const body = { id: '11111111-1111-1111-1111-111111111111', sender,
    entries: [{ path: 'Folder', type: 'directory', size: 0 }] };
  const send = () => fetch(`http://127.0.0.1:${port}/offer`, { method: 'POST', body: JSON.stringify(body) });
  const first = send();
  await entered;
  let second;
  try { second = await send(); } finally { release(); }
  const accepted = await first;
  assert.equal(accepted.status, 200);
  assert.equal(second.status, 409);
  assert.equal(allocations, 1);
  assert.deepEqual(await fs.readdir(f.downloadDir), ['Folder']);
});

test('source size changed during acceptance fails without leaving a received file', async t => {
  let source;
  const f = await fixture(t, async () => { await fs.writeFile(source, 'file changed after offer'); return true; });
  const port = await f.server.start({ host: '127.0.0.1' });
  source = path.join(f.root, 'changing.txt');
  await fs.writeFile(source, 'before');
  await assert.rejects(sendTransfer({ peer: { ...receiver, address: '127.0.0.1', port }, device: sender, paths: [source] }), /changed/);
  assert.deepEqual(await fs.readdir(f.downloadDir), []);
  assert.equal(f.server.sessions.size, 0);
});

test('completed offers cannot be reused to upload or complete again', async t => {
  const f = await fixture(t);
  const port = await f.server.start({ host: '127.0.0.1' });
  const offerResponse = await fetch(`http://127.0.0.1:${port}/offer`, { method: 'POST', body: JSON.stringify({ sender,
    entries: [{ path: 'empty', type: 'directory', size: 0 }] }) });
  const offer = await offerResponse.json();
  const complete = () => fetch(`http://127.0.0.1:${port}/transfer/${offer.id}/complete`, { method: 'POST', headers: { 'x-hop-token': offer.token } });
  assert.equal((await complete()).status, 200);
  assert.equal((await complete()).status, 404);
});

test('server close waits until an interrupted active file has been removed', async t => {
  const f = await fixture(t);
  const port = await f.server.start({ host: '127.0.0.1' });
  const offerResponse = await fetch(`http://127.0.0.1:${port}/offer`, { method: 'POST', body: JSON.stringify({ sender,
    entries: [{ path: 'partial.bin', type: 'file', size: 3000000 }] }) });
  const offer = await offerResponse.json();
  const request = http.request({ hostname: '127.0.0.1', port, method: 'PUT', path: `/transfer/${offer.id}/files/0`,
    headers: { 'content-length': 3000000, 'x-hop-token': offer.token } });
  request.on('error', () => {});
  const progress = once(f.server, 'progress');
  request.write(Buffer.alloc(100000));
  await progress;
  await f.server.close();
  assert.deepEqual(await fs.readdir(f.downloadDir), []);
  assert.equal(f.server.activeHandlers.size, 0);
});
