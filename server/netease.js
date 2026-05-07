import { saveExternalSong } from './db.js';

export function hasNeteaseProvider() {
  return Boolean(process.env.NETEASE_API_BASE);
}

function baseUrl() {
  return process.env.NETEASE_API_BASE?.replace(/\/+$/, '');
}

async function neteaseGet(path, params = {}) {
  if (!hasNeteaseProvider()) throw new Error('NETEASE_API_BASE is not configured');
  const url = new URL(`${baseUrl()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || data.code >= 400) {
    throw new Error(data.message ?? `NetEase API failed with ${response.status}`);
  }
  return data;
}

function artistsOf(song) {
  const artists = song.ar ?? song.artists ?? [];
  return artists.map((artist) => artist.name).filter(Boolean).join(' / ') || 'NetEase Artist';
}

function albumOf(song) {
  return song.al?.name ?? song.album?.name ?? 'NetEase';
}

export function normalizeNeteaseSong(song, extra = {}) {
  const providerId = String(song.id);
  return {
    id: `netease-${providerId}`,
    source: 'netease',
    provider: 'netease',
    providerId,
    title: song.name,
    artist: artistsOf(song),
    album: albumOf(song),
    mood: extra.mood ?? ['netease', 'open'],
    energy: extra.energy ?? 55,
    color: '#c93f3f',
    cover: 'linear-gradient(135deg, #170808, #c93f3f 54%, #f4ead8)',
    url: extra.url ?? null,
    lyric: extra.lyric ?? ['NetEase Cloud Music']
  };
}

export async function searchNetease(query, limit = 10) {
  const data = await neteaseGet('/search', {
    keywords: query,
    type: 1,
    limit,
    offset: 0
  });
  return (data.result?.songs ?? []).map((song) => normalizeNeteaseSong(song));
}

export async function neteaseSongUrl(id) {
  const providerId = String(id).replace(/^netease-/, '');
  try {
    const data = await neteaseGet('/song/url/v1', {
      id: providerId,
      level: process.env.NETEASE_LEVEL ?? 'exhigh'
    });
    return data.data?.[0]?.url ?? null;
  } catch {
    const data = await neteaseGet('/song/url', { id: providerId });
    return data.data?.[0]?.url ?? null;
  }
}

export async function neteaseLyric(id) {
  const providerId = String(id).replace(/^netease-/, '');
  const data = await neteaseGet('/lyric', { id: providerId });
  const raw = data.lrc?.lyric ?? '';
  const lines = raw.split(/\r?\n/)
    .map((line) => line.replace(/\[[^\]]+\]/g, '').trim())
    .filter(Boolean);
  return lines.length ? lines : ['NetEase lyric unavailable'];
}

export async function importNeteaseSong(song) {
  const url = await neteaseSongUrl(song.providerId ?? song.id);
  const lyric = await neteaseLyric(song.providerId ?? song.id).catch(() => ['NetEase lyric unavailable']);
  return saveExternalSong({
    ...song,
    id: song.id.startsWith('netease-') ? song.id : `netease-${song.id}`,
    provider: 'netease',
    providerId: song.providerId ?? String(song.id).replace(/^netease-/, ''),
    source: 'netease',
    url,
    lyric
  });
}
