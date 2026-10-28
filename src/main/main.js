const { app, BrowserWindow, ipcMain, dialog, shell, Menu, Tray, nativeImage, nativeTheme, Notification, screen } = require('electron');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { Discovery, broadcastAddresses } = require('../discovery');
const { TransferServer, sendTransfer } = require('../transfer');
const { Settings } = require('./settings');
const { createLogger } = require('./logger');

app.setName('Hop');
if (process.env.HOP_PROFILE_DIR) app.setPath('userData', path.resolve(process.env.HOP_PROFILE_DIR));
const log = createLogger(path.join(app.getPath('userData'), 'logs'));
let window, tray, settings, device, discovery, receiver;
let quitting = false;
let shutdownComplete = false;
let rendererReady = false;
let network = { status: 'starting', port: null };
const offers = new Map();
const transfers = new Map();
const activeSends = new Set();
let testPeers = null;

log.info('Hop starting', { electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch, packaged: app.isPackaged, profile: app.getPath('userData') });

function publish(type, data) {
  if (window && !window.isDestroyed() && rendererReady) window.webContents.send('hop:event', { type, data });
}

function state() {
  return { version: app.getVersion(), platform: process.platform, device, settings: settings?.data, network,
    peers: testPeers || discovery?.getPeers() || [], transfers: [...transfers.values()].reverse(),
    offers: [...offers.values()].map(({ offer }) => offer), logPath: log.file };
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  const bounds = window.getBounds();
  const visible = screen.getAllDisplays().some(({ workArea }) => bounds.x < workArea.x + workArea.width && bounds.x + bounds.width > workArea.x && bounds.y < workArea.y + workArea.height && bounds.y + bounds.height > workArea.y);
  if (!visible) window.center();
  window.show();
  window.focus();
  if (process.platform === 'darwin') app.dock.show().catch(() => {});
}

function notify(title, body) {
  if (process.env.HOP_SMOKE_TEST || !Notification.isSupported()) return;
  const notification = new Notification({ title, body, silent: true });
  notification.on('click', showWindow);
  notification.show();
}

function warning(error) {
  const message = error?.message || String(error);
  log.warn(message);
  publish('warning', { message });
}

function recordProgress(event) {
  transfers.set(event.id, { ...transfers.get(event.id), ...event, updatedAt: Date.now() });
  if (transfers.size > 80) {
    for (const [id, item] of transfers) {
      if (['complete', 'failed', 'cancelled'].includes(item.phase)) { transfers.delete(id); break; }
    }
  }
  publish('progress', transfers.get(event.id));
}

function offerClosed(id) {
  offers.delete(id);
  publish('offer-closed', { id });
}

async function acceptOffer(offer) {
  log.info('Incoming offer', { id: offer.id, peer: offer.sender.name, entries: offer.entries.length, bytes: offer.totalBytes });
  if (settings.isTrusted(offer.sender.id)) return true;
  const decision = new Promise(resolve => offers.set(offer.id, { offer, resolve }));
  showWindow();
  publish('offer', offer);
  notify(`${offer.sender.name} wants to share`, 'Open Hop to accept or decline.');
  return decision;
}

function setTheme(theme) { nativeTheme.themeSource = theme === 'auto' ? 'system' : theme; }

async function startNetwork() {
  try {
    receiver = new TransferServer({ device, downloadDir: settings.data.downloadDir, onOffer: acceptOffer });
    receiver.on('progress', recordProgress);
    receiver.on('warning', warning);
    receiver.on('offer-expired', ({ id, reason }) => {
      offers.get(id)?.resolve(false);
      offerClosed(id);
      warning(new Error(reason));
    });
    receiver.on('complete', event => {
      recordProgress(event);
      publish('complete', event);
      log.info('Received transfer', { id: event.id, bytes: event.totalBytes });
      notify('A little closer.', `Received ${event.name} from ${event.peerName}.`);
    });
    device.port = await receiver.start();
    discovery = new Discovery({ device });
    discovery.on('peers', peers => publish('peers', peers));
    discovery.on('warning', warning);
    await discovery.start();
    network = { status: 'ready', port: device.port, addresses: broadcastAddresses() };
    log.info('Network listening', { udp: 47800, http: device.port, broadcasts: network.addresses });
  } catch (error) {
    network = { status: 'error', port: device?.port, error: error.message };
    log.error('Network startup failed', error);
    showWindow();
  }
  publish('state', state());
}

