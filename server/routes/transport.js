import { broadcast } from '../broadcast.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/transport',
    async handler(req, res) {
      const body = await req.body();
      const action = String(body.action ?? '').toLowerCase();
      if (!['play', 'pause', 'toggle'].includes(action)) {
        res.json({ error: '不支持的 transport 动作' }, 400);
        return;
      }
      const sourceClientId = req.headers['x-client-id'] || null;
      broadcast({ type: 'transport', action, sourceClientId });
      res.json({ ok: true });
    }
  }
];
