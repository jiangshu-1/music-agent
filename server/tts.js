import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const cacheDir = join(process.cwd(), 'data', 'tts-cache');

mkdirSync(cacheDir, { recursive: true });

export function hasFishKey() {
  return Boolean(process.env.FISH_API_KEY);
}

export function ttsCachePath(text) {
  const model = process.env.FISH_MODEL ?? 's2-pro';
  const hash = createHash('sha1').update(`${model}:${text}`).digest('hex');
  return join(cacheDir, `${hash}.mp3`);
}

export async function fishTts(text) {
  if (!hasFishKey()) return null;

  const cached = ttsCachePath(text);
  if (existsSync(cached)) {
    return {
      cached: true,
      contentType: 'audio/mpeg',
      stream: createReadStream(cached)
    };
  }

  const response = await fetch('https://api.fish.audio/v1/tts', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.FISH_API_KEY}`,
      'content-type': 'application/json',
      model: process.env.FISH_MODEL ?? 's2-pro'
    },
    body: JSON.stringify({
      text,
      format: 'mp3',
      prosody: {
        speed: Number(process.env.FISH_SPEED ?? 1),
        volume: Number(process.env.FISH_VOLUME ?? 0)
      }
    })
  });

  if (!response.ok) {
    let message = `Fish Audio request failed with ${response.status}`;
    try {
      const data = await response.json();
      message = data.message ?? data.error ?? message;
    } catch {
      // Keep the HTTP status message.
    }
    throw new Error(message);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(cached, buffer);
  return {
    cached: false,
    contentType: response.headers.get('content-type') ?? 'audio/mpeg',
    buffer
  };
}
