import { allSongs, getSong, toClientSong, toClientSongs } from '../music.js';
import { getPref, recordPlay, setPref } from '../db.js';
import { stationTransitionLine } from '../dj.js';
import { allStations, broadcastNowPlaying, customStations, stationQueue, stationSummary } from './shared.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/stations',
    async handler(req, res) {
      res.json({ stations: allStations().map(stationSummary) });
    }
  },
  {
    method: 'POST',
    path: '/api/station/play',
    async handler(req, res) {
      const body = await req.body();
      const { station, queue } = stationQueue(body.id, body.limit ?? 18);
      const current = queue[0] ?? null;
      setPref('queue', queue);
      if (current) {
        setPref('current', current);
        recordPlay(current, station.mood, 'station');
      }
      const say = current
        ? stationTransitionLine(station, current)
        : `${station.name}电台暂时没有可播放歌曲。`;
      broadcastNowPlaying(req, { say: `Claudio: ${say}` });
      res.json({
        station: stationSummary(station),
        current: toClientSong(current),
        queue: toClientSongs(queue),
        say: `Claudio: ${say}`
      });
    }
  },
  {
    method: 'POST',
    path: '/api/station/save',
    async handler(req, res) {
      const body = await req.body();
      const queue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);
      if (!queue.length) {
        res.json({ error: '当前队列为空，不能保存电台' }, 400);
        return;
      }

      const name = String(body.name ?? '').trim().slice(0, 24) || `我的电台 ${customStations().length + 1}`;
      const id = `custom-${Date.now().toString(36)}`;
      const station = {
        id,
        name,
        description: `${queue.length} 首歌`,
        mood: 'custom',
        targetEnergy: Math.round(queue.reduce((sum, song) => sum + Number(song.energy ?? 50), 0) / queue.length),
        terms: ['custom'],
        songIds: queue.map((song) => song.id),
        custom: true,
        createdAt: new Date().toISOString()
      };
      const nextStations = [station, ...customStations()].slice(0, 20);
      setPref('custom_stations', nextStations);
      res.json({ station: stationSummary(station), stations: allStations().map(stationSummary) });
    }
  },
  {
    method: 'POST',
    path: '/api/station/delete',
    async handler(req, res) {
      const body = await req.body();
      const id = String(body.id ?? '');
      const nextStations = customStations().filter((station) => station.id !== id);
      setPref('custom_stations', nextStations);
      res.json({ stations: allStations().map(stationSummary) });
    }
  }
];
