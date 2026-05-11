import { getPref, setPref, setSongTags } from '../db.js';
import { libraryInfo, scanLibrary } from '../library.js';
import { allSongs, getSong, toClientSong, toClientSongs } from '../music.js';
import { importNeteaseSong } from '../netease.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/song/refresh-url',
    async handler(req, res) {
      const body = await req.body();
      const song = getSong(body.id);
      if (song?.provider !== 'netease') {
        const queue = getPref('queue', allSongs()).map((item) => getSong(item.id)).filter(Boolean);
        res.json({ song: toClientSong(song), queue: toClientSongs(queue) });
        return;
      }

      const refreshed = await importNeteaseSong(song);
      const queue = getPref('queue', allSongs())
        .map((item) => item.id === refreshed.id ? refreshed : getSong(item.id))
        .filter(Boolean);
      const savedCurrent = getPref('current');
      const current = savedCurrent?.id === refreshed.id ? refreshed : (savedCurrent?.id ? getSong(savedCurrent.id) : null);
      setPref('queue', queue);
      if (current) setPref('current', current);
      res.json({
        song: toClientSong(refreshed),
        current: toClientSong(current),
        queue: toClientSongs(queue)
      });
    }
  },
  {
    method: 'POST',
    path: '/api/song/tags',
    async handler(req, res) {
      const body = await req.body();
      const song = getSong(body.songId);
      const mood = String(body.mood ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8);
      const energy = Math.max(0, Math.min(100, Number(body.energy ?? song.energy)));
      const tags = setSongTags(song.id, {
        mood: mood.length ? mood : song.mood,
        energy,
        note: String(body.note ?? '').slice(0, 240)
      });
      scanLibrary({ refresh: true });
      res.json({ ok: true, tags, song: toClientSong(getSong(song.id)) });
    }
  }
];
