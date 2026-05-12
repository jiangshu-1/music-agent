import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { fishTts, ttsStyles } from '../server/tts.js';

test('exposes distinctly shaped DJ voice styles', () => {
  const styles = new Map(ttsStyles().map((style) => [style.id, style]));
  assert.equal(styles.get('calm').name, '自然主持');
  assert.equal(styles.get('radio').hint, '亮、饱满、热场');
  assert.equal(styles.get('whisper').hint, '低、近、柔');
  assert.equal(styles.get('concise').hint, '短、清、直给');
  for (const style of styles.values()) {
    assert.equal(style.speed, 1);
  }
});

test('sends Fish prosody and sampling params for selected style', async () => {
  const oldFetch = globalThis.fetch;
  const oldApiKey = process.env.FISH_API_KEY;
  const oldReference = process.env.FISH_REFERENCE_ID;
  const oldModel = process.env.FISH_MODEL;
  const requests = [];

  process.env.FISH_API_KEY = 'test-key';
  process.env.FISH_REFERENCE_ID = 'test-reference';
  process.env.FISH_MODEL = 's2-pro';
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      headers: { get: () => 'audio/mpeg' },
      async arrayBuffer() {
        return Uint8Array.from([1, 2, 3]).buffer;
      }
    };
  };

  try {
    await fishTts(`radio-${randomUUID()}。今晚继续写代码。`, { style: 'radio' });
    await fishTts(`whisper-${randomUUID()}！先放慢一点。`, { style: 'whisper' });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldApiKey == null) delete process.env.FISH_API_KEY;
    else process.env.FISH_API_KEY = oldApiKey;
    if (oldReference == null) delete process.env.FISH_REFERENCE_ID;
    else process.env.FISH_REFERENCE_ID = oldReference;
    if (oldModel == null) delete process.env.FISH_MODEL;
    else process.env.FISH_MODEL = oldModel;
  }

  assert.equal(requests.length, 2);
  assert.equal(requests[0].reference_id, 'test-reference');
  assert.equal(requests[0].prosody.speed, 1);
  assert.equal(requests[0].prosody.volume, 2);
  assert.equal(requests[0].temperature, 0.9);
  assert.equal(requests[0].top_p, 0.9);
  assert.match(requests[0].text, /^好，/);

  assert.equal(requests[1].prosody.speed, 1);
  assert.equal(requests[1].prosody.volume, -5);
  assert.equal(requests[1].temperature, 0.42);
  assert.match(requests[1].text, /^嗯，/);
});
