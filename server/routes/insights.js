import { insightsSummary } from '../db.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/insights',
    async handler(req, res) {
      const days = Number(req.urlObject.searchParams.get('days') ?? 7);
      res.json(insightsSummary({ days }));
    }
  }
];
