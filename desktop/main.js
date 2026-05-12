import { app, BrowserWindow, Tray, Menu, shell, ipcMain, globalShortcut, nativeImage, screen } from 'electron';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const SERVER_HOST = process.env.CIKE_HOST ?? process.env.CLAUDIO_HOST ?? '127.0.0.1';
const SERVER_PORT = Number(process.env.PORT ?? process.env.CIKE_PORT ?? process.env.CLAUDIO_PORT ?? 8080);
const SERVER_BASE = `http://${SERVER_HOST}:${SERVER_PORT}`;
const MINI_URL = `${SERVER_BASE}/mini`;

let tray = null;
let window = null;
let serverProcess = null;

async function pingServer() {
  try {
    const response = await fetch(`${SERVER_BASE}/api/now`, { signal: AbortSignal.timeout(600) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await pingServer()) return true;

  console.log('[desktop] 此刻 server not running, starting it...');
  serverProcess = spawn('node', ['--experimental-sqlite', 'server/index.js'], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env }
  });

  serverProcess.on('exit', (code) => {
    console.log(`[desktop] 此刻 server exited with code ${code}`);
    serverProcess = null;
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await pingServer()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function createTrayIcon() {
  // 18x18 @2x color icon: a dark vinyl disc with a red heart label
  // and a tiny center hole. Not a template image because we want the
  // red to stay red in both light and dark menu bars.
  const size = 36;
  const buffer = Buffer.alloc(size * size * 4, 0);

  // Source-over compositing so heart sits cleanly on the disc.
  const blend = (x, y, r, g, b, a) => {
    if (x < 0 || x >= size || y < 0 || y >= size || a <= 0) return;
    const i = (y * size + x) * 4;
    const srcA = a / 255;
    const dstA = buffer[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    buffer[i] = Math.round((r * srcA + buffer[i] * dstA * (1 - srcA)) / outA);
    buffer[i + 1] = Math.round((g * srcA + buffer[i + 1] * dstA * (1 - srcA)) / outA);
    buffer[i + 2] = Math.round((b * srcA + buffer[i + 2] * dstA * (1 - srcA)) / outA);
    buffer[i + 3] = Math.round(outA * 255);
  };

  const cx = 17.5;
  const cy = 17.5;
  const discRadius = 12.5;   // smaller than before to feel less heavy
  const heartScale = 5.2;
  const heartCy = 18.2;      // nudge down so top lobes stay on the disc
  const holeRadius = 1.15;

  // Vinyl disc (near-black, soft anti-aliased edge)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const coverage = Math.max(0, Math.min(1, discRadius + 0.5 - d));
      if (coverage > 0) blend(x, y, 18, 18, 20, coverage * 255);
    }
  }

  // Red heart, drawn with the implicit equation
  //   (nx² + ny² − 1)³ − nx² · ny³ ≤ 0
  // and 2x2 supersampling so the edges look clean at this size.
  const heartFn = (nx, ny) => {
    const t = nx * nx + ny * ny - 1;
    return t * t * t - nx * nx * ny * ny * ny;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < 2; sy += 1) {
        for (let sx = 0; sx < 2; sx += 1) {
          const px = x + 0.25 + sx * 0.5;
          const py = y + 0.25 + sy * 0.5;
          const nx = (px - cx) / heartScale;
          const ny = (heartCy - py) / heartScale;
          if (heartFn(nx, ny) <= 0) covered += 1;
        }
      }
      if (covered > 0) {
        blend(x, y, 220, 58, 48, (covered / 4) * 255);
      }
    }
  }

  // Center label hole (soft off-white, sits over the heart)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      const coverage = Math.max(0, Math.min(1, holeRadius + 0.5 - d));
      if (coverage > 0) blend(x, y, 242, 242, 240, coverage * 255);
    }
  }

  const image = nativeImage.createFromBuffer(
    Buffer.from(bufferToPng(buffer, size, size))
  );
  const created = new Tray(image);
  created.setToolTip('此刻 个人电台');
  return created;
}

