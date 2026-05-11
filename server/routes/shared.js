import { getSong, toClientSong, toClientSongs, allSongs } from '../music.js';
import { getPref, getPreferenceSummary, recentPlays, setPref } from '../db.js';
import { broadcast } from '../broadcast.js';

export function broadcastNowPlaying(req, extra = {}) {
  const current = getPref('current');
  const queue = getPref('queue', []);
  const sourceClientId = req.headers['x-client-id'] || null;
  broadcast({
    type: 'now-playing',
    sourceClientId,
    current: current ? toClientSong(getSong(current.id)) : null,
    queue: toClientSongs((queue || []).map((song) => getSong(song.id)).filter(Boolean)),
    ...extra
  });
}

const stations = [
  {
    id: 'focus',
    name: '专注',
    description: '中低能量，适合继续工作',
    mood: 'focus',
    targetEnergy: 52,
    terms: ['focus', 'work', 'clean', 'local']
  },
  {
    id: 'night',
    name: '深夜',
    description: '更慢、更暗、更少打扰',
    mood: 'night',
    targetEnergy: 38,
    terms: ['night', 'late', 'deep', 'quiet', 'soft']
  },
  {
    id: 'discovery',
    name: '发现',
    description: '避开最近播放，翻一点新东西',
    mood: 'discovery',
    targetEnergy: 58,
    terms: ['netease', 'playlist']
  },
  {
    id: 'commute',
    name: '通勤',
    description: '更有推进感，适合路上',
    mood: 'drive',
    targetEnergy: 68,
    terms: ['drive', 'morning', 'clean', 'social', 'netease']
  },
  {
    id: 'sleep',
    name: '睡前',
    description: '低能量，尽量少打扰',
    mood: 'rest',
    targetEnergy: 22,
    terms: ['sleep', 'rest', 'soft', 'quiet', 'low-energy']
  },
  {
    id: 'local',
    name: '本地',
    description: '优先播放电脑里的文件',
    mood: 'local',
    targetEnergy: 55,
    terms: ['local'],
    source: 'local'
  },
  {
    id: 'wind-down',
    name: '收尾',
    description: '低能量，适合停下来',
    mood: 'rest',
    targetEnergy: 28,
    terms: ['rest', 'soft', 'quiet', 'low-energy']
  }
];

export function stationSummary(station) {
  return {
    id: station.id,
    name: station.name,
    description: station.description,
    custom: Boolean(station.custom),
    count: station.songIds?.length ?? null
  };
}

export function customStations() {
  return getPref('custom_stations', [])
    .filter((station) => station?.id && Array.isArray(station.songIds))
    .map((station) => ({
      id: station.id,
      name: station.name || '我的电台',
      description: station.description || `${station.songIds.length} 首歌`,
      mood: station.mood || 'custom',
      targetEnergy: station.targetEnergy ?? 55,
      terms: station.terms ?? [],
      songIds: station.songIds,
      custom: true,
      createdAt: station.createdAt ?? null
    }));
}

export function allStations() {
  return [...stations, ...customStations()];
}

function scoreForStation(song, station, recentIds, preferenceSummary) {
  const terms = station.terms ?? [];
  const mood = Array.isArray(song.mood) ? song.mood : [];
  const haystack = `${song.title} ${song.artist} ${song.album} ${mood.join(' ')} ${song.playlistName ?? ''}`.toLowerCase();
  const termScore = terms.reduce((sum, term) => sum + (haystack.includes(term.toLowerCase()) ? 10 : 0), 0);
  const energyScore = Math.max(0, 22 - Math.abs(Number(song.energy ?? 50) - station.targetEnergy));
  const sourceScore = station.source && song.source === station.source ? 24 : 0;
  const recentPenalty = recentIds.has(song.id) ? -26 : 0;
  const likedArtist = preferenceSummary?.artists?.liked?.some((item) => item.label === song.artist) ? 8 : 0;
  const avoidedArtist = preferenceSummary?.artists?.avoided?.some((item) => item.label === song.artist) ? -14 : 0;
  const avoidedSong = preferenceSummary?.songs?.avoided?.some((item) => item.label === `${song.title} — ${song.artist}`) ? -30 : 0;
  return termScore + energyScore + sourceScore + recentPenalty + likedArtist + avoidedArtist + avoidedSong + Math.random();
}

export function stationQueue(stationId, limit = 18) {
  const station = allStations().find((item) => item.id === stationId) ?? stations[0];
  if (station.custom) {
    const queue = station.songIds
      .map((id) => getSong(id))
      .filter(Boolean)
      .slice(0, Math.max(1, Math.min(50, Number(limit) || 18)));
    return { station, queue };
  }

  const recentIds = new Set(recentPlays(24).map((item) => item.song_id));
  const preferenceSummary = getPreferenceSummary();
  const candidates = allSongs()
    .filter((song) => !station.source || song.source === station.source);
  const pool = candidates.length ? candidates : allSongs();
  const queue = pool
    .map((song) => ({ song, score: scoreForStation(song, station, recentIds, preferenceSummary) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.song)
    .filter((song, index, songs) => songs.findIndex((item) => item.id === song.id) === index)
    .slice(0, Math.max(1, Math.min(50, Number(limit) || 18)));

  return { station, queue };
}

export function setQueueAndMaybeCurrent(queue, current = queue[0] ?? null) {
  setPref('queue', queue);
  if (current) setPref('current', current);
}