async function beginSend(peerId, paths) {
  const peer = (testPeers || discovery?.getPeers() || []).find(item => item.id === peerId);
  if (!peer) throw new Error('This device is no longer nearby. Wait for it to reconnect.');
  if (!Array.isArray(paths) || !paths.length || paths.some(value => typeof value !== 'string' || !path.isAbsolute(value))) throw new Error('Choose files or folders from this computer.');
  if (activeSends.has(peerId)) throw new Error('A transfer to this device is already in progress.');
  activeSends.add(peerId);
  const task = sendTransfer({ peer, device, paths, onProgress: recordProgress });
  task.then(result => {
    publish('complete', { ...transfers.get(result.id), ...result });
    log.info('Sent transfer', { id: result.id, peer: peer.name, bytes: result.totalBytes });
  }).catch(warning).finally(() => activeSends.delete(peerId));
  return { started: true };
}

function registerIPC() {
  ipcMain.handle('hop:state', () => state());
  ipcMain.handle('hop:send', (_, id, paths) => beginSend(id, paths));
  ipcMain.handle('hop:choose-send', async (_, id, kind) => {
    const result = await dialog.showOpenDialog(window, { title: kind === 'folder' ? 'Choose a folder to share' : 'Choose files to share', buttonLabel: 'Send with Hop', properties: kind === 'folder' ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'] });
    return result.canceled ? { cancelled: true } : beginSend(id, result.filePaths);
  });
  ipcMain.handle('hop:choose-directory', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Save incoming files to', defaultPath: settings.data.downloadDir, properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return settings.data;
    await fs.mkdir(result.filePaths[0], { recursive: true });
    settings.update({ downloadDir: result.filePaths[0] });
    receiver?.setDownloadDir(settings.data.downloadDir);
    publish('state', state());
    return settings.data;
  });
  ipcMain.handle('hop:settings', (_, values) => {
    settings.update({ name: values?.name, theme: values?.theme });
    device.name = settings.data.name;
    if (receiver) receiver.device.name = device.name;
    setTheme(settings.data.theme);
    discovery?.announce();
    publish('state', state());
    return settings.data;
  });
  ipcMain.handle('hop:clear-trust', () => { settings.clearTrust(); publish('state', state()); return settings.data; });
  ipcMain.handle('hop:respond', (_, id, accept, always) => {
    const pending = offers.get(id);
    if (!pending) return { expired: true };
    if (accept === true && always === true) settings.trust(pending.offer.sender);
    pending.resolve(accept === true);
    offerClosed(id);
    publish('state', state());
    return { accepted: accept === true };
  });
  ipcMain.handle('hop:open-downloads', async () => {
    await fs.mkdir(settings.data.downloadDir, { recursive: true });
    const error = await shell.openPath(settings.data.downloadDir);
    if (error) throw new Error(error);
  });
  ipcMain.handle('hop:open-logs', () => shell.showItemInFolder(log.file));
  ipcMain.handle('hop:window', (_, action) => {
    if (action === 'minimize') window.minimize();
    if (action === 'close') window.close();
    if (action === 'quit') app.quit();
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1160, height: 790, minWidth: 930, minHeight: 700, show: true, center: true,
    title: 'Hop', backgroundColor: '#faf9f6', icon: path.join(__dirname, '../../assets/icon.png'),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 24 }, vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00ffffff' } : {}),
    ...(process.platform === 'win32' ? { titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#777777', height: 48 }, ...(Number(os.release().split('.')[2]) >= 22621 ? { backgroundMaterial: 'acrylic', backgroundColor: '#00ffffff' } : {}) } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); log.info('Window hidden; receiving continues'); } });
  window.webContents.on('did-finish-load', () => {
    rendererReady = true;
    publish('state', state());
    showWindow();
    log.info('Renderer loaded; window visible', { visible: window.isVisible(), bounds: window.getBounds() });
  });
  window.webContents.on('did-fail-load', (_, code, description) => {
    log.error('Renderer failed to load', { code, description });
    showWindow();
    dialog.showErrorBox('Hop could not load its window', `${description}\n\nStartup log: ${log.file}`);
  });
  window.webContents.on('render-process-gone', (_, details) => {
    rendererReady = false;
    log.error('Renderer process ended', details);
    showWindow();
    dialog.showMessageBox(window, { type: 'error', title: 'Hop needs a fresh start', message: 'The window stopped responding.', detail: `The network remains active. Startup log: ${log.file}`, buttons: ['Reload window', 'Quit Hop'] }).then(({ response }) => response === 0 ? window.reload() : app.quit());
  });
  window.loadFile(path.join(__dirname, '../renderer/index.html')).catch(error => log.error('loadFile failed', error));
  // Show immediately and again once after startup; an intentional close still hides it.
  showWindow();
}

function createMenus() {
  const template = [
    ...(process.platform === 'darwin' ? [{ label: 'Hop', submenu: [{ role: 'about' }, { type: 'separator' }, { label: 'Show Hop', click: showWindow }, { role: 'hide' }, { type: 'separator' }, { role: 'quit' }] }] : []),
    { label: 'File', submenu: [{ label: 'Show Hop', click: showWindow }, { label: 'Open received files', click: () => shell.openPath(settings.data.downloadDir) }, { type: 'separator' }, { label: 'Quit Hop', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
    { role: 'editMenu' }, { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'toggleDevTools' }] },
    { label: 'Help', submenu: [{ label: 'Connection help', click: () => { showWindow(); publish('help', {}); } }, { label: 'Show startup log', click: () => shell.showItemInFolder(log.file) }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  if (process.platform === 'win32') {
    const icon = nativeImage.createFromPath(path.join(__dirname, '../../assets/icon.png')).resize({ width: 32, height: 32 });
    tray = new Tray(icon);
    tray.setToolTip('Hop · Ready to receive');
    tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Hop', click: showWindow }, { label: 'Open received files', click: () => shell.openPath(settings.data.downloadDir) }, { type: 'separator' }, { label: 'Quit Hop', click: () => app.quit() }]));
    tray.on('double-click', showWindow);
    tray.on('click', showWindow);
  }
}

process.on('uncaughtException', error => { log.error('Uncaught exception', error); warning(error); showWindow(); });
process.on('unhandledRejection', error => { log.error('Unhandled rejection', error); warning(error); showWindow(); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
else {
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {});
  app.on('before-quit', event => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    log.info('Hop shutting down');
    for (const { resolve } of offers.values()) resolve(false);
    offers.clear();
    Promise.allSettled([discovery?.stop(), receiver?.close()]).then(results => {
      for (const result of results) if (result.status === 'rejected') log.error('Shutdown cleanup', result.reason);
      tray?.destroy();
      shutdownComplete = true;
      app.quit();
    });
  });
  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.hop.desktop');
    settings = new Settings(path.join(app.getPath('userData'), 'settings.json'), { downloadDir: process.env.HOP_SMOKE_TEST && !app.isPackaged ? path.join(app.getPath('userData'), 'Downloads', 'Hop') : path.join(app.getPath('downloads'), 'Hop') });
    device = { id: settings.data.id, name: settings.data.name, platform: process.platform === 'win32' ? 'win' : 'mac' };
    setTheme(settings.data.theme);
    registerIPC();
    createWindow();
    createMenus();
    await startNetwork();
    if (process.env.HOP_SMOKE_TEST && !app.isPackaged) {
      await require('../../scripts/ui-harness').run({ app, window, settings, receiver, state, publish, showWindow, acceptOffer, recordProgress,
        setPeers: peers => { testPeers = peers; publish('peers', peers); }, log });
    }
  }).catch(error => {
    log.error('Fatal startup error', error);
    showWindow();
    dialog.showErrorBox('Hop could not start', `${error.message}\n\nStartup log: ${log.file}`);
  });
}
