'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { buildManifest, validateRelativePath, validateEntries, suffixName, inside, verifyParents } = require('./paths');

const OFFER_TIMEOUT = 120000;
const IDLE_TIMEOUT = 120000;
const SESSION_TIMEOUT = 10 * 60000;
const MAX_JSON = 16 * 1024 * 1024;

function json(response, status, body) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

async function readJSON(request) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > MAX_JSON) throw new Error('Offer is too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validateDevice(device) {
  if (!device || typeof device.id !== 'string' || !device.id || device.id.length > 128 || typeof device.name !== 'string' ||
      !device.name.trim() || device.name.length > 128 || !['mac', 'win'].includes(device.platform)) throw new Error('Invalid sending device');
  return { id: device.id, name: device.name, platform: device.platform };
}

class TransferServer extends EventEmitter {
  constructor({ device, downloadDir, onOffer = async () => false }) {
    super();
    this.device = validateDevice(device);
    this.downloadDir = path.resolve(downloadDir);
    this.onOffer = onOffer;
    this.sessions = new Map();
    this.pendingOffers = new Map();
    this.reservedOffers = new Set();
    this.activeHandlers = new Set();
    this.server = null;
    this.port = null;
    this.closing = false;
  }

  async start({ host = '0.0.0.0', port = 0 } = {}) {
    if (this.server) return this.port;
    await fsp.mkdir(this.downloadDir, { recursive: true });
    this.closing = false;
    this.server = http.createServer((req, res) => {
      const operation = this.handle(req, res).catch(error => {
        this.emit('warning', { message: error.message });
        json(res, 400, { error: error.message });
      });
      this.activeHandlers.add(operation);
      operation.then(() => this.activeHandlers.delete(operation), () => this.activeHandlers.delete(operation));
    });
    this.server.requestTimeout = 0; // Large files have no total-duration limit; each stream has an idle timeout.
    this.server.headersTimeout = 30000;
    this.server.on('clientError', (_, socket) => socket.destroy());
    try {
      await new Promise((resolve, reject) => {
        this.server.once('error', reject);
        this.server.listen(port, host, () => { this.server.removeListener('error', reject); resolve(); });
      });
    } catch (error) {
      // A failed bind must not make the next start() look already started.
      const failedServer = this.server;
      this.server = null;
      this.port = null;
      failedServer.close();
      throw error;
    }
    this.server.on('error', error => this.emit('warning', { message: error.message }));
    this.port = this.server.address().port;
    this.sweeper = setInterval(() => {
      for (const [id, session] of this.sessions) {
        if (Date.now() - session.updatedAt > SESSION_TIMEOUT) {
          for (const request of session.requests) request.destroy(new Error('Transfer expired'));
          this.sessions.delete(id);
        }
      }
    }, 30000);
    this.sweeper.unref();
    return this.port;
  }

  setDownloadDir(downloadDir) { this.downloadDir = path.resolve(downloadDir); }

  async close() {
    this.closing = true;
    clearInterval(this.sweeper);
    const server = this.server;
    this.server = null;
    for (const cancel of this.pendingOffers.values()) cancel('Hop is shutting down');
    this.pendingOffers.clear();
    this.reservedOffers.clear();
    for (const session of this.sessions.values()) for (const req of session.requests) req.destroy(new Error('Hop is shutting down'));
    this.sessions.clear();
    if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    // Socket closure precedes pipeline cleanup. Wait for handlers so a caller
    // can safely exit the process without leaving an aborted partial file.
    await Promise.allSettled([...this.activeHandlers]);
  }

  event(session, phase = 'transferring') {
    return { id: session.id, direction: 'receive', peerId: session.sender.id, peerName: session.sender.name,
      name: session.entries.filter(entry => !entry.path.includes('/')).map(entry => entry.path).join(', '),
      bytes: session.bytes, total: session.totalBytes, phase };
  }

