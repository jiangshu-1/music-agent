import { djIntroForTransition } from '../dj.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/dj/intro',
    async handler(req, res) {
      const body = await req.body();
      const intro = djIntroForTransition({ fromId: body.fromId, toId: body.toId });
      res.json(intro ?? { say: null });
    }
  }
];
