import { localAddresses } from '../network.js';
import { getSong } from '../music.js';
import { playOnDevice, refreshDevices } from '../upnp.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/cast/devices',
    async handler(req, res) {
      const shouldRefresh = req.urlObject.searchParams.get('refresh') === '1';
      const devices = shouldRefresh ? await refreshDevices() : await refreshDevices({ timeout: 150 });
      res.json({ devices });
    }
  },
  {
    method: 'POST',
    path: '/api/cast',
    async handler(req, res) {
      const body = await req.body();
      const song = getSong(body.id);
      const port = process.env.PORT ?? 8080;
      const addresses = localAddresses(port);
      const host = addresses[0]?.address || '127.0.0.1';
      const streamUrl = `http://${host}:${port}/api/audio?id=${encodeURIComponent(song.id)}`;

      try {
        await playOnDevice(streamUrl, { title: song.title, artist: song.artist }, body.targetId ?? null);
        res.json({ ok: true, target: 'upnp' });
      } catch (err) {
        res.json({ error: err.message }, 500);
      }
    }
  }
];
