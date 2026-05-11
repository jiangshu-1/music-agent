import { externalPlaylists, getExternalSong, saveExternalPlaylist, saveExternalSong } from './db.js';
import { externalError, runExternal } from './resilience.js';

export function hasNeteaseProvider() {
  return Boolean(process.env.NETEASE_API_BASE);
}

function baseUrl() {
  return process.env.NETEASE_API_BASE?.replace(/\/+$/, '');
}

async function neteaseGet(path, params = {}) {
  if (!hasNeteaseProvider()) throw new Error('还没有配置网易云接口 NETEASE_API_BASE');
  const url = new URL(`${baseUrl()}${path}`);
  const query = {
    ...params,
    cookie: process.env.NETEASE_COOKIE || params.cookie,
    realIP: process.env.NETEASE_REAL_IP || params.realIP
  };
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  return runExternal('netease', async ({ signal }) => {
    const response = await fetch(url, { signal });
    const data = await response.json();
    if (!response.ok || data.code >= 400) {
      const status = Number(data.code ?? response.status);
      const kind = status >= 500 ? 'http_5xx' : 'http_4xx';
      throw externalError(data.message ?? `网易云接口请求失败，状态码 ${response.status}`, kind);
    }
    return data;
  });
}

function artistsOf(song) {
  const artists = song.ar ?? song.artists ?? [];
  return artists.map((artist) => artist.name).filter(Boolean).join(' / ') || 'NetEase Artist';
}

function albumOf(song) {
  return song.al?.name ?? song.album?.name ?? 'NetEase';
}

function normalizePlaylist(playlist, source = 'user') {
  return {
    id: String(playlist.id),
    source,
    name: playlist.name ?? `网易云歌单 ${playlist.id}`,
    description: playlist.description ?? '',
    creator: playlist.creator?.nickname ?? '',
    trackCount: playlist.trackCount ?? playlist.trackIds?.length ?? playlist.tracks?.length ?? 0,
    subscribed: Boolean(playlist.subscribed),
    privacy: playlist.privacy ?? 0,
    playCount: playlist.playCount ?? 0,
    updateTime: playlist.updateTime ?? null
  };
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
    lyric: extra.lyric ?? ['NetEase Cloud Music'],
    playlistId: extra.playlistId ?? null,
    playlistName: extra.playlistName ?? null
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

export function neteaseUserId(input = process.env.NETEASE_USER_ID) {
  const text = String(input ?? '').trim();
  if (!text) return '';
  const decoded = decodeURIComponent(text);
  const idFromQuery = decoded.match(/[?&](?:id|uid)=(\d+)/)?.[1];
  const idOnly = decoded.match(/^\d+$/)?.[0];
  return idFromQuery ?? idOnly ?? '';
}

export async function userNeteasePlaylists({ uid = process.env.NETEASE_USER_ID, limit = 100, offset = 0 } = {}) {
  const userId = neteaseUserId(uid);
  if (!userId) throw new Error('请先在 .env 配置 NETEASE_USER_ID，或输入网易云用户 ID');

  const data = await neteaseGet('/user/playlist', {
    uid: userId,
    limit: Math.max(1, Math.min(200, Number(limit) || 100)),
    offset: Math.max(0, Number(offset) || 0)
  });
  return {
    uid: userId,
    playlists: (data.playlist ?? []).map((playlist) => normalizePlaylist(
      playlist,
      playlist.subscribed ? 'collected' : 'created'
    ))
  };
}

export function neteasePlaylistId(input) {
  const text = String(input ?? '').trim();
  if (!text) return '';
  const decoded = decodeURIComponent(text);
  const idFromQuery = decoded.match(/[?&]id=(\d+)/)?.[1];
  const idFromPath = decoded.match(/(?:playlist|歌单)\/?(\d+)/i)?.[1];
  const idOnly = decoded.match(/^\d+$/)?.[0];
  return idFromQuery ?? idFromPath ?? idOnly ?? '';
}

export async function neteasePlaylistDetail(input) {
  const id = neteasePlaylistId(input);
  if (!id) throw new Error('请输入网易云歌单链接或歌单 ID');

  const data = await neteaseGet('/playlist/detail', { id });
  const playlist = data.playlist ?? {};
  const tracks = playlist.tracks ?? [];
  return {
    ...normalizePlaylist({ ...playlist, id }, 'playlist'),
    songs: tracks.map((song) => normalizeNeteaseSong(song, {
      mood: ['netease', 'playlist', playlist.name].filter(Boolean),
      energy: 55,
      playlistId: String(playlist.id ?? id),
      playlistName: playlist.name ?? `网易云歌单 ${id}`
    }))
  };
}

export async function neteasePlaylistTracks(input, { limit = 200, offset = 0 } = {}) {
  const id = neteasePlaylistId(input);
  if (!id) throw new Error('请输入网易云歌单链接或歌单 ID');

  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const data = await neteaseGet('/playlist/track/all', {
    id,
    limit: safeLimit,
    offset: safeOffset
  });
  const songs = data.songs ?? data.body?.songs ?? [];
  return songs.map((song) => normalizeNeteaseSong(song, {
    mood: ['netease', 'playlist'],
    energy: 55
  }));
}

export async function neteaseSongUrls(ids) {
  const providerIds = ids.map((id) => String(id).replace(/^netease-/, '')).filter(Boolean);
  if (!providerIds.length) return new Map();

  try {
    const data = await neteaseGet('/song/url/v1', {
      id: providerIds.join(','),
      level: process.env.NETEASE_LEVEL ?? 'exhigh'
    });
    return new Map((data.data ?? []).map((item) => [String(item.id), item.url ?? null]));
  } catch {
    const data = await neteaseGet('/song/url', { id: providerIds.join(',') });
    return new Map((data.data ?? []).map((item) => [String(item.id), item.url ?? null]));
  }
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

export async function neteaseTimedLyric(id) {
  const providerId = String(id).replace(/^netease-/, '');
  const data = await neteaseGet('/lyric', { id: providerId });
  const raw = data.lrc?.lyric ?? '';
  const lines = [];

  for (const row of raw.split(/\r?\n/)) {
    const matches = [...row.matchAll(/\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g)];
    const text = row.replace(/\[[^\]]+\]/g, '').trim();
    if (!matches.length || !text) continue;

    for (const match of matches) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? '0').padEnd(3, '0'));
      lines.push({
        time: minutes * 60 + seconds + fraction / 1000,
        text
      });
    }
  }

  return lines.sort((a, b) => a.time - b.time);
}