// Minimal PNG encoder for an RGBA bitmap (no deps).
// Used because nativeImage.createFromBitmap has platform-specific byte order
// quirks; PNG is portable.
function bufferToPng(rgba, width, height) {
  function crc32(buf) {
    let c;
    const table = crc32.table ?? (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  }

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type: RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // Add filter byte (0 = none) to each scanline
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function createWindow() {
  const mini = new BrowserWindow({
    width: 380,
    height: 560,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#0d0f0e',
    title: '此刻 Mini',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mini.on('blur', () => {
    if (!mini.webContents.isDevToolsOpened()) mini.hide();
  });
  mini.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') mini.hide();
  });

  return mini;
}

function positionWindowNearTray() {
  if (!tray || !window) return;
  const trayBounds = tray.getBounds();
  const winBounds = window.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });

  const x = Math.max(
    display.workArea.x + 8,
    Math.min(
      Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2),
      display.workArea.x + display.workArea.width - winBounds.width - 8
    )
  );
  const y = Math.round(trayBounds.y + trayBounds.height + 6);
  window.setPosition(x, y, false);
}

function toggleWindow() {
  if (!window) return;
  if (window.isVisible()) {
    window.hide();
  } else {
    positionWindowNearTray();
    window.show();
    window.focus();
  }
}

function buildTrayMenu() {
  const loginItem = app.getLoginItemSettings();
  return Menu.buildFromTemplate([
    { label: '打开 / 收起', click: toggleWindow, accelerator: 'Cmd+Shift+M' },
    { type: 'separator' },
    { label: '在浏览器里打开完整版', click: () => shell.openExternal(SERVER_BASE) },
    {
      label: '重新载入 mini',
      accelerator: 'Cmd+R',
      click: () => window?.webContents?.reloadIgnoringCache()
    },
    {
      label: '清空 mini 缓存并重载',
      click: async () => {
        if (!window) return;
        try {
          await window.webContents.session.clearCache();
          await window.webContents.session.clearStorageData({ storages: ['serviceworkers'] });
        } catch (error) {
          console.warn('[desktop] clear cache failed:', error.message);
        }
        window.webContents.reloadIgnoringCache();
      }
    },
    { label: '打开开发者工具', click: () => window?.webContents.openDevTools({ mode: 'detach' }) },
    { type: 'separator' },
    {
      label: '登录时自动启动',
      type: 'checkbox',
      checked: Boolean(loginItem.openAtLogin),
      click: (item) => {
        app.setLoginItemSettings({
          openAtLogin: item.checked,
          openAsHidden: true
        });
      }
    },
    { type: 'separator' },
    { label: '退出 此刻', click: () => app.quit() }
  ]);
}

function registerShortcuts() {
  globalShortcut.register('CommandOrControl+Shift+M', toggleWindow);
  globalShortcut.register('MediaPlayPause', () => sendMediaKey('playpause'));
  globalShortcut.register('MediaNextTrack', () => sendMediaKey('next'));
  globalShortcut.register('MediaPreviousTrack', () => sendMediaKey('prev'));
}

function sendMediaKey(action) {
  if (!window) return;
  window.webContents.send('claudio:media', action);
}

app.on('ready', async () => {
  // Hide dock icon on macOS so we act as a pure menubar app.
  if (process.platform === 'darwin') app.dock?.hide();

  tray = createTrayIcon();
  tray.on('click', toggleWindow);
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()));

  // Boot the server before creating the window so the first page load succeeds.
  const ok = await ensureServer();
  if (!ok) {
    console.error('[desktop] 此刻 server did not start in time');
  }

  window = createWindow();
  window.loadURL(MINI_URL);

  // If the page failed to load (server slow to boot, network blip), retry a couple of times.
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL && validatedURL.startsWith(SERVER_BASE)) {
      console.log(`[desktop] page load failed (${errorCode} ${errorDescription}), retrying in 600ms`);
      setTimeout(() => {
        if (!window.isDestroyed()) window.loadURL(MINI_URL);
      }, 600);
    }
  });

  registerShortcuts();

  if (process.env.CIKE_DESKTOP_SMOKE === '1' || process.env.CLAUDIO_DESKTOP_SMOKE === '1') {
    console.log('[desktop] smoke mode: tray + window created, server reachable:', ok);
    setTimeout(() => app.exit(0), 1500);
  }
});

app.on('window-all-closed', (event) => {
  // Stay alive as a menubar app.
  event.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGTERM');
  }
});

ipcMain.on('claudio:open-external', (_event, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    shell.openExternal(url);
  }
});

ipcMain.on('claudio:quit', () => {
  app.quit();
});

ipcMain.on('claudio:hide', () => {
  window?.hide();
});
