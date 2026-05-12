import { createReadStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { externalError, runExternal } from './resilience.js';
import { sanitizeDjLine } from './dj-copy.js';

const cacheDir = join(process.cwd(), 'data', 'tts-cache');
const voicesConfigPath = join(process.cwd(), 'user', 'voices.json');

mkdirSync(cacheDir, { recursive: true });

const voiceStyles = {
  calm: {
    id: 'calm',
    name: '自然主持',
    hint: '轻、慢、留白',
    speed: 1,
    volume: -1,
    temperature: 0.55,
    topP: 0.62
  },
  radio: {
    id: 'radio',
    name: '明亮电台',
    hint: '亮、饱满、热场',
    speed: 1,
    volume: 2,
    temperature: 0.9,
    topP: 0.9
  },
  whisper: {
    id: 'whisper',
    name: '贴耳低语',
    hint: '低、近、柔',
    speed: 1,
    volume: -5,
    temperature: 0.42,
    topP: 0.5
  },
  concise: {
    id: 'concise',
    name: '短句播报',
    hint: '短、清、直给',
    speed: 1,
    volume: 1,
    temperature: 0.48,
    topP: 0.55
  }
};

export function ttsStyles() {
  return Object.values(voiceStyles);
}

function loadVoicePool() {
  try {
    const raw = readFileSync(voicesConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    const voices = Array.isArray(parsed.voices) ? parsed.voices : [];
    const list = voices
      .filter((voice) => voice && typeof voice.id === 'string')
      .map((voice) => ({
        id: voice.id,
        name: voice.name || voice.id,
        description: voice.description ?? '',
        referenceId: voice.referenceId ?? null
      }));
    return {
      default: typeof parsed.default === 'string' ? parsed.default : (list[0]?.id ?? 'env'),
      voices: list
    };
  } catch {
    return { default: 'env', voices: [] };
  }
}

export function ttsVoicePool() {
  const pool = loadVoicePool();
  // Always expose the env-based voice as an option when FISH_REFERENCE_ID is set
  // so the user can fall back to whatever is in .env.
  const envReference = process.env.FISH_REFERENCE_ID?.trim() || null;
  const hasEnvVoice = pool.voices.some((voice) => voice.id === 'env');
  if (!hasEnvVoice && envReference) {
    pool.voices = [
      { id: 'env', name: '默认（.env 里配的）', description: '', referenceId: null },
      ...pool.voices
    ];
  }
  return pool;
}

function resolveVoice(voiceId) {
  const pool = loadVoicePool();
  const voice = voiceId ? pool.voices.find((item) => item.id === voiceId) : null;
  if (voice) return voice;
  const fallback = pool.voices.find((item) => item.id === pool.default) ?? pool.voices[0] ?? null;
  return fallback;
}

export function hasFishKey() {
  return Boolean(process.env.FISH_API_KEY);
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function fishConfig({ voiceId } = {}) {
  const envReference = process.env.FISH_REFERENCE_ID?.trim() || null;
  let referenceId = envReference;
  let activeVoiceId = 'env';
  if (voiceId) {
    const voice = resolveVoice(voiceId);
    if (voice) {
      activeVoiceId = voice.id;
      referenceId = voice.referenceId ?? envReference;
    }
  }
  return {
    model: process.env.FISH_MODEL ?? 's2-pro',
    userId: process.env.FISH_USER_ID?.trim() || 'self',
    teamId: process.env.FISH_TEAM_ID?.trim() || null,
    referenceId,
    activeVoiceId,
    speed: numberEnv('FISH_SPEED', 1),
    volume: numberEnv('FISH_VOLUME', 0),
    temperature: numberEnv('FISH_TEMPERATURE', 0.7),
    topP: numberEnv('FISH_TOP_P', 0.7),
    latency: process.env.FISH_LATENCY ?? 'normal',
    chunkLength: numberEnv('FISH_CHUNK_LENGTH', 300),
    sampleRate: numberEnv('FISH_SAMPLE_RATE', 44100),
    mp3Bitrate: numberEnv('FISH_MP3_BITRATE', 128),
    maxNewTokens: numberEnv('FISH_MAX_NEW_TOKENS', 1024),
    repetitionPenalty: numberEnv('FISH_REPETITION_PENALTY', 1.2),
    minChunkLength: numberEnv('FISH_MIN_CHUNK_LENGTH', 50),
    earlyStopThreshold: numberEnv('FISH_EARLY_STOP_THRESHOLD', 1)
  };
}

async function fishCredit(config) {
  const url = new URL(`https://api.fish.audio/wallet/${encodeURIComponent(config.userId)}/api-credit`);
  url.searchParams.set('check_free_credit', 'true');
  if (config.teamId) url.searchParams.set('team_id', config.teamId);

  return runExternal('tts', async ({ signal }) => {
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${process.env.FISH_API_KEY}`
      },
      signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      const message = data?.message ?? data?.error ?? `Fish 余额查询失败，状态码 ${response.status}`;
      throw externalError(message, response.status >= 500 ? 'http_5xx' : 'http_4xx');
    }

    return {
      userId: data.user_id ?? config.userId,
      credit: data.credit ?? null,
      hasPhoneSha256: data.has_phone_sha256 ?? null,
      hasFreeCredit: data.has_free_credit ?? null,
      updatedAt: data.updated_at ?? null
    };
  }, { timeoutMs: 3500 });
}

export async function fishStatus() {
  const config = fishConfig();
  const pool = ttsVoicePool();
  const status = {
    configured: hasFishKey(),
    provider: hasFishKey() ? 'fish' : 'browser',
    model: hasFishKey() ? config.model : null,
    userId: hasFishKey() ? config.userId : null,
    referenceId: hasFishKey() ? config.referenceId : null,
    activeVoiceId: config.activeVoiceId,
    voices: pool.voices,
    defaultVoiceId: pool.default,
    speed: config.speed,
    volume: config.volume,
    latency: config.latency,
    voice: config.referenceId ? 'custom' : 'default',
    needsReferenceId: false,
    styles: ttsStyles()
  };

  if (!hasFishKey()) return status;

  try {
    return { ...status, credit: await fishCredit(config) };
  } catch (error) {
    return { ...status, credit: { error: error.message } };
  }
}

function normalizeStyle(style) {
  return voiceStyles[style] ? style : 'calm';
}

function shapeFishText(text, style = 'calm') {
  const clean = sanitizeDjLine(text);
  const normalized = normalizeStyle(style);
  if (normalized === 'radio') {
    const energized = clean
      .replace(/。/g, '！')
      .replace(/，/g, '，')
      .replace(/！{2,}/g, '！');
    return /^好[，,]/.test(energized) ? energized : `好，${energized}`;
  }
  if (normalized === 'concise') {
    return clean.split(/[。！？.!?]/).find(Boolean)?.trim().slice(0, 46) || clean.slice(0, 46);
  }
  if (normalized === 'whisper') {
    const softened = clean
      .replace(/[！!]/g, '。')
      .replace(/[：:]/g, '，')
      .replace(/。{2,}/g, '。')
      .replace(/。/g, '……');
    return /^嗯[，,]/.test(softened) ? softened : `嗯，${softened}`;
  }
  return clean;
}

function styleConfig(style = 'calm') {
  return voiceStyles[normalizeStyle(style)];
}

function fishRequestPayload({ text, config, voiceStyle }) {
  const payload = {
    text,
    format: 'mp3',
    mp3_bitrate: config.mp3Bitrate,
    sample_rate: config.sampleRate,
    latency: config.latency,
    chunk_length: config.chunkLength,
    temperature: voiceStyle.temperature ?? config.temperature,
    top_p: voiceStyle.topP ?? config.topP,
    prosody: {
      speed: voiceStyle.speed ?? config.speed,
      volume: voiceStyle.volume ?? config.volume
    }
  };
  if (config.referenceId) payload.reference_id = config.referenceId;
  return payload;
}

export function ttsCachePath(text, style = 'calm', { voiceId } = {}) {
  const config = fishConfig({ voiceId });
  const voiceStyle = voiceStyles[normalizeStyle(style)];
  const hash = createHash('sha1').update(JSON.stringify({
    text,
    style: voiceStyle.id,
    model: config.model,
    referenceId: config.referenceId,
    speed: voiceStyle.speed,
    volume: voiceStyle.volume,
    temperature: voiceStyle.temperature,
    topP: voiceStyle.topP,
    latency: config.latency,
    chunkLength: config.chunkLength,
    sampleRate: config.sampleRate,
    mp3Bitrate: config.mp3Bitrate,
    maxNewTokens: config.maxNewTokens,
    repetitionPenalty: config.repetitionPenalty,
    minChunkLength: config.minChunkLength,
    earlyStopThreshold: config.earlyStopThreshold
  })).digest('hex');
  return join(cacheDir, `${hash}.mp3`);
}

export async function fishTts(text, { style = 'calm', voiceId } = {}) {
  if (!hasFishKey()) return null;

  const config = fishConfig({ voiceId });
  const voiceStyle = styleConfig(style);
  const spokenText = shapeFishText(text, style);
  const cached = ttsCachePath(spokenText, style, { voiceId });
  if (existsSync(cached)) {
    return {
      cached: true,
      contentType: 'audio/mpeg',
      voiceId: config.activeVoiceId,
      stream: createReadStream(cached)
    };
  }

  return runExternal('tts', async ({ signal }) => {
    const response = await fetch('https://api.fish.audio/v1/tts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.FISH_API_KEY}`,
        'content-type': 'application/json',
        model: config.model
      },
      body: JSON.stringify(fishRequestPayload({ text: spokenText, config, voiceStyle })),
      signal
    });

    if (!response.ok) {
      let message = `Fish 语音请求失败，状态码 ${response.status}`;
      try {
        const data = await response.json();
        message = data.message ?? data.error ?? message;
      } catch {
        // Keep the HTTP status message.
      }
      throw externalError(message, response.status >= 500 ? 'http_5xx' : 'http_4xx');
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(cached, buffer);
    return {
      cached: false,
      contentType: response.headers.get('content-type') ?? 'audio/mpeg',
      voiceId: config.activeVoiceId,
      buffer
    };
  });
}
