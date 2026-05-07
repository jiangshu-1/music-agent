import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { buildContext } from './context.js';
import { allSongs, getLyric, getSong, searchSongs, toClientSong, toClientSongs } from './music.js';
import { planNext } from './brain.js';
import { getPref, getPreferenceSummary, recordFeedback, recordPlay, recentFeedback, recentPlays, setPref, setSongTags } from './db.js';
import { discoverDevices, playOnDevice } from './upnp.js';
import { getLibrarySong, libraryInfo, scanLibrary, streamAudio } from './library.js';
import { localAddresses } from './network.js';
import { hasNeteaseProvider, importNeteaseSong, searchNetease } from './netease.js';
import { fishTts, hasFishKey } from './tts.js';

const root = process.cwd();
const webRoot = join(root, 'web');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const noStoreExts = new Set(['.html', '.css', '.js']);

function json(res, data, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error('Payload too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = normalize(join(webRoot, requested));

  if (!filePath.startsWith(webRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const ext = extname(filePath);
    const file = readFileSync(filePath);
    const headers = { 'content-type': mime[ext] ?? 'application/octet-stream' };
    if (noStoreExts.has(ext)) headers['cache-control'] = 'no-store';
    res.writeHead(200, headers);
    res.end(file);
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  }
}

export async function route(req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/now' && req.method === 'GET') {
    scanLibrary({ refresh: true });
    const songs = allSongs();
    const fallback = songs[0];
    const savedCurrent = getPref('current', fallback);
    const savedQueue = getPref('queue', songs.slice(0, 3));
    
    const current = getSong(savedCurrent?.id ?? fallback?.id);
    let queue = (savedQueue || []).map((song) => getSong(song.id)).filter(Boolean);
    
    if (!queue.length && songs.length) {
      queue = songs.slice(0, 3);
    }

    return json(res, {
      current: toClientSong(current || fallback),
      queue: toClientSongs(queue.length ? queue : (fallback ? [fallback] : [])),
      recent: recentPlays(8),
      feedback: recentFeedback(8),
      preferenceSummary: getPreferenceSummary()
    });
  }

  if (url.pathname === '/api/chat' && req.method === 'POST') {
    const body = await readBody(req);
    const plan = await planNext(body.message ?? '');
    setPref('current', plan.queue[0]);
    setPref('queue', plan.queue);
    recordPlay(plan.queue[0], plan.mood, 'plan');
    return json(res, { ...plan, queue: toClientSongs(plan.queue) });
  }

  if (url.pathname === '/api/play' && req.method === 'POST') {
    const body = await readBody(req);
    const song = getSong(body.id);
    setPref('current', song);
    recordPlay(song, body.mood ?? 'manual', 'play');
    return json(res, { current: toClientSong(song) });
  }

  if (url.pathname === '/api/next' && req.method === 'POST') {
    const queue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);
    const current = getSong(getPref('current', queue[0])?.id ?? queue[0]?.id);
    const index = queue.findIndex((song) => song.id === current.id);
    const next = queue[(index + 1) % queue.length] ?? allSongs()[0];
    setPref('current', next);
    recordPlay(next, 'next', 'play');
    return json(res, { current: toClientSong(next) });
  }

  if (url.pathname === '/api/feedback' && req.method === 'POST') {
    const body = await readBody(req);
    const allowed = new Set(['like', 'skip', 'bad-fit']);
    const action = allowed.has(body.action) ? body.action : 'bad-fit';
    const song = getSong(body.songId);
    recordFeedback(song, {
      action,
      mood: body.mood ?? 'unknown',
      note: body.note ?? '',
      userInput: body.userInput ?? ''
    });
    if (action === 'skip') recordPlay(song, body.mood ?? 'unknown', 'skip');
    return json(res, {
      ok: true,
      feedback: recentFeedback(8),
      current: toClientSong(song),
      preferenceSummary: getPreferenceSummary()
    });
  }

  if (url.pathname === '/api/search' && req.method === 'GET') {
    return json(res, { results: toClientSongs(searchSongs(url.searchParams.get('q') ?? '')) });
  }

  if (url.pathname === '/api/library' && req.method === 'GET') {
    return json(res, libraryInfo());
  }

  if (url.pathname === '/api/netease/status' && req.method === 'GET') {
    return json(res, {
      configured: hasNeteaseProvider(),
      base: hasNeteaseProvider() ? process.env.NETEASE_API_BASE : null
    });
  }

  if (url.pathname === '/api/netease/search' && req.method === 'GET') {
    const query = url.searchParams.get('q') ?? '';
    if (!query.trim()) return json(res, { results: [] });
    return json(res, { results: toClientSongs(await searchNetease(query, 12)) });
  }

  if (url.pathname === '/api/netease/import' && req.method === 'POST') {
    const body = await readBody(req);
    const song = await importNeteaseSong(body.song);
    const queue = [song, ...getPref('queue', allSongs())].filter(Boolean);
    setPref('current', song);
    setPref('queue', queue);
    recordPlay(song, 'import', 'play');
    return json(res, { current: toClientSong(song), queue: toClientSongs(queue) });
  }

  if (url.pathname === '/api/network' && req.method === 'GET') {
    return json(res, {
      port: Number(process.env.PORT ?? 8080),
      addresses: localAddresses(Number(process.env.PORT ?? 8080))
    });
  }

  if (url.pathname === '/api/tts/status' && req.method === 'GET') {
    return json(res, {
      provider: hasFishKey() ? 'fish' : 'browser',
      model: hasFishKey() ? process.env.FISH_MODEL ?? 's2-pro' : null
    });
  }

  if (url.pathname === '/api/tts' && req.method === 'POST') {
    const body = await readBody(req);
    const text = String(body.text ?? '').replace(/^Claudio:\s*/i, '').trim().slice(0, 500);
    if (!text) return json(res, { error: 'Missing text' }, 400);
    const audio = await fishTts(text);
    if (!audio) return json(res, { error: 'Fish Audio is not configured' }, 400);
    res.writeHead(200, {
      'content-type': audio.contentType,
      'x-tts-cache': audio.cached ? 'hit' : 'miss',
      'cache-control': 'no-store'
    });
    if (audio.stream) {
      audio.stream.pipe(res);
      return;
    }
    res.write(audio.buffer);
    res.end();
    return;
  }

  if (url.pathname === '/api/library/scan' && req.method === 'POST') {
    scanLibrary({ refresh: true });
    return json(res, libraryInfo());
  }

  if (url.pathname === '/api/song/tags' && req.method === 'POST') {
    const body = await readBody(req);
    const song = getSong(body.songId);
    const mood = String(body.mood ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
    const energy = Math.max(0, Math.min(100, Number(body.energy ?? song.energy)));
    const tags = setSongTags(song.id, {
      mood: mood.length ? mood : song.mood,
      energy,
      note: String(body.note ?? '').slice(0, 240)
    });
    scanLibrary({ refresh: true });
    return json(res, { ok: true, tags, song: toClientSong(getSong(song.id)) });
  }

  if (url.pathname === '/api/audio' && req.method === 'GET') {
    const song = getLibrarySong(url.searchParams.get('id') ?? '');
    return streamAudio(req, res, song);
  }

  if (url.pathname === '/api/lyric' && req.method === 'GET') {
    return json(res, { lyric: getLyric(url.searchParams.get('id') ?? '') });
  }

  if (url.pathname === '/api/taste' && req.method === 'GET') {
    return json(res, {
      taste: readFileSync(join(root, 'user', 'taste.md'), 'utf8'),
      routines: readFileSync(join(root, 'user', 'routines.md'), 'utf8'),
      moodRules: readFileSync(join(root, 'user', 'mood-rules.md'), 'utf8')
    });
  }

  if (url.pathname === '/api/plan/today' && req.method === 'GET') {
    const context = buildContext('daily plan');
    return json(res, {
      routines: context.routines,
      moodRules: context.moodRules,
      localTime: context.localTime
    });
  }

  if (url.pathname === '/api/cast' && req.method === 'POST') {
    const body = await readBody(req);
    const song = getSong(body.id);
    const port = process.env.PORT ?? 8080;
    const addresses = localAddresses(port);
    const ip = addresses.find(a => a.ip !== '127.0.0.1')?.ip || addresses[0]?.ip || '127.0.0.1';
    const streamUrl = `http://${ip}:${port}/api/audio?id=${encodeURIComponent(song.id)}`;
    
    try {
      await playOnDevice(streamUrl, { title: song.title, artist: song.artist });
      return json(res, { ok: true, target: 'upnp' });
    } catch (err) {
      return json(res, { error: err.message }, 500);
    }
  }

  return serveStatic(req, res);
}