  decideOffer(offer, response) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (accepted, error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        response.removeListener('close', disconnected);
        this.pendingOffers.delete(offer.id);
        if (error) { this.emit('offer-expired', { id: offer.id, reason: error.message }); reject(error); }
        else resolve(accepted);
      };
      const cancel = reason => finish(false, new Error(reason));
      const disconnected = () => cancel('Sending device disconnected');
      this.pendingOffers.set(offer.id, cancel);
      response.once('close', disconnected);
      timer = setTimeout(() => cancel('Offer expired before it was accepted'), OFFER_TIMEOUT);
      Promise.resolve().then(() => this.onOffer(offer)).then(value => finish(Boolean(value)), error => finish(false, error));
    });
  }

  async allocateDirectories(session) {
    await fsp.mkdir(session.root, { recursive: true });
    session.root = await fsp.realpath(session.root);
    const directories = session.entries.filter(entry => entry.type === 'directory').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
    for (const entry of directories) {
      const parts = entry.path.split('/');
      if (parts.length === 1) {
        for (let i = 0; ; i++) {
          const name = suffixName(parts[0], i, true);
          const target = inside(session.root, path.join(session.root, name));
          try { await fsp.mkdir(target); session.roots.set(parts[0], name); break; }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        }
      } else {
        const target = this.targetPath(session, entry.path);
        await verifyParents(session.root, target);
        await fsp.mkdir(target); // No recursive traversal through pre-existing descendants.
      }
      session.completed.add(session.entries.indexOf(entry));
    }
  }

  targetPath(session, relative) {
    const parts = relative.split('/');
    parts[0] = session.roots.get(parts[0]) || parts[0];
    return inside(session.root, path.join(session.root, ...parts));
  }

  async openDestination(session, entry) {
    const original = this.targetPath(session, entry.path);
    await verifyParents(session.root, original);
    for (let i = 0; ; i++) {
      const target = path.join(path.dirname(original), suffixName(path.basename(original), i));
      try {
        const handle = await fsp.open(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0));
        if (!entry.path.includes('/')) session.roots.set(entry.path, path.basename(target));
        return { handle, target };
      } catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
  }

  async handle(req, res) {
    const pathname = new URL(req.url, 'http://hop.local').pathname;
    if (req.method === 'GET' && pathname === '/health') return json(res, 200, { app: 'Hop', device: this.device, port: this.port });
    if (req.method === 'POST' && pathname === '/offer') {
      req.setTimeout(IDLE_TIMEOUT, () => req.destroy(new Error('Offer upload timed out')));
      const body = await readJSON(req);
      const sender = validateDevice(body.sender);
      const { entries, totalBytes } = validateEntries(body.entries);
      const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : randomUUID();
      if (this.sessions.has(id) || this.reservedOffers.has(id)) return json(res, 409, { error: 'Transfer already exists' });
      const offer = { id, sender, entries, totalBytes };
      // Keep the ID reserved across both the confirmation and asynchronous
      // directory creation. Otherwise two requests can replace one session.
      this.reservedOffers.add(id);
      try {
        const accepted = await this.decideOffer(offer, res);
        if (!accepted) return json(res, 403, { error: 'Transfer declined by the receiving device' });
        if (res.destroyed || this.closing) return;
        const session = { ...offer, token: randomBytes(24).toString('hex'), root: this.downloadDir, roots: new Map(), completed: new Set(),
          busy: new Set(), bytes: 0, updatedAt: Date.now(), requests: new Set() };
        await this.allocateDirectories(session);
        if (res.destroyed || this.closing) return;
        this.sessions.set(id, session);
        this.emit('progress', this.event(session, 'accepted'));
        return json(res, 200, { id, token: session.token });
      } finally { this.reservedOffers.delete(id); }
    }

    const route = pathname.match(/^\/transfer\/([0-9a-f-]{36})\/(?:files\/(\d+)|(complete)|(cancel))$/i);
    if (!route) return json(res, 404, { error: 'Not found' });
    const session = this.sessions.get(route[1]);
    if (!session || req.headers['x-hop-token'] !== session.token) return json(res, 404, { error: 'Transfer is no longer available' });
    session.updatedAt = Date.now();
    if (route[4] && req.method === 'POST') {
      for (const active of session.requests) active.destroy(new Error('Transfer cancelled'));
      this.sessions.delete(session.id);
      this.emit('progress', this.event(session, 'cancelled'));
      return json(res, 200, { cancelled: true });
    }
    if (route[3] && req.method === 'POST') {
      if (session.completed.size !== session.entries.length) return json(res, 409, { error: 'Transfer has incomplete files' });
      const paths = [...new Set(session.entries.filter(entry => !entry.path.includes('/')).map(entry => this.targetPath(session, entry.path)))];
      this.sessions.delete(session.id);
      const result = { ...this.event(session, 'complete'), paths, totalBytes: session.totalBytes };
      this.emit('complete', result);
      return json(res, 200, { id: session.id, paths, totalBytes: session.totalBytes });
    }
    if (req.method !== 'PUT' || route[2] === undefined) return json(res, 405, { error: 'Method not allowed' });
    const index = Number(route[2]);
    const entry = session.entries[index];
    if (!entry || entry.type !== 'file') return json(res, 400, { error: 'Unknown file' });
    if (session.busy.has(index) || session.completed.has(index)) return json(res, 409, { error: 'File already sent' });
    if (req.headers['content-length'] !== String(entry.size)) return json(res, 400, { error: 'File size does not match the offer' });
    session.busy.add(index);
    session.requests.add(req);
    req.setTimeout(IDLE_TIMEOUT, () => req.destroy(new Error('Transfer stalled')));
    let destination;
    let received = 0;
    let lastProgress = 0;
    try {
      destination = await this.openDestination(session, entry);
      const meter = new Transform({ transform: (chunk, _, callback) => {
        received += chunk.length;
        if (received > entry.size) return callback(new Error('File exceeded its declared size'));
        session.bytes += chunk.length;
        session.updatedAt = Date.now();
        if (Date.now() - lastProgress >= 80) { this.emit('progress', this.event(session)); lastProgress = Date.now(); }
        callback(null, chunk);
      } });
      await pipeline(req, meter, destination.handle.createWriteStream());
      if (received !== entry.size) throw new Error('Incomplete file received');
      session.completed.add(index);
      this.emit('progress', this.event(session));
      json(res, 200, { received, path: destination.target });
    } catch (error) {
      session.bytes -= received;
      if (destination) { await destination.handle.close().catch(() => {}); await fsp.unlink(destination.target).catch(() => {}); }
      this.emit('progress', { ...this.event(session, 'failed'), error: error.message });
      json(res, 400, { error: error.message });
    } finally {
      session.busy.delete(index);
      session.requests.delete(req);
    }
  }
}

