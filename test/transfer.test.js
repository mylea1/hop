'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { TransferServer, sendTransfer, buildManifest, validateRelativePath } = require('../src/transfer');

const sender = { id: 'test-sender', name: 'Studio Mac', platform: 'mac' };
const receiver = { id: 'test-receiver', name: 'Desk PC', platform: 'win' };
async function fixture(t, onOffer = async () => true) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hop-transfer-'));
  const downloadDir = path.join(dir, 'received');
  const server = new TransferServer({ device: receiver, downloadDir, onOffer });
  const port = await server.start({ host: '127.0.0.1' });
  t.after(async () => { await server.close(); await fs.rm(dir, { recursive: true, force: true }); });
  return { dir, downloadDir, server, peer: { ...receiver, address: '127.0.0.1', port } };
}
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('streams a folder, empty directory and 3 MiB file with exact SHA-256 hashes', async t => {
  const f = await fixture(t);
  const folder = path.join(f.dir, 'Holiday');
  await fs.mkdir(path.join(folder, 'nested', 'empty'), { recursive: true });
  const small = Buffer.from('Hello from Hop ✨\n');
  const large = crypto.randomBytes(3 * 1024 * 1024);
  await fs.writeFile(path.join(folder, 'nested', 'note.txt'), small);
  const largePath = path.join(f.dir, 'movie.bin');
  await fs.writeFile(largePath, large);
  const progress = [];
  const result = await sendTransfer({ peer: f.peer, device: sender, paths: [folder, largePath], onProgress: e => progress.push(e) });
  assert.equal(result.totalBytes, small.length + large.length);
  assert.equal(hash(await fs.readFile(path.join(f.downloadDir, 'movie.bin'))), hash(large));
  assert.equal(hash(await fs.readFile(path.join(f.downloadDir, 'Holiday/nested/note.txt'))), hash(small));
  assert.ok((await fs.stat(path.join(f.downloadDir, 'Holiday/nested/empty'))).isDirectory());
  assert.equal(progress.at(-1).bytes, result.totalBytes);
});

test('preserves existing files and renames a whole conflicting folder', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.downloadDir, 'Album'), { recursive: true });
  await fs.writeFile(path.join(f.downloadDir, 'photo.jpg'), 'original');
  await fs.writeFile(path.join(f.dir, 'photo.jpg'), 'new');
  await fs.mkdir(path.join(f.dir, 'Album'));
  await fs.writeFile(path.join(f.dir, 'Album', 'photo.jpg'), 'inside');
  await sendTransfer({ peer: f.peer, device: sender, paths: [path.join(f.dir, 'photo.jpg'), path.join(f.dir, 'Album')] });
  assert.equal(await fs.readFile(path.join(f.downloadDir, 'photo.jpg'), 'utf8'), 'original');
  assert.equal(await fs.readFile(path.join(f.downloadDir, 'photo (1).jpg'), 'utf8'), 'new');
  assert.equal(await fs.readFile(path.join(f.downloadDir, 'Album (1)', 'photo.jpg'), 'utf8'), 'inside');
});

test('decline writes no received files', async t => {
  const f = await fixture(t, async () => false);
  await fs.writeFile(path.join(f.dir, 'no.txt'), 'declined');
  await assert.rejects(sendTransfer({ peer: f.peer, device: sender, paths: [path.join(f.dir, 'no.txt')] }), /declin/i);
  assert.deepEqual(await fs.readdir(f.downloadDir), []);
});

test('rejects traversal, absolute, Windows aliases and ambiguous paths', () => {
  for (const value of ['../outside.txt', '/tmp/file', 'C:/file', 'folder/../../file', '\\server\\file', 'a\\..\\file', 'a//b', './a', 'a/./b', 'a/../b', 'a\0b', 'a:stream', 'NUL.txt', 'CON', 'a.', 'a ', 'a/<x>']) {
    assert.throws(() => validateRelativePath(value), undefined, value);
  }
  assert.equal(validateRelativePath('旅行/hello world.jpg'), '旅行/hello world.jpg');
});

test('rejects symlink sources', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'target'), 'secret');
  try { await fs.symlink(path.join(f.dir, 'target'), path.join(f.dir, 'link')); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlinks unavailable for this Windows account'); throw error; }
  await assert.rejects(buildManifest([path.join(f.dir, 'link')]), /symbolic|symlink/i);
});

