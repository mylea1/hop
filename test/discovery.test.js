const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Discovery, broadcastAddresses } = require('../src/discovery');

test('broadcast computes every IPv4 subnet, deduplicates, ignores loopback and IPv6', () => {
  assert.deepEqual(broadcastAddresses({
    en0: [{ family: 'IPv4', address: '192.168.20.8', netmask: '255.255.255.0', internal: false }],
    eth0: [{ family: 'IPv4', address: '10.23.4.8', netmask: '255.255.0.0', internal: false }],
    dup: [{ family: 4, address: '192.168.20.9', netmask: '255.255.255.0', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', netmask: '255.0.0.0', internal: true }],
    v6: [{ family: 'IPv6', address: '::1', internal: false }]
  }), ['192.168.20.255', '10.23.255.255']);
});

test('valid beacons expire at 10 seconds; ignores self and malformed packets', () => {
  let now = 1000;
  const d = new Discovery({ device: { id: 'self', name: 'Mac', platform: 'mac', port: 1234 }, now: () => now });
  const packet = x => Buffer.from(JSON.stringify(x));
  const peer = { protocol: 'hop', version: 1, id: 'other', name: 'Studio', platform: 'win', port: 8888 };
  d.receive(packet(peer), { address: '192.168.1.3' });
  d.receive(packet({ ...peer, id: 'self' }), { address: '192.168.1.2' });
  d.receive(packet({ ...peer, id: 'bad', port: -1 }), { address: '192.168.1.4' });
  d.receive(Buffer.from('garbage'), { address: '192.168.1.5' });
  assert.equal(d.getPeers().length, 1);
  assert.equal(d.getPeers()[0].address, '192.168.1.3');
  now += 9999;
  assert.equal(d.getPeers().length, 1);
  now += 1;
  assert.equal(d.getPeers().length, 0);
});

test('two real UDP sockets discover each other in the same process', async t => {
  const a = new Discovery({ device: { id: 'a', name: 'A', platform: 'mac', port: 8001 }, port: 0, bindAddress: '127.0.0.1', targets: () => [] });
  const b = new Discovery({ device: { id: 'b', name: 'B', platform: 'win', port: 8002 }, port: 0, bindAddress: '127.0.0.1', targets: () => [] });
  t.after(async () => { await a.stop(); await b.stop(); });
  await a.start(); await b.start();
  a.targets = () => [{ address: '127.0.0.1', port: b.boundPort }];
  b.targets = () => [{ address: '127.0.0.1', port: a.boundPort }];
  const wait = d => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Discovery timeout')), 3000);
    d.once('peers', peers => { clearTimeout(timer); resolve(peers); });
  });
  const seen = Promise.all([wait(a), wait(b)]);
  a.announce(); b.announce();
  const [aa, bb] = await seen;
  assert.equal(aa[0].id, 'b'); assert.equal(bb[0].id, 'a');
});
