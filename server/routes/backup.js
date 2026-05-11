import { exportSnapshot } from '../db.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/backup',
    async handler(req, res) {
      res.json(exportSnapshot());
    }
  }
];
