const fs = require('node:fs');
const path = require('node:path');

function createLogger(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'startup.log');
  try {
    if (fs.statSync(file).size > 2 * 1024 * 1024) fs.renameSync(file, `${file}.previous`);
  } catch {}
  const log = (level, message, detail) => {
    const data = detail instanceof Error ? detail.stack : detail;
    const line = `${new Date().toISOString()} [${level}] ${message}${data ? ` ${typeof data === 'string' ? data : JSON.stringify(data)}` : ''}\n`;
    try { fs.appendFileSync(file, line); } catch (error) { process.stderr.write(`Could not write Hop log: ${error.message}\n`); }
    process.stdout.write(line);
  };
  return { file, info: (message, detail) => log('INFO', message, detail), error: (message, detail) => log('ERROR', message, detail), warn: (message, detail) => log('WARN', message, detail) };
}

module.exports = { createLogger };
