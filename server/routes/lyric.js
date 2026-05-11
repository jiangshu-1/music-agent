import { getLyric, getSong } from '../music.js';
import { neteaseTimedLyric } from '../netease.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/lyric',
    async handler(req, res) {
      const id = req.urlObject.searchParams.get('id') ?? '';
      const song = getSong(id);
      let lyric = getLyric(id);
      if (song?.provider === 'netease') {
        lyric = await neteaseTimedLyric(song.providerId ?? id).catch(() => lyric);
      }
      res.json({ lyric });
    }
  }
];