test('malformed network offer cannot create outside the download directory', async t => {
  const f = await fixture(t);
  const response = await fetch(`http://127.0.0.1:${f.peer.port}/offer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender, entries: [{ path: '../escaped', type: 'file', size: 1 }] })
  });
  assert.equal(response.status, 400);
  await assert.rejects(fs.stat(path.join(f.dir, 'escaped')), { code: 'ENOENT' });
});

test('concurrent same-name transfers never overwrite one another', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.dir, 'photo.jpg'), crypto.randomBytes(200000));
  await Promise.all([1, 2].map(() => sendTransfer({ peer: f.peer, device: sender, paths: [path.join(f.dir, 'photo.jpg')] })));
  assert.deepEqual((await fs.readdir(f.downloadDir)).sort(), ['photo (1).jpg', 'photo.jpg']);
  assert.equal(hash(await fs.readFile(path.join(f.downloadDir, 'photo.jpg'))), hash(await fs.readFile(path.join(f.downloadDir, 'photo (1).jpg'))));
});

test('empty file and empty root folder transfer successfully', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.dir, 'Empty'));
  await fs.writeFile(path.join(f.dir, 'empty.txt'), '');
  await sendTransfer({ peer: f.peer, device: sender, paths: [path.join(f.dir, 'Empty'), path.join(f.dir, 'empty.txt')] });
  assert.equal((await fs.stat(path.join(f.downloadDir, 'empty.txt'))).size, 0);
  assert.ok((await fs.stat(path.join(f.downloadDir, 'Empty'))).isDirectory());
});

async function rawOffer(f, entries) {
  const result = await fetch(`http://127.0.0.1:${f.peer.port}/offer`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender, entries }) });
  assert.equal(result.status, 200);
  return result.json();
}

test('rejects a declared size mismatch before creating a file', async t => {
  const f = await fixture(t);
  const offer = await rawOffer(f, [{ path: 'sized.bin', type: 'file', size: 50 }]);
  const response = await fetch(`http://127.0.0.1:${f.peer.port}/transfer/${offer.id}/files/0`, { method: 'PUT',
    headers: { 'x-hop-token': offer.token }, body: 'short' });
  assert.equal(response.status, 400);
  assert.deepEqual(await fs.readdir(f.downloadDir), []);
});

test('removes a partially streamed file when the sender disconnects', async t => {
  const f = await fixture(t);
  const offer = await rawOffer(f, [{ path: 'partial.bin', type: 'file', size: 3000000 }]);
  const failed = new Promise(resolve => f.server.on('progress', event => { if (event.phase === 'failed') resolve(event); }));
  const progress = once(f.server, 'progress');
  const request = http.request({ hostname: '127.0.0.1', port: f.peer.port, method: 'PUT', path: `/transfer/${offer.id}/files/0`,
    headers: { 'x-hop-token': offer.token, 'content-length': 3000000 } });
  request.on('error', () => {});
  request.write(Buffer.alloc(100000));
  await progress;
  request.destroy();
  await failed;
  assert.deepEqual(await fs.readdir(f.downloadDir), []);
});

test('refuses a destination parent replaced with a symbolic link', async t => {
  const f = await fixture(t);
  const offer = await rawOffer(f, [{ path: 'Folder', type: 'directory', size: 0 }, { path: 'Folder/file.txt', type: 'file', size: 3 }]);
  const outside = path.join(f.dir, 'outside');
  await fs.mkdir(outside);
  await fs.rmdir(path.join(f.downloadDir, 'Folder'));
  try { await fs.symlink(outside, path.join(f.downloadDir, 'Folder'), 'dir'); }
  catch (error) { if (error.code === 'EPERM') return t.skip('Symlinks unavailable for this Windows account'); throw error; }
  const response = await fetch(`http://127.0.0.1:${f.peer.port}/transfer/${offer.id}/files/1`, { method: 'PUT',
    headers: { 'x-hop-token': offer.token }, body: 'abc' });
  assert.equal(response.status, 400);
  assert.deepEqual(await fs.readdir(outside), []);
});

test('closing the server promptly releases unanswered offers', async t => {
  let offered;
  const waiting = new Promise(resolve => { offered = resolve; });
  const f = await fixture(t, () => { offered(); return new Promise(() => {}); });
  const pending = fetch(`http://127.0.0.1:${f.peer.port}/offer`, { method: 'POST', body: JSON.stringify({ sender,
    entries: [{ path: 'hello.txt', type: 'file', size: 1 }] }) }).catch(() => {});
  await waiting;
  await f.server.close();
  await pending;
  assert.equal(f.server.pendingOffers.size, 0);
});
