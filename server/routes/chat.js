import { planNext } from '../brain.js';
import { recordPlay, setPref } from '../db.js';
import { toClientSongs } from '../music.js';
import { broadcastNowPlaying } from './shared.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/chat',
    async handler(req, res) {
      const body = await req.body();
      const plan = await planNext(body.message ?? '');
      setPref('current', plan.queue[0]);
      setPref('queue', plan.queue);
      recordPlay(plan.queue[0], plan.mood, 'plan');
      broadcastNowPlaying(req, { say: plan.say });
      res.json({ ...plan, queue: toClientSongs(plan.queue) });
    }
  }
];
