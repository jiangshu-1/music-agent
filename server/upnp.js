import ssdp from 'node-ssdp';
const { Client } = ssdp;
import DeviceClient from 'upnp-device-client';
import { logger } from './logger.js';

const log = logger.withTag('upnp');

const SEARCH_TARGET = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const STALE_MS = Number(process.env.UPNP_STALE_MS ?? 10 * 60 * 1000); // drop devices not seen in 10 min
const SWEEP_MS = 60 * 1000;
const BACKGROUND_REFRESH_MS = 5 * 60 * 1000;

const devices = new Map();
let currentDeviceId = null;
let client = null;
let sweepTimer = null;
let backgroundTimer = null;

function makeClient() {
  const c = new Client();
  c.on('response', rememberDevice);
  c.on('error', (error) => {
    log.warn('ssdp client error', { error: error.message });
  });
  return c;
}

function rememberDevice(headers, rinfo) {
  if (headers.ST !== SEARCH_TARGET || !headers.LOCATION) return;

  const id = headers.USN || headers.LOCATION;
  const existing = devices.get(id);
  const nowIso = new Date().toISOString();
  const firstTime = !existing;

  devices.set(id, {
    id,
    name: existing?.name || headers.SERVER || `媒体播放设备 ${rinfo?.address ?? ''}`.trim(),
    location: headers.LOCATION,
    address: rinfo?.address ?? existing?.address ?? null,
    seenAt: nowIso,
    client: existing?.client ?? new DeviceClient(headers.LOCATION)
  });

  if (firstTime) {
    log.info('discovered device', { location: headers.LOCATION });
  }
  if (currentDeviceId == null) currentDeviceId = id;
}

function pruneStaleDevices({ maxAgeMs = STALE_MS } = {}) {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  for (const [id, device] of devices) {
    const seen = new Date(device.seenAt).getTime();
    if (!Number.isFinite(seen) || seen < cutoff) {
      devices.delete(id);
      if (currentDeviceId === id) currentDeviceId = null;
      removed += 1;
    }
  }
  if (removed) log.info('pruned stale devices', { removed });
  return removed;
}

function ensureClient() {
  if (!client) client = makeClient();
  return client;
}

export function discoverDevices() {
  try {
    ensureClient().search(SEARCH_TARGET);
  } catch (error) {
    log.warn('discovery failed', { error: error.message });
  }
  return listDevices();
}

export async function refreshDevices({ timeout = 1200 } = {}) {
  discoverDevices();
  await new Promise((resolve) => setTimeout(resolve, timeout));
  pruneStaleDevices();
  return listDevices();
}

export function listDevices() {
  return [...devices.values()].map(({ client: _client, ...device }) => ({
    ...device,
    selected: device.id === currentDeviceId
  }));
}

function dropDevice(id) {
  const device = devices.get(id);
  if (!device) return;
  try { device.client?.removeAllListeners?.(); } catch {}
  devices.delete(id);
  if (currentDeviceId === id) currentDeviceId = null;
}

function callDeviceAction(device, service, action, params) {
  return new Promise((resolve, reject) => {
    device.client.callAction(service, action, params, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
  });
}

export async function playOnDevice(url, metadata = {}, targetId = null) {
  // Prefer explicit target, then the current selection, then any known device.
  const order = [];
  if (targetId && devices.has(targetId)) order.push(targetId);
  if (currentDeviceId && !order.includes(currentDeviceId) && devices.has(currentDeviceId)) order.push(currentDeviceId);
  for (const id of devices.keys()) if (!order.includes(id)) order.push(id);

  if (!order.length) {
    throw new Error('没有找到 UPnP 音箱。请先在"我的设置"里刷新音箱列表。');
  }

  let lastError = null;
  for (const id of order) {
    const device = devices.get(id);
    if (!device) continue;
    try {
      await callDeviceAction(device, 'AVTransport', 'SetAVTransportURI', {
        InstanceID: 0,
        CurrentURI: url,
        CurrentURIMetaData: metadata.xml || ''
      });
      await callDeviceAction(device, 'AVTransport', 'Play', {
        InstanceID: 0,
        Speed: 1
      });
      currentDeviceId = id;
      return { id, name: device.name };
    } catch (error) {
      lastError = error;
      log.warn('device failed', { device: device.name, error: error.message });
      // Drop the device and try the next one. It's likely powered off or on a different network.
      dropDevice(id);
    }
  }

  throw new Error(lastError?.message ?? 'UPnP 音箱全部无响应');
}

// Periodic maintenance: age out silent devices and re-advertise our search
// so new devices show up without the user having to click refresh.
function startMaintenance() {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => pruneStaleDevices(), SWEEP_MS);
  sweepTimer.unref?.();
  backgroundTimer = setInterval(() => discoverDevices(), BACKGROUND_REFRESH_MS);
  backgroundTimer.unref?.();
}

// Initial discovery + maintenance — guarded so errors don't crash the server.
try {
  discoverDevices();
  startMaintenance();
} catch (error) {
  log.warn('init failed', { error: error.message });
}
