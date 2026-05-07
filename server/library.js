import { createReadStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { getSongTags } from './db.js';

const projectLibrary = join(process.cwd(), 'library');
const defaultRoots = [projectLibrary, join(homedir(), 'Music')];
const audioExts = new Set(['.mp3', '.m4a', '.wav', '.flac', '.aac', '.ogg']);
const colors = ['#e8704e', '#87b38d', '#d7b85d', '#5a9fd6', '#d66b8b', '#cfc7b0'];

mkdirSync(projectLibrary, { recursive: true });

let cache = null;

function roots() {
  const envRoots = process.env.MUSIC_DIRS?.split(':').map((item) => item.trim()).filter(Boolean);
  return envRoots?.length ? envRoots : defaultRoots;
}

function walk(dir, files = []) {
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) walk(path, files);
      continue;
    }
    if (entry.isFile() && audioExts.has(extname(entry.name).toLowerCase())) {
      files.push(path);
    }
  }

  return files;
}

function parseName(path) {
  const raw = path.split('/').pop().replace(/\.[^.]+$/, '');
  const cleaned = raw.replace(/^\d+\s*[-_.]\s*/, '').replace(/_/g, ' ').trim();
  const parts = cleaned.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { artist: 'Local Library', title: cleaned || 'Untitled Track' };
}

function moodFromName(name) {
  const lower = name.toLowerCase();
  if (/sleep|ambient|piano|calm|quiet|夜|睡|钢琴|安静/.test(lower)) return ['quiet', 'rest', 'soft'];
  if (/work|focus|study|lofi|专注|学习|工作/.test(lower)) return ['focus', 'work', 'calm'];
  if (/dance|club|run|drive|燃|跑|电音/.test(lower)) return ['drive', 'clean'];
  return ['local', 'open'];
}

function songFromPath(path, index) {
  const { artist, title } = parseName(path);
  const id = `local-${createHash('sha1').update(path).digest('hex').slice(0, 16)}`;
  const color = colors[index % colors.length];
  const ext = extname(path).toLowerCase();
  const tags = getSongTags(id);
  return {
    id,
    source: 'local',
    title,
    artist,
    album: 'Local Files',
    mood: tags?.mood ?? moodFromName(`${title} ${artist} ${path}`),
    energy: tags?.energy ?? 45 + (index * 13) % 45,
    note: tags?.note ?? '',
    color,
    cover: `linear-gradient(135deg, #080b09, ${color} 54%, #f4ead8)`,
    url: `/api/audio?id=${encodeURIComponent(id)}`,
    path,
    ext,
    lyric: ['Local file', 'Ready from Claudio library']
  };
}

export function scanLibrary({ refresh = false } = {}) {
  if (cache && !refresh) return cache;

  const seen = new Set();
  const files = [];
  for (const root of roots()) {
    for (const file of walk(root)) {
      if (!seen.has(file)) {
        seen.add(file);
        files.push(file);
      }
    }
  }

  cache = files.map(songFromPath);
  return cache;
}

export function getLibrarySong(id) {
  return scanLibrary().find((song) => song.id === id) ?? null;
}

export function libraryInfo() {
  return {
    roots: roots(),
    writableImportDir: projectLibrary,
    count: scanLibrary().length,
    songs: scanLibrary().map(({ path, ...song }) => song)
  };
}

export function streamAudio(req, res, song) {
  if (!song?.path || !existsSync(song.path)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Audio file not found' }));
    return;
  }

  const size = statSync(song.path).size;
  const range = req.headers.range;
  const contentType = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.ogg': 'audio/ogg'
  }[song.ext] ?? 'application/octet-stream';

  if (!range) {
    res.writeHead(200, {
      'content-length': size,
      'content-type': contentType,
      'accept-ranges': 'bytes'
    });
    createReadStream(song.path).pipe(res);
    return;
  }

  const [startRaw, endRaw] = range.replace(/bytes=/, '').split('-');
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : size - 1;

  res.writeHead(206, {
    'content-range': `bytes ${start}-${end}/${size}`,
    'accept-ranges': 'bytes',
    'content-length': end - start + 1,
    'content-type': contentType
  });
  createReadStream(song.path, { start, end }).pipe(res);
}
