import { allSongs, getSong, recommend, toClientSong, toClientSongs } from '../music.js';
import { getPref, recentPlays, recordPlay, setPref } from '../db.js';
import { broadcastNowPlaying } from './shared.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/play',
    async handler(req, res) {
      const body = await req.body();
      const song = getSong(body.id);
      setPref('current', song);
      recordPlay(song, body.mood ?? 'manual', 'play');
      broadcastNowPlaying(req);
      res.json({ current: toClientSong(song) });
    }
  },
  {
    method: 'POST',
    path: '/api/next',
    async handler(req, res) {
      const queue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);
      const current = getSong(getPref('current', queue[0])?.id ?? queue[0]?.id);
      const index = queue.findIndex((song) => song.id === current.id);
      let workingQueue = queue;

      if (workingQueue.length - (index + 1) <= 1) {
        const recentIds = new Set(recentPlays(16).map((item) => item.song_id));
        const existingIds = new Set(workingQueue.map((song) => song.id));
        const candidates = recommend({ intent: 'continue', recent: recentPlays(8) })
          .filter((song) => !existingIds.has(song.id) && !recentIds.has(song.id) && song.id !== current?.id);
        if (candidates.length) {
          workingQueue = [...workingQueue, ...candidates.slice(0, 3)];
          setPref('queue', workingQueue);
        }
      }

      const nextIndex = index + 1;
      const next = workingQueue[nextIndex] ?? workingQueue[0] ?? allSongs()[0];
      setPref('current', next);
      recordPlay(next, 'next', 'play');
      broadcastNowPlaying(req);
      res.json({ current: toClientSong(next), queue: toClientSongs(workingQueue) });
    }
  },
  {
    method: 'GET',
    path: '/api/queue',
    async handler(req, res) {
      const queue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);
      const current = getSong(getPref('current', queue[0])?.id ?? queue[0]?.id);
      res.json({ current: toClientSong(current), queue: toClientSongs(queue) });
    }
  },
  {
    method: 'POST',
    path: '/api/queue',
    async handler(req, res) {
      const body = await req.body();
      const action = body.action ?? 'replace';
      const queue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);

      if (action === 'clear') {
        setPref('queue', []);
        res.json({ current: toClientSong(getSong(getPref('current')?.id)), queue: [] });
        return;
      }

      if (action === 'remove') {
        const nextQueue = queue.filter((song) => song.id !== body.id);
        const savedCurrent = getPref('current', nextQueue[0]);
        const removedCurrent = savedCurrent?.id === body.id;
        const current = removedCurrent
          ? nextQueue[0] ?? null
          : getSong(savedCurrent?.id ?? nextQueue[0]?.id);
        if (current) setPref('current', current);
        setPref('queue', nextQueue);
        res.json({ current: toClientSong(current), queue: toClientSongs(nextQueue) });
        return;
      }

      if (action === 'shuffle') {
        const savedCurrent = getSong(getPref('current', queue[0])?.id ?? queue[0]?.id);
        const targetEnergy = Number(savedCurrent?.energy ?? 55);
        const currentMoods = new Set(savedCurrent?.mood ?? []);
        const scored = queue
          .filter((song) => song.id !== savedCurrent?.id)
          .map((song) => {
            const sharedMood = (song.mood ?? []).filter((mood) => currentMoods.has(mood)).length;
            const energyDistance = Math.abs(Number(song.energy ?? 55) - targetEnergy);
            return { song, score: sharedMood * 8 - energyDistance * 0.35 + Math.random() * 4 };
          })
          .sort((a, b) => b.score - a.score)
          .map((item) => item.song);
        const nextQueue = savedCurrent ? [savedCurrent, ...scored] : scored;
        const current = nextQueue[0] ?? getSong(getPref('current')?.id);
        if (current) setPref('current', current);
        setPref('queue', nextQueue);
        res.json({ current: toClientSong(current), queue: toClientSongs(nextQueue) });
        return;
      }

      if (action === 'move') {
        const index = queue.findIndex((song) => song.id === body.id);
        if (index === -1) {
          res.json({ error: '队列里没有这首歌' }, 404);
          return;
        }
        const delta = body.direction === 'down' ? 1 : -1;
        const target = Math.max(0, Math.min(queue.length - 1, index + delta));
        const nextQueue = [...queue];
        const [song] = nextQueue.splice(index, 1);
        nextQueue.splice(target, 0, song);
        const current = getSong(getPref('current', nextQueue[0])?.id ?? nextQueue[0]?.id);
        setPref('queue', nextQueue);
        if (current) setPref('current', current);
        res.json({ current: toClientSong(current), queue: toClientSongs(nextQueue) });
        return;
      }

      res.json({ error: '未知队列操作' }, 400);
    }
  }
];
