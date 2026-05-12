import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.CIKE_DATA_DIR || process.env.CLAUDIO_DATA_DIR || join(root, 'data');
const dbPath = join(dataDir, 'state.db');

mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    mood TEXT,
    action TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prefs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    action TEXT NOT NULL,
    mood TEXT,
    note TEXT,
    user_input TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS song_tags (
    song_id TEXT PRIMARY KEY,
    mood TEXT NOT NULL,
    energy INTEGER NOT NULL,
    note TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS external_songs (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    mood TEXT NOT NULL,
    energy INTEGER NOT NULL,
    url TEXT,
    lyric TEXT,
    playlist_id TEXT,
    playlist_name TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS external_playlists (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    creator TEXT,
    track_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    source TEXT,
    privacy INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('external_songs', 'playlist_id', 'TEXT');
ensureColumn('external_songs', 'playlist_name', 'TEXT');
ensureColumn('external_songs', 'hidden', 'INTEGER NOT NULL DEFAULT 0');

export function recordPlay(song, mood = 'unknown', action = 'play') {
  db.prepare(`
    INSERT INTO plays (song_id, title, artist, mood, action)
    VALUES (?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.artist, mood, action);
  maybePrunePlays();
}

const PLAYS_MAX_ROWS = Number(process.env.PLAYS_MAX_ROWS ?? 10_000);
let playsInsertCounter = 0;

function maybePrunePlays() {
  playsInsertCounter += 1;
  if (playsInsertCounter < 50) return;
  playsInsertCounter = 0;
  db.prepare(`
    DELETE FROM plays
    WHERE id IN (
      SELECT id FROM plays ORDER BY id DESC LIMIT -1 OFFSET ?
    )
  `).run(PLAYS_MAX_ROWS);
}

export function recentPlays(limit = 12) {
  return db.prepare(`
    SELECT song_id, title, artist, mood, action, created_at
    FROM plays
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

export function recordFeedback(song, { action, mood = 'unknown', note = '', userInput = '' } = {}) {
  const duplicate = db.prepare(`
    SELECT id
    FROM feedback
    WHERE song_id = ? AND action = ? AND COALESCE(note, '') = COALESCE(?, '')
      AND created_at >= datetime('now', '-30 seconds')
    ORDER BY id DESC
    LIMIT 1
  `).get(song.id, action, note);
  if (duplicate) return false;

  db.prepare(`
    INSERT INTO feedback (song_id, title, artist, action, mood, note, user_input)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.artist, action, mood, note, userInput);
  refreshPreferenceSummary();
  return true;
}

export function dedupePlaybackFailureFeedback() {
  const result = db.prepare(`
    DELETE FROM feedback
    WHERE action = 'bad-fit'
      AND note = '播放失败或没有可用音频地址'
      AND id NOT IN (
        SELECT MAX(id)
        FROM feedback
        WHERE action = 'bad-fit'
          AND note = '播放失败或没有可用音频地址'
        GROUP BY song_id
      )
  `).run();
  refreshPreferenceSummary();
  return result.changes ?? 0;
}

export function recentFeedback(limit = 16) {
  return db.prepare(`
    SELECT song_id, title, artist, action, mood, note, user_input, created_at
    FROM feedback
    ORDER BY id DESC
    LIMIT ?
  `).all(limit);
}

function normalizeTerms(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizeTerms(item));
  }

  const text = String(value ?? '').trim();
  if (!text) return [];

  return text
    .split(/[,\s/|]+/)
    .map((item) => item.trim())
    .filter((item) => item && !['unknown', 'open', 'none'].includes(item.toLowerCase()))
    .slice(0, 8);
}

function detectSceneTerms(text = '') {
  const lower = String(text).toLowerCase();
  const terms = [];

  if (/工作|专注|focus|work/.test(lower)) terms.push('focus');
  if (/累|困|疲|sleep|rest/.test(lower)) terms.push('low-energy');
  if (/早|morning/.test(lower)) terms.push('morning');
  if (/夜|晚|night/.test(lower)) terms.push('night');
  if (/开心|朋友|social/.test(lower)) terms.push('social');

  return terms;
}

function bumpScore(map, key, delta) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + delta);
}

function rankedEntries(map, limit = 3, direction = 'desc') {
  return [...map.entries()]
    .filter(([, score]) => score !== 0)
    .sort((a, b) => direction === 'asc' ? a[1] - b[1] : b[1] - a[1])
    .slice(0, limit)
    .map(([label, score]) => ({ label, score }));
}

function buildPreferenceLine(title, entries, fallback) {
  if (!entries.length) return fallback;
  return `${title}：${entries.map((item) => item.label).join('、')}。`;
}

export function buildPreferenceSummary(feedbackRows = recentFeedback(80)) {
  const counts = { like: 0, skip: 0, badFit: 0, total: 0 };
  const songScores = new Map();
  const artistScores = new Map();
  const moodScores = new Map();
  const sceneScores = new Map();

  for (const row of feedbackRows) {
    const action = row.action === 'like' || row.action === 'skip' || row.action === 'bad-fit'
      ? row.action
      : 'bad-fit';
    const delta = action === 'like' ? 2 : action === 'skip' ? -2 : -3;

    counts.total += 1;
    counts[action === 'bad-fit' ? 'badFit' : action] += 1;

    bumpScore(songScores, `${row.title} — ${row.artist}`, delta);
    bumpScore(artistScores, row.artist, delta);

    for (const mood of normalizeTerms(row.mood)) {
      bumpScore(moodScores, mood, delta);
    }

    for (const scene of detectSceneTerms(row.user_input || row.mood || '')) {
      bumpScore(sceneScores, scene, delta);
    }
  }

  const likedSongs = rankedEntries(songScores, 4).filter((item) => item.score > 0);
  const avoidedSongs = rankedEntries(songScores, 4, 'asc').filter((item) => item.score < 0);
  const likedArtists = rankedEntries(artistScores, 4).filter((item) => item.score > 0);
  const avoidedArtists = rankedEntries(artistScores, 4, 'asc').filter((item) => item.score < 0);
  const likedMoods = rankedEntries(moodScores, 4).filter((item) => item.score > 0);
  const avoidedMoods = rankedEntries(moodScores, 4, 'asc').filter((item) => item.score < 0);
  const likedScenes = rankedEntries(sceneScores, 4).filter((item) => item.score > 0);
  const avoidedScenes = rankedEntries(sceneScores, 4, 'asc').filter((item) => item.score < 0);

  const summaryLines = [
    counts.total
      ? `反馈：喜欢 ${counts.like}，跳过 ${counts.skip}，不合适 ${counts.badFit}。`
      : '还没有足够反馈，先按当前歌库默认推荐。',
    buildPreferenceLine('更合拍的场景', likedScenes, '更合拍的场景还没跑出来。'),
    buildPreferenceLine('偏好的标签', likedMoods, '偏好的标签还不够明显。'),
    buildPreferenceLine('常被喜欢的歌', likedSongs, '常被喜欢的歌还没形成。'),
    buildPreferenceLine('常被避开的歌', avoidedSongs, '常被避开的歌还没形成。')
  ];

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    analyzedFeedback: feedbackRows.length,
    counts,
    songs: {
      liked: likedSongs,
      avoided: avoidedSongs
    },
    artists: {
      liked: likedArtists,
      avoided: avoidedArtists
    },
    moods: {
      liked: likedMoods,
      avoided: avoidedMoods
    },
    scenes: {
      liked: likedScenes,
      avoided: avoidedScenes
    },
    summaryText: summaryLines.join('\n')
  };
}

export function refreshPreferenceSummary() {
  const summary = buildPreferenceSummary();
  setPref('preference_summary', summary);
  return summary;
}

export function getPreferenceSummary() {
  const existing = getPref('preference_summary', null);
  if (existing) return existing;

  const feedback = recentFeedback(80);
  if (!feedback.length) return null;

  const summary = buildPreferenceSummary(feedback);
  setPref('preference_summary', summary);
  return summary;
}

export function getSongTags(songId) {
  const row = db.prepare(`
    SELECT song_id, mood, energy, note, updated_at
    FROM song_tags
    WHERE song_id = ?
  `).get(songId);
  if (!row) return null;
  return {
    songId: row.song_id,
    mood: JSON.parse(row.mood),
    energy: row.energy,
    note: row.note ?? '',
    updatedAt: row.updated_at
  };
}

export function setSongTags(songId, { mood, energy, note = '' }) {
  db.prepare(`
    INSERT INTO song_tags (song_id, mood, energy, note, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(song_id) DO UPDATE SET
      mood = excluded.mood,
      energy = excluded.energy,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
  `).run(songId, JSON.stringify(mood), energy, note);
  return getSongTags(songId);
}

export function saveExternalSong(song) {
  db.prepare(`
    INSERT INTO external_songs (
      id, provider, provider_id, title, artist, album, mood, energy, url, lyric,
      playlist_id, playlist_name, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      mood = excluded.mood,
      energy = excluded.energy,
      url = excluded.url,
      lyric = excluded.lyric,
      playlist_id = COALESCE(excluded.playlist_id, external_songs.playlist_id),
      playlist_name = COALESCE(excluded.playlist_name, external_songs.playlist_name),
      updated_at = CURRENT_TIMESTAMP
  `).run(
    song.id,
    song.provider,
    String(song.providerId),
    song.title,
    song.artist,
    song.album ?? '',
    JSON.stringify(song.mood),
    song.energy,
    song.url ?? null,
    JSON.stringify(song.lyric ?? []),
    song.playlistId ?? null,
    song.playlistName ?? null
  );
  return getExternalSong(song.id);
}

export function externalSongs(limit = 1000) {
  return db.prepare(`
    SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric, playlist_id, playlist_name, hidden
    FROM external_songs
    WHERE hidden = 0
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit).map(rowToExternalSong);
}

export function libraryStats() {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS imported,
      SUM(CASE WHEN hidden = 1 THEN 1 ELSE 0 END) AS hidden,
      SUM(CASE WHEN url IS NULL OR url = '' THEN 1 ELSE 0 END) AS missingUrl,
      COUNT(DISTINCT playlist_id) AS playlistCount
    FROM external_songs
  `).get();
  const duplicateGroups = db.prepare(`
    SELECT title, artist, COUNT(*) AS count
    FROM external_songs
    WHERE hidden = 0
    GROUP BY lower(title), lower(artist)
    HAVING COUNT(*) > 1
    ORDER BY count DESC, title ASC
    LIMIT 12
  `).all();
  const playlists = db.prepare(`
    SELECT playlist_id, playlist_name, COUNT(*) AS count,
      SUM(CASE WHEN url IS NULL OR url = '' THEN 1 ELSE 0 END) AS missingUrl
    FROM external_songs
    WHERE playlist_id IS NOT NULL AND playlist_id != '' AND hidden = 0
    GROUP BY playlist_id, playlist_name
    ORDER BY count DESC
    LIMIT 20
  `).all();

  return {
    imported: totals.imported ?? 0,
    hidden: totals.hidden ?? 0,
    missingUrl: totals.missingUrl ?? 0,
    playlistCount: totals.playlistCount ?? 0,
    duplicateGroups,
    playlists
  };
}

export function deleteExternalSongsWithoutUrl() {
  const result = db.prepare(`
    DELETE FROM external_songs
    WHERE url IS NULL OR url = ''
  `).run();
  return result.changes ?? 0;
}

export function duplicateGroups() {
  const groups = db.prepare(`
    SELECT lower(title) AS title_key, lower(artist) AS artist_key, title, artist, COUNT(*) AS count
    FROM external_songs
    GROUP BY lower(title), lower(artist)
    HAVING COUNT(*) > 1
    ORDER BY count DESC, title ASC
    LIMIT 30
  `).all();

  return groups.map((group) => ({
    title: group.title,
    artist: group.artist,
    count: group.count,
    songs: db.prepare(`
      SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric,
        playlist_id, playlist_name, hidden
      FROM external_songs
      WHERE lower(title) = ? AND lower(artist) = ?
      ORDER BY hidden ASC, updated_at DESC
    `).all(group.title_key, group.artist_key).map(rowToExternalSong)
  }));
}

export function hideDuplicateSiblings(keepId) {
  const keep = db.prepare(`
    SELECT lower(title) AS title_key, lower(artist) AS artist_key
    FROM external_songs
    WHERE id = ?
  `).get(keepId);
  if (!keep) return 0;

  const result = db.prepare(`
    UPDATE external_songs
    SET hidden = CASE WHEN id = ? THEN 0 ELSE 1 END,
      updated_at = CURRENT_TIMESTAMP
    WHERE lower(title) = ? AND lower(artist) = ?
  `).run(keepId, keep.title_key, keep.artist_key);
  return result.changes ?? 0;
}

export function unhideDuplicateGroup(songId) {
  const song = db.prepare(`
    SELECT lower(title) AS title_key, lower(artist) AS artist_key
    FROM external_songs
    WHERE id = ?
  `).get(songId);
  if (!song) return 0;

  const result = db.prepare(`
    UPDATE external_songs
    SET hidden = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE lower(title) = ? AND lower(artist) = ?
  `).run(song.title_key, song.artist_key);
  return result.changes ?? 0;
}

export function externalSongsByPlaylist(playlistId, limit = 1000) {
  return db.prepare(`
    SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric, playlist_id, playlist_name, hidden
    FROM external_songs
    WHERE playlist_id = ? AND hidden = 0
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(String(playlistId), limit).map(rowToExternalSong);
}

export function getExternalSong(id) {
  const row = db.prepare(`
    SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric, playlist_id, playlist_name, hidden
    FROM external_songs
    WHERE id = ?
  `).get(id);
  return row ? rowToExternalSong(row) : null;
}

export function saveExternalPlaylist(playlist, importedCount = 0) {
  db.prepare(`
    INSERT INTO external_playlists (
      id, provider, provider_id, name, creator, track_count, imported_count, source, privacy, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      creator = excluded.creator,
      track_count = excluded.track_count,
      imported_count = excluded.imported_count,
      source = excluded.source,
      privacy = excluded.privacy,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    `netease-playlist-${playlist.id}`,
    'netease',
    String(playlist.id),
    playlist.name,
    playlist.creator ?? '',
    Number(playlist.trackCount ?? 0),
    Number(importedCount ?? 0),
    playlist.source ?? 'playlist',
    Number(playlist.privacy ?? 0)
  );
  return getExternalPlaylist(playlist.id);
}

export function externalPlaylists() {
  return db.prepare(`
    SELECT id, provider, provider_id, name, creator, track_count, imported_count, source, privacy, updated_at
    FROM external_playlists
    ORDER BY updated_at DESC
  `).all().map(rowToExternalPlaylist);
}

export function getExternalPlaylist(id) {
  const normalizedId = String(id).startsWith('netease-playlist-') ? String(id) : `netease-playlist-${id}`;
  const row = db.prepare(`
    SELECT id, provider, provider_id, name, creator, track_count, imported_count, source, privacy, updated_at
    FROM external_playlists
    WHERE id = ?
  `).get(normalizedId);
  return row ? rowToExternalPlaylist(row) : null;
}

export function exportSnapshot() {
  return {
    exportedAt: new Date().toISOString(),
    prefs: db.prepare(`
      SELECT key, value, updated_at
      FROM prefs
      ORDER BY key ASC
    `).all(),
    playlists: externalPlaylists(),
    songTags: db.prepare(`
      SELECT song_id, mood, energy, note, updated_at
      FROM song_tags
      ORDER BY updated_at DESC
    `).all(),
    recentPlays: recentPlays(200),
    recentFeedback: recentFeedback(200),
    preferenceSummary: getPreferenceSummary(),
    libraryStats: libraryStats()
  };
}

function rowToExternalSong(row) {
  return {
    id: row.id,
    source: row.provider,
    provider: row.provider,
    providerId: row.provider_id,
    title: row.title,
    artist: row.artist,
    album: row.album || 'External',
    mood: JSON.parse(row.mood),
    energy: row.energy,
    color: '#c93f3f',
    cover: 'linear-gradient(135deg, #170808, #c93f3f 54%, #f4ead8)',
    url: row.url,
    lyric: JSON.parse(row.lyric),
    playlistId: row.playlist_id ?? null,
    playlistName: row.playlist_name ?? null,
    hidden: Boolean(row.hidden)
  };
}

function rowToExternalPlaylist(row) {
  return {
    id: row.id,
    provider: row.provider,
    providerId: row.provider_id,
    name: row.name,
    creator: row.creator ?? '',
    trackCount: row.track_count,
    importedCount: row.imported_count,
    source: row.source ?? 'playlist',
    privacy: row.privacy,
    updatedAt: row.updated_at
  };
}

export function setPref(key, value) {
  db.prepare(`
    INSERT INTO prefs (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(key, JSON.stringify(value));
}

export function getPref(key, fallback = null) {
  const row = db.prepare('SELECT value FROM prefs WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function insightsSummary({ days = 7 } = {}) {
  const since = `-${Math.max(1, Math.min(90, Number(days) || 7))} days`;
  const totals = db.prepare(`
    SELECT COUNT(*) AS plays,
      COUNT(DISTINCT song_id) AS unique_songs,
      COUNT(DISTINCT artist) AS unique_artists
    FROM plays
    WHERE action = 'play' AND created_at >= datetime('now', ?)
  `).get(since);

  const topArtists = db.prepare(`
    SELECT artist, COUNT(*) AS plays
    FROM plays
    WHERE action = 'play' AND created_at >= datetime('now', ?)
    GROUP BY artist
    ORDER BY plays DESC
    LIMIT 6
  `).all(since);

  const topMoods = db.prepare(`
    SELECT mood, COUNT(*) AS plays
    FROM plays
    WHERE action = 'play' AND created_at >= datetime('now', ?)
      AND mood IS NOT NULL AND mood != '' AND mood != 'unknown'
    GROUP BY mood
    ORDER BY plays DESC
    LIMIT 5
  `).all(since);

  const hourBuckets = db.prepare(`
    SELECT strftime('%H', created_at, 'localtime') AS hour, COUNT(*) AS plays
    FROM plays
    WHERE action = 'play' AND created_at >= datetime('now', ?)
    GROUP BY hour
    ORDER BY hour ASC
  `).all(since);

  const feedbackTotals = db.prepare(`
    SELECT action, COUNT(*) AS count
    FROM feedback
    WHERE created_at >= datetime('now', ?)
    GROUP BY action
  `).all(since);

  const feedbackMap = Object.fromEntries(feedbackTotals.map((row) => [row.action, row.count]));

  return {
    days: Math.max(1, Math.min(90, Number(days) || 7)),
    totals: {
      plays: totals.plays ?? 0,
      uniqueSongs: totals.unique_songs ?? 0,
      uniqueArtists: totals.unique_artists ?? 0
    },
    topArtists,
    topMoods,
    hourBuckets,
    feedbackTotals: {
      like: feedbackMap.like ?? 0,
      skip: feedbackMap.skip ?? 0,
      badFit: feedbackMap['bad-fit'] ?? 0
    }
  };
}
