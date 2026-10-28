const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

(async () => {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'hop-ui-'));
  const output = path.resolve(__dirname, '../test-results');
  await fs.mkdir(output, { recursive: true });
  const child = spawn(require('electron'), [path.resolve(__dirname, '..')], {
    env: { ...process.env, HOP_PROFILE_DIR: profile, HOP_SMOKE_TEST: output }, stdio: 'inherit'
  });
  const timer = setTimeout(() => { console.error('Electron smoke test timed out after 60 seconds.'); child.kill('SIGTERM'); }, 60000);
  child.on('exit', async code => {
    clearTimeout(timer);
    await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
    process.exitCode = code ?? 1;
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
