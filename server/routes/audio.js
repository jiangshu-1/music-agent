import { getLibrarySong, streamAudio } from '../library.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/audio',
    async handler(req, res) {
      const song = getLibrarySong(req.urlObject.searchParams.get('id') ?? '');
      streamAudio(req, res, song);
    }
  }
];
