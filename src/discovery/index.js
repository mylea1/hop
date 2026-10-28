const dgram = require('node:dgram');
const os = require('node:os');
const net = require('node:net');
const { EventEmitter } = require('node:events');

const PORT = 47800;
const INTERVAL = 1500;
const TTL = 10000;

function broadcastAddresses(interfaces = os.networkInterfaces()) {
  const result = new Set();
  for (const records of Object.values(interfaces)) {
    for (const nic of records || []) {
      if (nic.internal || !['IPv4', 4].includes(nic.family)) continue;
      if (!net.isIPv4(nic.address) || !net.isIPv4(nic.netmask)) continue;
      const address = nic.address.split('.').map(Number);
      const mask = nic.netmask.split('.').map(Number);
      // /32 point-to-point interfaces do not have a broadcast address.
      if (mask.every(n => n === 255)) continue;
      result.add(address.map((n, i) => (n | (~mask[i] & 255))).join('.'));
    }
  }
  return [...result];
}

class Discovery extends EventEmitter {
  constructor({ device, port = PORT, bindAddress = '0.0.0.0', targets, now = Date.now, interval = INTERVAL, ttl = TTL }) {
    super();
    this.device = device;
    this.port = port;
    this.bindAddress = bindAddress;
    this.targets = targets || (() => broadcastAddresses().map(address => ({ address, port: this.port })));
    this.now = now;
    this.interval = interval;
    this.ttl = ttl;
    this.peers = new Map();
  }

  async start() {
    if (this.socket) return this.boundPort;
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = socket;
    socket.on('message', (msg, rinfo) => this.receive(msg, rinfo));
    socket.on('error', error => this.emit('warning', error));
    try {
      await new Promise((resolve, reject) => {
        const failed = error => { socket.off('listening', ready); reject(error); };
        const ready = () => { socket.off('error', failed); resolve(); };
        socket.once('error', failed);
        socket.once('listening', ready);
        socket.bind(this.port, this.bindAddress);
      });
      socket.setBroadcast(true);
      this.boundPort = socket.address().port;
      this.announce();
      this.beaconTimer = setInterval(() => this.announce(), this.interval);
      this.expiryTimer = setInterval(() => this.prune(), 1000);
      this.beaconTimer.unref();
      this.expiryTimer.unref();
      return this.boundPort;
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  announce() {
    if (!this.socket) return;
    const { id, name, platform, port } = this.device;
    const beacon = Buffer.from(JSON.stringify({ protocol: 'hop', version: 1, id, name, platform, port }));
    for (const target of this.targets()) {
      this.socket.send(beacon, target.port, target.address, error => {
        if (error) this.emit('warning', error);
      });
    }
  }

  receive(buffer, rinfo) {
    if (buffer.length > 2048) return;
    let beacon;
    try { beacon = JSON.parse(buffer.toString('utf8')); } catch { return; }
    if (!beacon || beacon.protocol !== 'hop' || beacon.version !== 1 || beacon.id === this.device.id) return;
    if (typeof beacon.id !== 'string' || !beacon.id.length || beacon.id.length > 128) return;
    if (typeof beacon.name !== 'string' || !beacon.name.trim() || beacon.name.length > 128) return;
    if (!['mac', 'win'].includes(beacon.platform) || !Number.isInteger(beacon.port) || beacon.port < 1 || beacon.port > 65535) return;
    if (!net.isIPv4(rinfo.address)) return;
    const previous = this.peers.get(beacon.id);
    // On multiple interfaces the most recently observed route is preferred.
    const peer = { id: beacon.id, name: beacon.name, platform: beacon.platform, port: beacon.port, address: rinfo.address, lastSeen: this.now() };
    this.peers.set(peer.id, peer);
    if (!previous || ['name', 'platform', 'port', 'address'].some(key => previous[key] !== peer[key])) this.emit('peers', this.getPeers());
  }

  prune() {
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (this.now() - peer.lastSeen >= this.ttl) { this.peers.delete(id); changed = true; }
    }
    if (changed) this.emit('peers', [...this.peers.values()]);
  }

  getPeers() {
    return [...this.peers.values()].filter(peer => this.now() - peer.lastSeen < this.ttl);
  }

  async stop() {
    clearInterval(this.beaconTimer);
    clearInterval(this.expiryTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) await new Promise(resolve => { try { socket.close(resolve); } catch { resolve(); } });
  }
}

module.exports = { Discovery, broadcastAddresses, PORT, INTERVAL, TTL };
