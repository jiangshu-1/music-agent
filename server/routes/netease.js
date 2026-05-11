import {
  externalSongsByPlaylist,
  getPref,
  recordPlay,
  setPref
} from '../db.js';
import { allSongs, getSong, toClientSong, toClientSongs } from '../music.js';
import {
  hasNeteaseProvider,
  importNeteasePlaylist,
  importNeteaseSong,
  neteasePlaylistDetail,
  searchNetease,
  syncImportedPlaylists,
  userNeteasePlaylists
} from '../netease.js';
import { broadcastNowPlaying } from './shared.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/playlist/play',
    async handler(req, res) {
      const body = await req.body();
      const playlistId = String(body.id ?? '').replace(/^netease-playlist-/, '');
      let songs = externalSongsByPlaylist(playlistId, 2000);
      if (body.shuffle) songs = songs.sort(() => Math.random() - 0.5);
      const current = songs[0] ?? null;
      setPref('queue', songs);
      if (current) {
        setPref('current', current);
        recordPlay(current, 'playlist', 'play');
      }
      broadcastNowPlaying(req);
      res.json({ current: toClientSong(current), queue: toClientSongs(songs) });
    }
  },
  {
    method: 'GET',
    path: '/api/netease/status',
    async handler(req, res) {
      res.json({
        configured: hasNeteaseProvider(),
        base: hasNeteaseProvider() ? process.env.NETEASE_API_BASE : null,
        userId: process.env.NETEASE_USER_ID || null,
        hasCookie: Boolean(process.env.NETEASE_COOKIE)
      });
    }
  },
  {
    method: 'GET',
    path: '/api/netease/search',
    async handler(req, res) {
      const query = req.urlObject.searchParams.get('q') ?? '';
      if (!query.trim()) {
        res.json({ results: [] });
        return;
      }
      res.json({ results: toClientSongs(await searchNetease(query, 12)) });
    }
  },
  {
    method: 'GET',
    path: '/api/netease/playlists',
    async handler(req, res) {
      const uid = req.urlObject.searchParams.get('uid') || process.env.NETEASE_USER_ID;
      const limit = req.urlObject.searchParams.get('limit') ?? 100;
      const offset = req.urlObject.searchParams.get('offset') ?? 0;
      res.json(await userNeteasePlaylists({ uid, limit, offset }));
    }
  },
  {
    method: 'GET',
    path: '/api/netease/playlist',
    async handler(req, res) {
      const id = req.urlObject.searchParams.get('id') ?? '';
      const playlist = await neteasePlaylistDetail(id);
      res.json({ playlist });
    }
  },
  {
    method: 'POST',
    path: '/api/netease/import',
    async handler(req, res) {
      const body = await req.body();
      const song = await importNeteaseSong(body.song);
      const queue = [song, ...getPref('queue', allSongs())].filter(Boolean);
      setPref('current', song);
      setPref('queue', queue);
      recordPlay(song, 'import', 'play');
      broadcastNowPlaying(req);
      res.json({ current: toClientSong(song), queue: toClientSongs(queue) });
    }
  },
  {
    method: 'POST',
    path: '/api/netease/playlist/import',
    async handler(req, res) {
      const body = await req.body();
      const result = await importNeteasePlaylist(body.id ?? body.url ?? body.playlistId, {
        limit: body.limit ?? 200
      });
      const existingQueue = getPref('queue', allSongs()).map((song) => getSong(song.id)).filter(Boolean);
      const queue = [...result.imported, ...existingQueue]
        .filter(Boolean)
        .filter((song, index, songs) => songs.findIndex((item) => item.id === song.id) === index);
      const current = result.imported[0] ?? queue[0];
      if (current) {
        setPref('current', current);
        setPref('queue', queue);
        recordPlay(current, 'playlist-import', 'play');
      }
      broadcastNowPlaying(req);
      res.json({
        playlist: result.playlist,
        imported: toClientSongs(result.imported),
        current: toClientSong(current),
        queue: toClientSongs(queue)
      });
    }
  },
  {
    method: 'POST',
    path: '/api/netease/sync',
    async handler(req, res) {
      const result = await syncImportedPlaylists();
      if (!result.skipped) setPref('netease_last_sync', { syncedAt: result.syncedAt, totalAdded: result.totalAdded });
      res.json(result);
    }
  },
  {
    method: 'GET',
    path: '/api/netease/sync/status',
    async handler(req, res) {
      res.json({ lastSync: getPref('netease_last_sync', null) });
    }
  }
];