function requestJSON(peer, method, pathname, body, token, timeout = OFFER_TIMEOUT + 5000) {
  const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: peer.address, port: peer.port, path: pathname, method, agent: false,
      headers: { ...(encoded ? { 'content-type': 'application/json', 'content-length': encoded.length } : {}), ...(token ? { 'x-hop-token': token } : {}) } }, response => {
      readJSON(response).then(result => {
        if (response.statusCode >= 400) reject(new Error(result.error || `HTTP ${response.statusCode}`));
        else resolve(result);
      }, reject);
    });
    request.setTimeout(timeout, () => request.destroy(new Error('The other device did not respond in time')));
    request.on('error', reject);
    request.end(encoded);
  });
}

async function uploadFile(peer, id, token, entry, index, onBytes) {
  // Re-check the selected file just before opening: it may have changed since the offer.
  const handle = await fsp.open(entry.localPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const current = await handle.stat();
    if (!current.isFile() || current.size !== entry.size) throw new Error(`File changed since it was selected: ${entry.path}`);
    let request;
    const responsePromise = new Promise((resolve, reject) => {
      request = http.request({ hostname: peer.address, port: peer.port, method: 'PUT', path: `/transfer/${id}/files/${index}`, agent: false,
        headers: { 'content-length': entry.size, 'x-hop-token': token, 'content-type': 'application/octet-stream' } }, response => {
        readJSON(response).then(result => response.statusCode >= 400 ? reject(new Error(result.error || `HTTP ${response.statusCode}`)) : resolve(result), reject);
      });
      request.setTimeout(IDLE_TIMEOUT, () => request.destroy(new Error('Transfer stalled')));
      request.on('error', reject);
    });
    const meter = new Transform({ transform(chunk, _, callback) { onBytes(chunk.length); callback(null, chunk); } });
    await Promise.all([pipeline(handle.createReadStream(), meter, request), responsePromise]);
  } finally { await handle.close().catch(() => {}); }
}

async function sendTransfer({ peer, device, paths, onProgress = () => {} }) {
  const entries = await buildManifest(paths);
  const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
  const id = randomUUID();
  const name = entries.filter(entry => !entry.path.includes('/')).map(entry => entry.path).join(', ');
  let bytes = 0;
  let lastProgress = 0;
  const progress = phase => onProgress({ id, direction: 'send', peerId: peer.id, peerName: peer.name, name, bytes, total: totalBytes, phase });
  progress('waiting');
  let offer;
  try {
    offer = await requestJSON(peer, 'POST', '/offer', { id, sender: validateDevice(device), entries: entries.map(({ localPath, ...entry }) => entry) });
    progress('accepted');
    for (let index = 0; index < entries.length; index++) {
      if (entries[index].type !== 'file') continue;
      await uploadFile(peer, id, offer.token, entries[index], index, count => {
        bytes += count;
        if (Date.now() - lastProgress >= 80) { progress('transferring'); lastProgress = Date.now(); }
      });
      progress('transferring');
    }
    const result = await requestJSON(peer, 'POST', `/transfer/${id}/complete`, {}, offer.token);
    progress('complete');
    return result;
  } catch (error) {
    if (offer) await requestJSON(peer, 'POST', `/transfer/${id}/cancel`, {}, offer.token, 2000).catch(() => {});
    onProgress({ id, direction: 'send', peerId: peer.id, peerName: peer.name, name, bytes, total: totalBytes, phase: 'failed', error: error.message });
    throw error;
  }
}

module.exports = { TransferServer, sendTransfer, buildManifest, validateRelativePath };
