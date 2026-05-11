import { spawn } from 'node:child_process';
import { platform } from 'node:os';

const children = new Set();
let shuttingDown = false;

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
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(500) });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

function shutdown(code = 0) {
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 250);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const npm = platform() === 'win32' ? 'npm.cmd' : 'npm';
const host = process.env.CLAUDIO_HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8080);
const serverUrl = `http://${host}:${port}/api/now`;
const neteaseBase = process.env.NETEASE_API_BASE ?? 'http://127.0.0.1:3000';
const neteaseProbe = new URL('/login/status', neteaseBase).toString();

// 1. NetEase API provider
if (!(await isUp(neteaseProbe))) {
  console.log('[netease] starting NeteaseCloudMusicApi...');
  start('netease', npm, ['run', 'netease']);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isUp(neteaseProbe)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} else {
  console.log(`[netease] reusing existing provider at ${neteaseBase}`);
}

// 2. Claudio server
if (!(await isUp(serverUrl))) {
  start('claudio', process.execPath, ['--experimental-sqlite', 'server/index.js']);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isUp(serverUrl)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} else {
  console.log(`[claudio] reusing existing server at http://${host}:${port}`);
}

// 3. Electron mini player
const electronBin = platform() === 'win32' ? 'electron.cmd' : 'electron';
start('electron', `node_modules/.bin/${electronBin}`, ['desktop/main.js']);
