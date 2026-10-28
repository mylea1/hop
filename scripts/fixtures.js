const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function main() {
  const [command, directory] = process.argv.slice(2);
  if (!['create', 'verify'].includes(command) || !directory) throw new Error('Usage: node scripts/fixtures.js create|verify <directory>');
  const root = path.resolve(directory);
  if (command === 'create') {
    await fs.mkdir(path.join(root, 'Hop Test Folder', 'nested'), { recursive: true });
    await fs.mkdir(path.join(root, 'Hop Test Folder', 'empty'), { recursive: true });
    const files = { 'Hop Test Folder/hello.txt': Buffer.from('Hello nearby. 你好，Hop。\n'), 'Hop Test Folder/nested/pattern.bin': randomBytes(16384), 'hop-3MiB.bin': randomBytes(3 * 1024 * 1024) };
    const manifest = {};
    for (const [relative, bytes] of Object.entries(files)) {
      await fs.writeFile(path.join(root, relative), bytes, { flag: 'wx' });
      manifest[relative] = hash(bytes);
    }
    await fs.writeFile(path.join(root, 'hop-sha256.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
    console.log(`Created fixtures in ${root}. Send Hop Test Folder, hop-3MiB.bin and hop-sha256.json together.\n${JSON.stringify(manifest, null, 2)}`);
  } else {
    const manifest = JSON.parse(await fs.readFile(path.join(root, 'hop-sha256.json'), 'utf8'));
    for (const [relative, expected] of Object.entries(manifest)) {
      const full = path.resolve(root, relative);
      if (!full.startsWith(root + path.sep)) throw new Error('Invalid manifest path');
      if (hash(await fs.readFile(full)) !== expected) throw new Error(`Hash mismatch: ${relative}`);
      console.log(`PASS ${relative}`);
    }
    if (!(await fs.stat(path.join(root, 'Hop Test Folder', 'empty'))).isDirectory()) throw new Error('Empty folder missing');
    console.log('All SHA-256 hashes match. Empty folder preserved.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
