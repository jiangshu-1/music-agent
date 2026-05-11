import { fishStatus, fishTts } from '../tts.js';

export const routes = [
  {
    method: 'GET',
    path: '/api/tts/status',
    async handler(req, res) {
      res.json(await fishStatus());
    }
  },
  {
    method: 'POST',
    path: '/api/tts',
    async handler(req, res) {
      const body = await req.body();
      const text = String(body.text ?? '').replace(/^Claudio:\s*/i, '').trim().slice(0, 500);
      if (!text) {
        res.json({ error: '缺少要朗读的文字' }, 400);
        return;
      }
      const audio = await fishTts(text, { style: body.style, voiceId: body.voiceId });
      if (!audio) {
        res.json({ error: '还没有配置 Fish Audio，当前会使用浏览器自带朗读' }, 400);
        return;
      }
      res.writeHead(200, {
        'content-type': audio.contentType,
        'x-tts-cache': audio.cached ? 'hit' : 'miss',
        'x-tts-voice': audio.voiceId ?? '',
        'cache-control': 'no-store'
      });
      if (audio.stream) {
        audio.stream.pipe(res);
        return;
      }
      res.write(audio.buffer);
      res.end();
    }
  }
];
