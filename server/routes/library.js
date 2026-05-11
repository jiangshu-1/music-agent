import {
  deleteExternalSongsWithoutUrl,
  duplicateGroups,
  externalPlaylists,
  externalSongsByPlaylist,
  hideDuplicateSiblings,
  libraryStats,
  unhideDuplicateGroup
} from '../db.js';
import { libraryInfo, scanLibrary } from '../library.js';
import { searchSongs, toClientSongs } from '../music.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/search',
    async handler(req, res) {
      res.json({ results: toClientSongs(searchSongs(req.urlObject.searchParams.get('q') ?? '')) });
    }
  },
  {
    method: 'GET',
    path: '/api/library',
    async handler(req, res) {
      res.json(libraryInfo());
    }
  },
  {
    method: 'GET',
    path: '/api/library/stats',
    async handler(req, res) {
      res.json(libraryStats());
    }
  },
  {
    method: 'POST',
    path: '/api/library/cleanup',
    async handler(req, res) {
      const body = await req.body();
      if (body.action === 'missing-url') {
        res.json({ removed: deleteExternalSongsWithoutUrl(), stats: libraryStats() });
        return;
      }
      res.json({ error: '未知清理操作' }, 400);
    }
  },
  {
    method: 'GET',
    path: '/api/library/duplicates',
    async handler(req, res) {
      res.json({ groups: duplicateGroups() });
    }
  },
  {
    method: 'POST',
    path: '/api/library/duplicates',
    async handler(req, res) {
      const body = await req.body();
      if (body.action === 'keep' && body.id) {
        res.json({ changed: hideDuplicateSiblings(body.id), stats: libraryStats(), groups: duplicateGroups() });
        return;
      }
      if (body.action === 'unhide-group' && body.id) {
        res.json({ changed: unhideDuplicateGroup(body.id), stats: libraryStats(), groups: duplicateGroups() });
        return;
      }
      res.json({ error: '未知重复项操作' }, 400);
    }
  },
  {
    method: 'GET',
    path: '/api/playlists',
    async handler(req, res) {
      res.json({ playlists: externalPlaylists() });
    }
  },
  {
    method: 'GET',
    path: '/api/playlist/songs',
    async handler(req, res) {
      const id = req.urlObject.searchParams.get('id') ?? '';
      res.json({ songs: toClientSongs(externalSongsByPlaylist(id.replace(/^netease-playlist-/, ''))) });
    }
  },
  {
    method: 'POST',
    path: '/api/library/scan',
    async handler(req, res) {
      scanLibrary({ refresh: true });
      res.json(libraryInfo());
    }
  }
];
