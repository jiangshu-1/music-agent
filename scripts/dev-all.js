import { spawn } from 'node:child_process';

const children = new Set();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const neteaseBase = process.env.NETEASE_API_BASE || 'http://127.0.0.1:3000';

function prefix(name, chunk) {
  const lines = String(chunk).split(/\r?\n/).filter(Boolean);
  for (const line of lines) console.log(`[${name}] ${line}`);
}

function start(name, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    ...options
  });
  children.add(child);
  child.stdout.on('data', (chunk) => prefix(name, chunk));
  child.stderr.on('data', (chunk) => prefix(name, chunk));
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}${signal ? ` (${signal})` : ''}`);
      shutdown(code);
    }
  });
  return child;
}

async function isUp(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

let shuttingDown = false;

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

if (await isUp(new URL('/login/status', neteaseBase))) {
  console.log(`[netease] using existing service at ${neteaseBase}`);
} else {
  start('netease', npm, ['run', 'netease']);
}

start('claudio', process.execPath, ['--experimental-sqlite', 'server/index.js']);