export async function importNeteaseSong(song) {
  const url = await neteaseSongUrl(song.providerId ?? song.id);
  const lyric = await neteaseTimedLyric(song.providerId ?? song.id)
    .then((lines) => lines.length ? lines : ['暂时没有拿到网易云歌词'])
    .catch(() => ['暂时没有拿到网易云歌词']);
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

export async function importNeteasePlaylist(input, { limit = 200 } = {}) {
  const playlist = await neteasePlaylistDetail(input);
  const targetLimit = Math.max(1, Math.min(2000, Number(limit) || 200));
  const imported = [];

  for (let offset = 0; offset < targetLimit; offset += 100) {
    const chunkLimit = Math.min(100, targetLimit - offset);
    const songs = await neteasePlaylistTracks(playlist.id, { limit: chunkLimit, offset });
    if (!songs.length) break;

    const urls = await neteaseSongUrls(songs.map((song) => song.providerId));
    for (const song of songs) {
      imported.push(saveExternalSong({
        ...song,
        mood: ['netease', 'playlist', playlist.name].filter(Boolean),
        url: urls.get(song.providerId) ?? song.url ?? null,
        lyric: [`来自网易云歌单：${playlist.name}`],
        playlistId: playlist.id,
        playlistName: playlist.name
      }));
    }

    if (songs.length < chunkLimit) break;
  }

  saveExternalPlaylist(playlist, imported.length);

  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      creator: playlist.creator,
      trackCount: playlist.trackCount,
      importedCount: imported.length
    },
    imported
  };
}

/**
 * Re-fetch every imported NetEase playlist and pull in any new tracks that
 * are not yet in external_songs. Returns a summary with per-playlist deltas.
 */
export async function syncImportedPlaylists({ chunkLimit = 200, onProgress } = {}) {
  if (!hasNeteaseProvider()) {
    return { skipped: true, reason: 'missing NETEASE_API_BASE', playlists: [] };
  }
  const targetChunk = Math.max(50, Math.min(500, Number(chunkLimit) || 200));
  const playlists = externalPlaylists();
  const results = [];

  for (const playlist of playlists) {
    const providerId = playlist.providerId;
    try {
      const remoteDetail = await neteasePlaylistDetail(providerId);
      const remoteTrackCount = Number(remoteDetail.trackCount ?? 0);
      const added = [];

      for (let offset = 0; offset < remoteTrackCount; offset += targetChunk) {
        const chunkSize = Math.min(targetChunk, remoteTrackCount - offset);
        const songs = await neteasePlaylistTracks(providerId, {
          limit: chunkSize,
          offset
        });
        if (!songs.length) break;

        const fresh = songs.filter((song) => !getExternalSong(song.id));
        if (fresh.length) {
          const urls = await neteaseSongUrls(fresh.map((song) => song.providerId));
          for (const song of fresh) {
            const saved = saveExternalSong({
              ...song,
              mood: ['netease', 'playlist', remoteDetail.name].filter(Boolean),
              url: urls.get(song.providerId) ?? null,
              lyric: [`来自网易云歌单：${remoteDetail.name}`],
              playlistId: String(providerId),
              playlistName: remoteDetail.name
            });
            added.push(saved);
          }
        }

        // Stop early only when the remote actually returned fewer items than
        // we asked for — that means we've reached the tail of the playlist.
        if (songs.length < chunkSize) break;
      }

      // Update the playlist's imported_count and remote track count.
      saveExternalPlaylist(
        {
          id: providerId,
          name: remoteDetail.name,
          creator: remoteDetail.creator,
          trackCount: remoteTrackCount,
          source: playlist.source ?? remoteDetail.source,
          privacy: remoteDetail.privacy
        },
        playlist.importedCount + added.length
      );

      const summary = {
        id: providerId,
        name: remoteDetail.name,
        added: added.length,
        remoteTrackCount,
        ok: true
      };
      results.push(summary);
      if (onProgress) onProgress(summary);
    } catch (error) {
      const summary = {
        id: providerId,
        name: playlist.name,
        added: 0,
        error: error.message,
        ok: false
      };
      results.push(summary);
      if (onProgress) onProgress(summary);
    }
  }

  return {
    syncedAt: new Date().toISOString(),
    playlists: results,
    totalAdded: results.reduce((sum, item) => sum + item.added, 0)
  };
}
