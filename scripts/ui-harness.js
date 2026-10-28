const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomBytes } = require('node:crypto');
const { dialog } = require('electron');
const { TransferServer, sendTransfer } = require('../src/transfer');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = data => createHash('sha256').update(data).digest('hex');

async function run(ctx) {
  const { app, window, settings, receiver, state, publish, recordProgress, setPeers, log } = ctx;
  const directory = process.env.HOP_SMOKE_TEST;
  const checks = [];
  let outgoingReceiver;
  const js = code => window.webContents.executeJavaScript(code, true);
  async function until(check, description) {
    const start = Date.now();
    while (!await check()) {
      if (Date.now() - start > 8000) throw new Error('Timed out: ' + description);
      await delay(40);
    }
  }
  async function click(selector) { await js('document.querySelector(' + JSON.stringify(selector) + ').click()'); await delay(90); }
  async function screenshot(name) { await delay(300); await fs.writeFile(path.join(directory, name), (await window.webContents.capturePage()).toPNG()); }
  try {
    await until(() => !window.webContents.isLoading(), 'renderer load');
    await until(() => js("Boolean(window.hop && document.querySelector('#self-name')?.textContent !== 'This device')"), 'bridge state');
    assert.ok(window.isVisible());
    assert.equal(state().network.status, 'ready');
    await js("window.__smokeErrors=[];window.addEventListener('error',e=>window.__smokeErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__smokeErrors.push(String(e.reason)))");
    await until(() => js("document.querySelector('#help-dialog').open"), 'first launch guidance');
    await screenshot('first-launch.png');
    await click('#help-done');
    assert.equal(await js("document.querySelector('#help-dialog').open"), false);
    checks.push('Visible startup window, desktop bridge, network server, first-launch help');
    await js("window.hop.updateSettings({name:'My MacBook',theme:'light'})");
    await screenshot('empty-light.png');

    const peers = [
      { id: 'smoke-surface', name: 'Surface Laptop', platform: 'win', address: '127.0.0.1', port: 1 },
      { id: 'smoke-studio', name: 'Studio Mac', platform: 'mac', address: '127.0.0.1', port: 1 },
      { id: 'smoke-macbook', name: 'Alex’s MacBook', platform: 'mac', address: '127.0.0.1', port: 1 }
    ];
    setPeers(peers);
    await until(() => js("document.querySelectorAll('.peer').length===3"), 'radar peers');
    recordProgress({ id: 'visual-progress', direction: 'send', peerId: peers[0].id, peerName: peers[0].name, name: 'Weekend in Kyoto', bytes: 18500000, total: 32000000, phase: 'transferring' });
    recordProgress({ id: 'visual-complete', direction: 'receive', peerId: peers[1].id, peerName: peers[1].name, name: 'A little inspiration.pdf', bytes: 2400000, total: 2400000, phase: 'complete' });
    await screenshot('nearby-light.png');
    const wave = await js("document.documentElement.dataset.wave");
    assert.ok(['webgl', 'canvas'].includes(wave), 'Wave renderer: ' + wave);
    checks.push('Radar shows 3 fixtures, progress ring and activity; wave renderer=' + wave);
    await click('.theme-switch button[data-theme="dark"]');
    assert.equal(settings.data.theme, 'dark');
    assert.equal(await js("document.documentElement.dataset.theme"), 'dark');
    await screenshot('nearby-dark.png');
    await click('#settings-button');
    await js("document.querySelector('#device-name').value='Hop UI Test'; document.querySelector('#theme-select').value='auto'");
    await click('#save-settings');
    assert.equal(settings.data.name, 'Hop UI Test');
    assert.equal(settings.data.theme, 'auto');
    assert.equal(await js("document.querySelector('#settings-dialog').open"), false);
    checks.push('Light / Dark / Auto and device-name edits persist through IPC');
    await js("window.hop.updateSettings({theme:'light'})");

    const source = path.join(app.getPath('userData'), 'source');
    await fs.mkdir(path.join(source, 'Trip', 'empty'), { recursive: true });
    const data = randomBytes(3 * 1024 * 1024);
    await fs.writeFile(path.join(source, 'Trip', 'hello.txt'), 'Hello from the renderer integration test.');
    await fs.writeFile(path.join(source, 'large.bin'), data);
    const sender = { id: peers[0].id, name: peers[0].name, platform: 'win' };
    const receivingPeer = { ...state().device, address: '127.0.0.1', port: receiver.port };
    const sending = sendTransfer({ device: sender, peer: receivingPeer, paths: [path.join(source, 'Trip'), path.join(source, 'large.bin')] });
    await until(() => js("document.querySelectorAll('.offer-card').length===1"), 'incoming confirmation card');
    await screenshot('incoming-offer.png');
    await js("document.querySelector('.offer-card input').checked=true");
    await click('.offer-card .accept');
    await sending;
    assert.equal(hash(await fs.readFile(path.join(settings.data.downloadDir, 'large.bin'))), hash(data));
    assert.ok((await fs.stat(path.join(settings.data.downloadDir, 'Trip', 'empty'))).isDirectory());
    assert.ok(settings.isTrusted(sender.id));
    checks.push('Actual HTTP folder + 3 MiB accepted through renderer checkbox/button; SHA-256 identical; trust saved');

    window.close();
    assert.equal(window.isVisible(), false);
    await delay(80);
    assert.equal(await js('document.hidden'), true);
    await sendTransfer({ device: sender, peer: receivingPeer, paths: [path.join(source, 'large.bin')] });
    assert.equal(window.isVisible(), false);
    assert.equal(hash(await fs.readFile(path.join(settings.data.downloadDir, 'large (1).bin'))), hash(data));
    const untrusted = sendTransfer({ device: { ...sender, id: 'smoke-untrusted', name: 'New Neighbor' }, peer: receivingPeer, paths: [path.join(source, 'large.bin')] });
    const declined = assert.rejects(untrusted, /declin/i);
    await until(() => js("document.querySelectorAll('.offer-card').length===1"), 'background untrusted offer');
    assert.ok(window.isVisible());
    await click('.offer-card .decline');
    await declined;
    checks.push('Close hides window; trusted background receive renames collision; untrusted offer reopens; Decline works');

    outgoingReceiver = new TransferServer({ device: sender, downloadDir: path.join(app.getPath('userData'), 'remote'), onOffer: async () => true });
    peers[0].port = await outgoingReceiver.start({ host: '127.0.0.1' });
    setPeers(peers);
    const originalDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path.join(source, 'large.bin')] });
    try {
      await click('.peer[data-id="smoke-surface"]');
      assert.equal(await js("document.querySelector('#send-menu').hidden"), false);
      await click('#choose-files');
      await until(async () => { try { return hash(await fs.readFile(path.join(app.getPath('userData'), 'remote', 'large.bin'))) === hash(data); } catch { return false; } }, 'choose-and-send transfer');
    } finally { dialog.showOpenDialog = originalDialog; }
    checks.push('Click device → file picker → real outgoing HTTP stream (picker selection supplied by test)');

    await until(() => state().transfers.filter(item => item.id !== 'visual-progress').every(item => ['complete', 'failed', 'cancelled'].includes(item.phase)), 'outgoing completion');
    await delay(80);
    // Chromium supplies a disk-backed File, exercising webUtils.getPathForFile across the real preload bridge.
    await js("const input=document.createElement('input');input.type='file';input.id='smoke-disk-file';input.hidden=true;document.body.append(input)");
    window.webContents.debugger.attach('1.3');
    const { root } = await window.webContents.debugger.sendCommand('DOM.getDocument');
    const { nodeId } = await window.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#smoke-disk-file' });
    await window.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [path.join(source, 'large.bin')] });
    await js("window.hop.sendDrop('smoke-surface', [...document.querySelector('#smoke-disk-file').files])");
    window.webContents.debugger.detach();
    await until(async () => { try { return hash(await fs.readFile(path.join(app.getPath('userData'), 'remote', 'large (1).bin'))) === hash(data); } catch { return false; } }, 'drop bridge transfer');
    checks.push('Disk-backed File passes preload webUtils drop bridge; transferred hash matches');

    const changedDirectory = path.join(app.getPath('userData'), 'New destination');
    const originalDirectoryDialog = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [changedDirectory] });
    try { await click('#change-downloads'); } finally { dialog.showOpenDialog = originalDirectoryDialog; }
    assert.equal(settings.data.downloadDir, changedDirectory);
    await sendTransfer({ device: sender, peer: receivingPeer, paths: [path.join(source, 'large.bin')] });
    assert.equal(hash(await fs.readFile(path.join(changedDirectory, 'large.bin'))), hash(data));
    checks.push('Change destination through UI; next trusted transfer arrives at the new directory');

    await click('#settings-button');
    await click('#clear-trust');
    assert.equal(settings.isTrusted(sender.id), false);
    await click('#settings-dialog .dialog-close');
    publish('help', {});
    await until(() => js("document.querySelector('#help-dialog').open"), 'native help event');
    await click('#help-done');
    window.setSize(930, 700);
    await delay(250);
    const layout = await js("({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,footer:document.querySelector('footer').getBoundingClientRect().bottom})");
    assert.ok(layout.sw <= layout.w && layout.sh <= layout.h && layout.footer <= layout.h + 1, JSON.stringify(layout));
    await screenshot('minimum-window.png');
    checks.push('Clear trust; native help event; minimum-size layout has no document overflow');
    await js("document.querySelector('#aurora').dispatchEvent(new Event('webglcontextlost', {cancelable:true}))");
    await until(() => js("document.documentElement.dataset.wave==='canvas'"), 'Canvas fallback after context loss');
    await screenshot('canvas-fallback.png');
    checks.push('WebGL context-loss handler switches to functioning Canvas fallback');
    assert.deepEqual(await js('window.__smokeErrors'), []);
    await outgoingReceiver.close();
    await fs.writeFile(path.join(directory, 'ui-results.json'), JSON.stringify({ passed: true, platform: process.platform, electron: process.versions.electron, wave, checks }, null, 2));
    log.info('UI smoke tests passed', checks);
    app.quit();
  } catch (error) {
    log.error('UI smoke test failed', error);
    await screenshot('failure.png').catch(() => {});
    await fs.writeFile(path.join(directory, 'ui-results.json'), JSON.stringify({ passed: false, checks, error: error.stack }, null, 2));
    await outgoingReceiver?.close().catch(() => {});
    app.exit(1);
  }
}
module.exports = { run };
