import { buildAmbience, getCachedAmbience } from '../ambience.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/ambience',
    async handler(req, res) {
      const noNetwork = req.urlObject.searchParams.get('fresh') === '0';
      const ambience = noNetwork ? getCachedAmbience() : await buildAmbience().catch(() => getCachedAmbience());
      res.json({ ambience });
    }
  }
];
