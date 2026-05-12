import { spawn, spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const roots = ['server', 'scripts', 'web', 'tests'];
const files = [];

function collect(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      collect(path);
    } else if (path.endsWith('.js')) {
      files.push(path);
    }
  }
}

for (const root of roots) collect(root);

let failed = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed += 1;
}

if (failed) {
  console.error(`syntax check failed: ${failed}/${files.length}`);
  process.exit(1);
}

console.log(`syntax check passed: ${files.length}/${files.length}`);

const testFiles = files.filter((file) => (file.startsWith('tests/') || file.startsWith('tests\\')) && file.endsWith('.test.js'));
const tests = spawnSync(process.execPath, ['--experimental-sqlite', '--test', ...testFiles], { stdio: 'inherit' });
if (tests.status !== 0) process.exit(tests.status ?? 1);

const base = process.env.CIKE_BASE || process.env.CLAUDIO_BASE || 'http://127.0.0.1:8080';

function serverIsUp() {
  const result = spawnSync('curl', ['--noproxy', '*', '-sS', '--max-time', '2', new URL('/api/stations', base)], {
    encoding: 'utf8'
  });
  return result.status === 0;
}

function waitForServer() {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (serverIsUp()) return true;
    spawnSync('sleep', ['0.25']);
  }
  return false;
}

let server = null;
if (!serverIsUp()) {
  console.log('starting temporary 此刻 server for smoke checks');
  server = spawn(process.execPath, ['--experimental-sqlite', 'server/index.js'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    env: process.env
  });
  if (!waitForServer()) {
    server.kill('SIGTERM');
    console.error('temporary 此刻 server did not become ready');
    process.exit(1);
  }
}

const smoke = spawnSync(process.execPath, ['scripts/smoke.js'], { stdio: 'inherit' });
if (server) server.kill('SIGTERM');
process.exit(smoke.status ?? 1);
