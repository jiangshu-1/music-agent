import { allSongs, getSong, toClientSong, toClientSongs } from '../music.js';
import { getPref, getPreferenceSummary, recentFeedback, recentPlays } from '../db.js';
import { scanLibrary } from '../library.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/now',
    async handler(req, res) {
      scanLibrary();
      const songs = allSongs();
      const fallback = songs[0];
      const savedCurrent = getPref('current', fallback);
      const savedQueue = getPref('queue', songs.slice(0, 3));
      const current = getSong(savedCurrent?.id ?? fallback?.id);
      let queue = (savedQueue || []).map((song) => getSong(song.id)).filter(Boolean);

      if (!queue.length && songs.length) queue = songs.slice(0, 3);

      res.json({
        current: toClientSong(current || fallback),
        queue: toClientSongs(queue.length ? queue : (fallback ? [fallback] : [])),
        recent: recentPlays(8),
        feedback: recentFeedback(8),
        preferenceSummary: getPreferenceSummary()
      });
    }
  }
];
