'use strict';

(() => {
  const $ = selector => document.querySelector(selector);
  const iconPaths = {
    sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    moon: '<path d="M19.7 15.3A8.2 8.2 0 0 1 8.7 4.2 8.4 8.4 0 1 0 19.7 15.3Z"/>',
    auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
    settings: '<path d="m9.5 3-.7 2.1-2 .9-2-.5L2.5 9l1.5 1.6v2.8L2.5 15l2.3 3.5 2-.5 2 .9.7 2.1h5l.7-2.1 2-.9 2 .5 2.3-3.5-1.5-1.6v-2.8L21.5 9l-2.3-3.5-2 .5-2-.9-.7-2.1Z"/><circle cx="12" cy="12" r="3"/>',
    minus: '<path d="M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>', cursor: '<path d="m5 3 14 9-7 1-3 7Z"/>',
    file: '<path d="M6 3h8l4 4v14H6Z"/><path d="M14 3v5h4M9 12h6m-6 4h4"/>',
    folder: '<path d="M3 7V5h7l2 3h9v12H3Z"/><path d="M3 8h9"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 16 5-4 4 3 4-5 5 6"/>',
    link: '<path d="m10 14 4-4m-6 6-1.5 1.5a3.5 3.5 0 0 1-5-5L6 8a3.5 3.5 0 0 1 5 0m2 8a3.5 3.5 0 0 0 5 0l4.5-4.5a3.5 3.5 0 0 0-5-5L16 8" transform="translate(0 0) scale(.92)"/>',
    direct: '<path d="M3 8h15l-4-4m7 12H6l4 4M3 8v8m18-8v8"/>',
    spark: '<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2Z"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2 1-1.2 2.3M12 17v.1"/>',
    wifi: '<path d="M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0m-11 4a6 6 0 0 1 8 0M12 20h.01"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    computer: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M9 21h6m-3-4v4"/>',
    mac: '<path fill="currentColor" stroke="none" d="M16.8 12.6c0-2.2 1.8-3.3 1.9-3.4-1.1-1.6-2.8-1.8-3.4-1.8-1.5-.2-2.9.9-3.7.9-.7 0-1.9-.9-3.1-.9-1.6 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.3 2.9 2.3 1.2-.1 1.6-.7 3.1-.7s1.9.7 3.2.7c1.3 0 2.1-1.2 2.8-2.3.9-1.3 1.3-2.5 1.3-2.6-.1 0-2.4-.9-2.4-3.8ZM14.4 5.9c.6-.8 1.1-1.8 1-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.2 1.8-1 2.8 1 .1 2.1-.5 2.7-1.3Z"/>',
    windows: '<path fill="currentColor" stroke="none" d="M3 4h8v8H3Zm10 0h8v8h-8ZM3 14h8v8H3Zm10 0h8v8h-8Z" transform="translate(0 -1)"/>'
  };
  function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`; }
  function populateIcons(root = document) { for (const element of root.querySelectorAll('[data-icon]')) element.innerHTML = icon(element.dataset.icon); }
  populateIcons();

  const api = window.hop;
  let state = { device: { name: 'This device', platform: 'mac' }, peers: [], settings: { theme: 'auto', trusted: [] }, network: {}, transfers: [], offers: [] };
  let chosenPeer;
  let toastTimer;
  const peers = new Map();
  const transfers = new Map();
  const offers = new Map();
  const animated = new Set();
  const media = matchMedia('(prefers-color-scheme: dark)');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const formatBytes = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const platformName = platform => platform === 'mac' ? 'Mac' : 'Windows PC';

  function notify(message) {
    $('#toast').textContent = message;
    $('#toast').classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 5200);
  }
  async function action(fn) {
    try { return await fn(); }
    catch (error) { notify(error.message || 'That didn’t go through. Please try again.'); return null; }
  }
  function applyTheme() {
    const preference = state.settings.theme || 'auto';
    document.documentElement.dataset.theme = preference === 'auto' ? (media.matches ? 'dark' : 'light') : preference;
    for (const button of document.querySelectorAll('.theme-switch button')) {
      button.classList.toggle('active', button.dataset.theme === preference);
      button.setAttribute('aria-pressed', String(button.dataset.theme === preference));
    }
    $('#theme-select').value = preference;
  }
  media.addEventListener('change', applyTheme);
  function renderState(next) {
    state = { ...state, ...next, settings: { ...state.settings, ...next.settings } };
    document.body.classList.toggle('platform-darwin', state.platform === 'darwin');
    document.body.classList.toggle('platform-win32', state.platform === 'win32');
    $('#self-name').textContent = state.device.name;
    $('#self-icon').innerHTML = icon('computer');
    const networkError = state.network.error;
    document.body.classList.toggle('network-error', Boolean(networkError));
    $('#network-label').textContent = networkError ? 'Connection needs a moment' : state.network.port ? 'Visible on your network' : 'Getting ready';
    $('#network-diagnostic').textContent = networkError ? `Network: ${networkError}` : `Discovery: UDP 47800  ·  Transfer: TCP ${state.network.port || 'starting'}  ·  ${state.device.name}`;
    const downloadPath = state.settings.downloadDir || 'Downloads/Hop';
    $('#download-path').textContent = downloadPath.replace(/^.*[/\\]Downloads[/\\]/, 'Downloads / ').replaceAll('\\', ' / ');
    $('#open-downloads').title = downloadPath;
    $('#version-label').textContent = `Hop ${state.version || '1.0.0'}`;
    const trustedCount = Array.isArray(state.settings.trusted) ? state.settings.trusted.length : Object.keys(state.settings.trusted || {}).length;
    $('#trusted-summary').textContent = trustedCount ? `${trustedCount} device${trustedCount === 1 ? '' : 's'} can send without asking.` : 'No trusted devices yet.';
    $('#clear-trust').disabled = !trustedCount;
    applyTheme();
    if (next.peers) renderPeers(next.peers);
    if (next.transfers) { transfers.clear(); next.transfers.forEach(transfer => transfers.set(transfer.id, transfer)); renderTransfers(); }
    if (next.offers) { offers.clear(); next.offers.forEach(offer => offers.set(offer.id, offer)); renderOffers(); }
    updateEmpty();
  }

  function renderPeers(list) {
    peers.clear();
    list.forEach(peer => peers.set(peer.id, peer));
    const container = $('#peers');
    for (const element of [...container.children]) if (!peers.has(element.dataset.id)) element.remove();
    list.forEach((peer, index) => {
      let element = [...container.children].find(node => node.dataset.id === peer.id);
      if (!element) {
        element = document.createElement('button');
        element.className = 'peer';
        element.dataset.id = peer.id;
        element.innerHTML = '<span class="peer-face"></span><span class="peer-label"></span><span class="peer-meta"></span>';
        element.querySelector('.peer-face').innerHTML = icon(peer.platform === 'mac' ? 'mac' : 'windows') + '<svg class="progress-ring" viewBox="0 0 80 80" aria-hidden="true" hidden><circle cx="40" cy="40" r="36"/></svg>';
        element.addEventListener('click', event => showSendMenu(peer.id, event.currentTarget));
        element.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; element.classList.add('drag-over'); });
        element.addEventListener('dragleave', event => { if (!element.contains(event.relatedTarget)) element.classList.remove('drag-over'); });
        element.addEventListener('drop', event => {
          event.preventDefault(); event.stopPropagation(); element.classList.remove('drag-over');
          const files = [...event.dataTransfer.files];
          if (!files.length) return notify('Drop a file or folder from Finder or File Explorer.');
          action(() => api.sendDrop(peer.id, files));
        });
        container.appendChild(element);
      }
      element.querySelector('.peer-label').textContent = peer.name;
      element.querySelector('.peer-meta').textContent = platformName(peer.platform);
      element.setAttribute('aria-label', `Send files to ${peer.name}, ${platformName(peer.platform)}`);
      const angles = [-38, 142, -142, 38, -90, 90];
      const angle = (list.length <= 6 ? angles[index] : -90 + 360 * index / list.length) * Math.PI / 180;
      const radiusX = list.length > 6 ? 39 : 35;
      const radiusY = list.length > 6 ? 31 : 28;
      element.style.left = `${50 + Math.cos(angle) * radiusX}%`;
      element.style.top = `${48 + Math.sin(angle) * radiusY}%`;
    });
    $('#nearby-count').textContent = list.length ? `${list.length} nearby` : 'Searching';
    $('#radar').classList.toggle('has-peers', Boolean(list.length));
    updateRings();
  }

  function showSendMenu(id, anchor) {
    chosenPeer = id;
    const menu = $('#send-menu');
    $('#send-target').textContent = `Send to ${peers.get(id)?.name || 'device'}`;
    menu.hidden = false;
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(innerWidth - menu.offsetWidth - 16, Math.max(16, rect.left + rect.width / 2 - menu.offsetWidth / 2))}px`;
    menu.style.top = `${Math.min(innerHeight - menu.offsetHeight - 20, rect.bottom + 10)}px`;
    $('#choose-files').focus();
  }
  document.addEventListener('click', event => { if (!event.target.closest('#send-menu,.peer')) $('#send-menu').hidden = true; });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $('#send-menu').hidden = true; });
  for (const kind of ['files', 'folder']) $(`#choose-${kind}`).addEventListener('click', () => {
    $('#send-menu').hidden = true;
    action(() => api.chooseAndSend(chosenPeer, kind));
  });

  function flyFiles(transfer) {
    if (animated.has(transfer.id) || reducedMotion.matches) return;
    animated.add(transfer.id);
    const radar = $('#radar').getBoundingClientRect();
    const peer = [...$('#peers').children].find(element => element.dataset.id === transfer.peerId);
    const peerRect = peer?.getBoundingClientRect();
    const self = { x: radar.width * .5, y: radar.height * .48 - 20 };
    const other = peerRect ? { x: peerRect.left - radar.left + peerRect.width / 2, y: peerRect.top - radar.top + 30 } : { x: radar.width * .8, y: radar.height * .3 };
    const from = transfer.direction === 'send' ? self : other;
    const to = transfer.direction === 'send' ? other : self;
    for (let i = 0; i < 3; i++) {
      const chip = document.createElement('div');
      chip.className = 'file-chip';
      chip.innerHTML = icon('file') + '<span></span>';
      chip.lastChild.textContent = i === 0 ? transfer.name.split(', ')[0] : '↗';
      $('#flight-layer').appendChild(chip);
      const frames = [];
      for (let step = 0; step <= 20; step++) {
        const t = step / 20;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t - Math.sin(Math.PI * t) * 75;
        frames.push({ transform: `translate(${x - 35}px,${y - 20}px) rotate(${Math.sin(Math.PI * t) * -12}deg) scale(${.7 + Math.sin(Math.PI * t) * .3})`, opacity: t === 0 || t === 1 ? 0 : Math.min(1, t * 6, (1 - t) * 7) });
      }
      chip.animate(frames, { duration: 1100, delay: i * 150, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both' }).finished.then(() => chip.remove());
    }
    window.hopWave?.pulse();
  }

  function updateRings() {
    for (const peer of $('#peers').children) {
      const transfer = [...transfers.values()].reverse().find(t => t.peerId === peer.dataset.id && !['complete', 'failed', 'cancelled'].includes(t.phase));
      const ring = peer.querySelector('.progress-ring');
      ring.style.display = transfer ? 'block' : 'none';
      ring.classList.toggle('waiting', transfer?.phase === 'waiting');
      ring.querySelector('circle').style.strokeDashoffset = transfer ? 226.2 * (1 - Math.min(1, transfer.total ? transfer.bytes / transfer.total : 0)) : 226.2;
      peer.querySelector('.peer-meta').textContent = transfer ? (transfer.phase === 'waiting' ? 'Waiting for accept…' : `${Math.round(transfer.total ? transfer.bytes / transfer.total * 100 : 0)}% · ${transfer.direction === 'send' ? 'Sending' : 'Receiving'}`) : platformName(peers.get(peer.dataset.id)?.platform);
    }
  }

  function renderTransfers() {
    const container = $('#transfers');
    const ordered = [...transfers.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 40);
    const visible = new Set(ordered.map(transfer => transfer.id));
    for (const card of [...container.children]) if (!visible.has(card.dataset.id)) card.remove();
    ordered.forEach((transfer, index) => {
      let card = [...container.children].find(element => element.dataset.id === transfer.id);
      if (!card) {
        card = document.createElement('article');
        card.className = 'transfer-card';
        card.dataset.id = transfer.id;
        card.innerHTML = '<div class="transfer-top"><span class="transfer-file"></span><div class="transfer-copy"><div class="transfer-title"></div><div class="transfer-subtitle"></div></div><span class="transfer-state"></span></div><div class="transfer-progress"><span></span></div><div class="transfer-details"><span></span><span></span></div>';
        card.querySelector('.transfer-file').innerHTML = icon('file');
      }
      card.querySelector('.transfer-title').textContent = transfer.name || 'Shared files';
      card.querySelector('.transfer-title').title = transfer.name || 'Shared files';
      const done = transfer.phase === 'complete';
      const failed = ['failed', 'cancelled'].includes(transfer.phase);
      card.querySelector('.transfer-subtitle').textContent = `${transfer.direction === 'send' ? 'To' : 'From'} ${transfer.peerName || 'Nearby device'}`;
      card.querySelector('.transfer-state').innerHTML = done ? icon('check') : failed ? icon('close') : '';
      card.querySelector('.transfer-progress').hidden = done || failed;
      card.querySelector('.transfer-progress span').style.width = `${Math.max(0, Math.min(100, transfer.total ? transfer.bytes / transfer.total * 100 : 0))}%`;
      const status = done ? (transfer.direction === 'send' ? 'Delivered' : 'Saved to your folder') : failed ? 'Didn’t arrive' : transfer.phase === 'waiting' ? 'Waiting for acceptance' : transfer.direction === 'send' ? 'Sending' : 'Receiving';
      card.querySelector('.transfer-details span').textContent = status;
      card.querySelector('.transfer-details span:last-child').textContent = done ? formatBytes(transfer.total || 0) : `${formatBytes(transfer.bytes || 0)} / ${formatBytes(transfer.total || 0)}`;
      if (failed && transfer.error) {
        let error = card.querySelector('.transfer-error');
        if (!error) { error = document.createElement('p'); error.className = 'transfer-error'; card.appendChild(error); }
        error.textContent = transfer.error;
      } else card.querySelector('.transfer-error')?.remove();
      if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null);
    });
    updateRings(); updateEmpty();
  }

  function renderOffers() {
    const container = $('#offers');
    for (const element of [...container.children]) if (!offers.has(element.dataset.id)) element.remove();
    for (const offer of offers.values()) {
      if ([...container.children].some(element => element.dataset.id === offer.id)) continue;
      const card = document.createElement('article');
      card.className = 'offer-card'; card.dataset.id = offer.id;
      card.innerHTML = '<span class="offer-label">SOMETHING FOR YOU</span><h3></h3><p></p><div class="offer-files"></div><label class="offer-trust"><input type="checkbox"><span>Always accept from this device</span></label><div class="offer-actions"><button class="decline">Decline</button><button class="accept">Accept <span aria-hidden="true">↙</span></button></div>';
      card.querySelector('h3').textContent = `${offer.sender.name} wants to share.`;
      const roots = offer.entries.filter(entry => !entry.path.includes('/'));
      card.querySelector('p').textContent = `${roots.length} item${roots.length === 1 ? '' : 's'} · ${formatBytes(offer.totalBytes)}`;
      for (const entry of roots.slice(0, 3)) { const name = document.createElement('div'); name.textContent = entry.path; card.querySelector('.offer-files').appendChild(name); }
      if (roots.length > 3) { const more = document.createElement('div'); more.textContent = `+ ${roots.length - 3} more`; card.querySelector('.offer-files').appendChild(more); }
      for (const accept of [false, true]) card.querySelector(accept ? '.accept' : '.decline').addEventListener('click', async () => {
        for (const button of card.querySelectorAll('button')) button.disabled = true;
        try { await api.respondOffer(offer.id, accept, accept && card.querySelector('input').checked); offers.delete(offer.id); renderOffers(); }
        catch (error) { notify(error.message); for (const button of card.querySelectorAll('button')) button.disabled = false; }
      });
      container.appendChild(card);
    }
    updateEmpty();
  }
  function updateEmpty() {
    $('#activity-empty').hidden = Boolean(offers.size || transfers.size);
    $('#activity-count').textContent = String(transfers.size);
  }
  function receiveEvent(event) {
    const { type, data } = event;
    if (type === 'state') renderState(data);
    else if (type === 'peers') renderPeers(Array.isArray(data) ? data : data.peers || []);
    else if (type === 'offer') { offers.set(data.id, data); renderOffers(); window.hopWave?.pulse(); }
    else if (type === 'offer-closed') { offers.delete(data.id); renderOffers(); }
    else if (type === 'progress' || type === 'complete') {
      const transfer = { ...transfers.get(data.id), ...data, ...(type === 'complete' ? { phase: 'complete' } : {}) };
      transfers.set(data.id, transfer);
      if (['accepted', 'transferring'].includes(transfer.phase)) flyFiles(transfer);
      renderTransfers();
    } else if (type === 'warning') notify(data.message);
    else if (type === 'help' && !$('#help-dialog').open) $('#help-dialog').showModal();
  }

  for (const button of document.querySelectorAll('.theme-switch button')) button.addEventListener('click', () => action(async () => {
    state.settings.theme = button.dataset.theme; applyTheme(); await api.updateSettings({ theme: button.dataset.theme });
  }));
  $('#replay-wave').addEventListener('click', () => window.hopWave?.pulse());
  $('#settings-button').addEventListener('click', () => { $('#device-name').value = state.device.name; $('#settings-dialog').showModal(); });
  for (const button of document.querySelectorAll('.dialog-close')) button.addEventListener('click', () => button.closest('dialog').close());
  $('#save-settings').addEventListener('click', () => action(async () => {
    const name = $('#device-name').value.trim();
    if (!name) { $('#device-name').focus(); return notify('Give this device a name first.'); }
    const saved = await api.updateSettings({ name, theme: $('#theme-select').value });
    state.device.name = saved.name; state.settings = { ...state.settings, ...saved }; renderState(state);
    $('#settings-dialog').close();
  }));
  $('#clear-trust').addEventListener('click', () => action(async () => { await api.clearTrust(); state.settings.trusted = []; renderState(state); notify('All devices will ask before sending again.'); }));
  for (const id of ['open-logs', 'help-logs']) $(`#${id}`).addEventListener('click', () => action(() => api.openLogs()));
  $('#open-downloads').addEventListener('click', () => action(() => api.openDownloads()));
  $('#change-downloads').addEventListener('click', () => action(() => api.chooseDownloadDir()));
  for (const id of ['connection-help', 'help-button']) $(`#${id}`).addEventListener('click', () => $('#help-dialog').showModal());
  $('#help-done').addEventListener('click', () => { localStorage.setItem('hop-welcomed', 'yes'); $('#help-dialog').close(); });
  $('#help-dialog').addEventListener('close', () => { localStorage.setItem('hop-welcomed', 'yes'); window.hopWave?.pulse(); });
  $('#minimize-button').addEventListener('click', () => api.windowAction('minimize'));
  $('#close-button').addEventListener('click', () => api.windowAction('close'));
  $('#quit-button').addEventListener('click', () => api.windowAction('quit'));
  document.addEventListener('dragover', event => event.preventDefault());
  document.addEventListener('drop', event => event.preventDefault());

  if (!api) {
    renderState({ network: { error: 'The desktop bridge is unavailable. Launch Hop with npm start.' } });
    notify('Launch Hop as a desktop app to discover nearby devices.');
    return;
  }
  api.onEvent(receiveEvent);
  action(async () => {
    renderState(await api.getState());
    if (!localStorage.getItem('hop-welcomed')) $('#help-dialog').showModal();
  });
})();
