'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/** Use one portable, unambiguous path format on both platforms. */
function validateRelativePath(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\\') || value.startsWith('/')) {
    throw new Error('Invalid relative path');
  }
  for (const part of value.split('/')) {
    if (!part || part === '.' || part === '..' || /[\x00-\x1f<>:"|?*]/.test(part) || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(part)) {
      throw new Error(`Invalid path component: ${part}`);
    }
  }
  return value;
}

function suffixName(name, index, directory = false) {
  if (!index) return name;
  const ext = directory ? '' : path.posix.extname(name);
  return `${name.slice(0, name.length - ext.length)} (${index})${ext}`;
}

function inside(root, target) {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Path escapes the download directory');
  return target;
}

async function verifyParents(root, target) {
  inside(root, target);
  const relative = path.relative(root, path.dirname(target));
  let current = root;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Refusing a symbolic link or non-directory destination');
  }
  const realParent = await fs.realpath(path.dirname(target));
  inside(root, realParent);
}

async function buildManifest(paths) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('Choose at least one file or folder');
  const entries = [];
  const usedRoots = new Set();
  const uniquePaths = [...new Set(paths.map(p => path.resolve(p)))];
  async function walk(localPath, relativePath) {
    validateRelativePath(relativePath);
    const stat = await fs.lstat(localPath);
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are not supported: ${localPath}`);
    if (stat.isDirectory()) {
      entries.push({ path: relativePath, type: 'directory', size: 0, localPath });
      for (const name of (await fs.readdir(localPath)).sort()) await walk(path.join(localPath, name), `${relativePath}/${name}`);
    } else if (stat.isFile()) {
      entries.push({ path: relativePath, type: 'file', size: stat.size, localPath });
    } else throw new Error(`Only regular files and folders can be sent: ${localPath}`);
  }
  for (const localPath of uniquePaths) {
    const stat = await fs.lstat(localPath);
    const base = path.basename(localPath);
    let index = 0;
    let name;
    do { name = suffixName(base, index++, stat.isDirectory()); } while (usedRoots.has(name.toLocaleLowerCase('en-US')));
    usedRoots.add(name.toLocaleLowerCase('en-US'));
    await walk(localPath, name);
  }
  validateEntries(entries);
  return entries;
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 100000) throw new Error('Invalid or excessively large file list');
  const seen = new Map();
  let totalBytes = 0;
  const clean = entries.map(entry => {
    if (!entry || !['file', 'directory'].includes(entry.type)) throw new Error('Invalid entry type');
    const name = validateRelativePath(entry.path);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0 || (entry.type === 'directory' && entry.size !== 0)) throw new Error('Invalid file size');
    const key = name.normalize('NFC').toLocaleLowerCase('en-US');
    if (seen.has(key)) throw new Error('Duplicate or case-conflicting paths');
    seen.set(key, entry.type);
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) throw new Error('Transfer is too large');
    return { path: name, type: entry.type, size: entry.size };
  });
  for (const entry of clean) {
    const components = entry.path.split('/');
    while (components.length > 1) {
      components.pop();
      if (seen.get(components.join('/').normalize('NFC').toLocaleLowerCase('en-US')) !== 'directory') {
        throw new Error('Every parent directory must be present in the offer');
      }
    }
  }
  return { entries: clean, totalBytes };
}

module.exports = { buildManifest, validateRelativePath, validateEntries, suffixName, inside, verifyParents };
