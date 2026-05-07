import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = join(root, 'data', 'state.db');

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
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

export function recordPlay(song, mood = 'unknown', action = 'play') {
  db.prepare(`
    INSERT INTO plays (song_id, title, artist, mood, action)
    VALUES (?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.artist, mood, action);
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
  db.prepare(`
    INSERT INTO feedback (song_id, title, artist, action, mood, note, user_input)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(song.id, song.title, song.artist, action, mood, note, userInput);
  refreshPreferenceSummary();
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
    buildPreferenceLine('更稳的场景', likedScenes, '更稳的场景还没跑出来。'),
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
    INSERT INTO external_songs (id, provider, provider_id, title, artist, album, mood, energy, url, lyric, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      mood = excluded.mood,
      energy = excluded.energy,
      url = excluded.url,
      lyric = excluded.lyric,
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
    JSON.stringify(song.lyric ?? [])
  );
  return getExternalSong(song.id);
}

export function externalSongs(limit = 100) {
  return db.prepare(`
    SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric
    FROM external_songs
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(limit).map(rowToExternalSong);
}

export function getExternalSong(id) {
  const row = db.prepare(`
    SELECT id, provider, provider_id, title, artist, album, mood, energy, url, lyric
    FROM external_songs
    WHERE id = ?
  `).get(id);
  return row ? rowToExternalSong(row) : null;
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
    lyric: JSON.parse(row.lyric)
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
