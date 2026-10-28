const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

class Settings {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = { id: randomUUID(), name: os.hostname().replace(/\.local$/, '').slice(0, 64), theme: 'auto', downloadDir: path.join(os.homedir(), 'Downloads', 'Hop'), trusted: {}, ...defaults };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid settings');
      if (typeof saved.id === 'string' && saved.id.length) this.data.id = saved.id;
      if (typeof saved.name === 'string' && saved.name.trim()) this.data.name = saved.name.slice(0, 64);
      if (['auto', 'light', 'dark'].includes(saved.theme)) this.data.theme = saved.theme;
      if (typeof saved.downloadDir === 'string' && path.isAbsolute(saved.downloadDir)) this.data.downloadDir = saved.downloadDir;
      if (saved.trusted && typeof saved.trusted === 'object' && !Array.isArray(saved.trusted)) this.data.trusted = saved.trusted;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch {}
      }
    }
    this.save();
  }

  save(data = this.data) {
    const temporary = `${this.file}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2));
    fs.renameSync(temporary, this.file);
  }

  update(values) {
    const next = { ...this.data };
    if (values.name !== undefined) {
      if (typeof values.name !== 'string' || !values.name.trim()) throw new Error('Please enter a device name.');
      next.name = values.name.trim().slice(0, 64);
    }
    if (values.theme !== undefined) {
      if (!['auto', 'light', 'dark'].includes(values.theme)) throw new Error('Invalid theme.');
      next.theme = values.theme;
    }
    if (values.downloadDir !== undefined) {
      if (typeof values.downloadDir !== 'string' || !path.isAbsolute(values.downloadDir)) throw new Error('Choose an absolute folder path.');
      next.downloadDir = values.downloadDir;
    }
    this.save(next);
    this.data = next;
    return this.data;
  }

  trust(peer) { this.data.trusted[peer.id] = { name: peer.name, addedAt: Date.now() }; this.save(); }
  isTrusted(id) { return Object.hasOwn(this.data.trusted, id); }
  clearTrust() { this.data.trusted = {}; this.save(); }
}

module.exports = { Settings };
