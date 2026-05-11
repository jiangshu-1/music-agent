import { clearSleepTimer, getSleepTimer, setSleepTimer } from '../scheduler.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/sleep-timer',
    async handler(req, res) {
      res.json({ timer: getSleepTimer() });
    }
  },
  {
    method: 'POST',
    path: '/api/sleep-timer',
    async handler(req, res) {
      const body = await req.body();
      if (body.action === 'clear') {
        clearSleepTimer();
        res.json({ timer: null });
        return;
      }
      const timer = setSleepTimer({
        minutes: body.minutes,
        fadeSec: body.fadeSec ?? 20,
        note: body.note ?? ''
      });
      res.json({ timer });
    }
  }
];
