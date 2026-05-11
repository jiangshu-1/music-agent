import {
  dedupePlaybackFailureFeedback,
  getPreferenceSummary,
  recentFeedback,
  recordFeedback,
  recordPlay
} from '../db.js';
import { getSong, toClientSong } from '../music.js';

export const routes = [
  {
    method: 'POST',
    path: '/api/feedback',
    async handler(req, res) {
      const body = await req.body();
      const allowed = new Set(['like', 'skip', 'bad-fit']);
      const action = allowed.has(body.action) ? body.action : 'bad-fit';
      const song = getSong(body.songId);
      recordFeedback(song, {
        action,
        mood: body.mood ?? 'unknown',
        note: body.note ?? '',
        userInput: body.userInput ?? ''
      });
      if (action === 'skip') recordPlay(song, body.mood ?? 'unknown', 'skip');
      res.json({
        ok: true,
        feedback: recentFeedback(8),
        current: toClientSong(song),
        preferenceSummary: getPreferenceSummary()
      });
    }
  },
  {
    method: 'POST',
    path: '/api/feedback/cleanup',
    async handler(req, res) {
      const body = await req.body();
      if (body.action === 'dedupe-playback-failures') {
        res.json({
          removed: dedupePlaybackFailureFeedback(),
          feedback: recentFeedback(8),
          preferenceSummary: getPreferenceSummary()
        });
        return;
      }
      res.json({ error: '未知反馈清理操作' }, 400);
    }
  }
];
