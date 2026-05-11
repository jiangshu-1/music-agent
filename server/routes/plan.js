import { buildContext } from '../context.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/plan/today',
    async handler(req, res) {
      const context = await buildContext('daily plan');
      res.json({
        routines: context.routines,
        moodRules: context.moodRules,
        localTime: context.localTime,
        ambience: context.ambience
      });
    }
  }
];
