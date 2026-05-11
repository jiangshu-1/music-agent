import { externalError, runExternal } from './resilience.js';

const defaultModel = 'gpt-4o-mini';
const openaiUrl = 'https://api.openai.com/v1/responses';
const defaultNineRouterBaseUrl = 'http://127.0.0.1:20128/v1';
const defaultNineRouterModel = 'kr/claude-sonnet-4.5';
const defaultDeepSeekModel = 'deepseek-v4-flash';
const deepSeekUrl = 'https://api.deepseek.com/chat/completions';

const plannerSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['mood', 'queueIds', 'say', 'reason'],
  properties: {
    mood: {
      type: 'string',
      enum: ['focus', 'low-energy', 'morning', 'night', 'social', 'open']
    },
    queueIds: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string' }
    },
    say: {
      type: 'string',
      minLength: 1,
      maxLength: 180
    },
    reason: {
      type: 'string',
      minLength: 1,
      maxLength: 240
    }
  }
};

function candidatePayload(songs) {
  return songs.map((song) => ({
    id: song.id,
    title: song.title,
    artist: song.artist,
    album: song.album,
    source: song.source,
    mood: song.mood,
    energy: song.energy
  }));
}

function extractOutputText(response) {
  if (response.output_text) return response.output_text;

  const parts = [];
  for (const output of response.output ?? []) {
    if (output.type !== 'message') continue;
    for (const item of output.content ?? []) {
      if (item.type === 'output_text' && item.text) parts.push(item.text);
      if (item.type === 'text' && item.text) parts.push(item.text);
    }
  }
  return parts.join('\n');
}

function parsePlan(response) {
  const text = extractOutputText(response);
  if (!text) throw new Error('LLM returned no text output');
  return JSON.parse(text);
}

function normalizePlan(plan, songs) {
  const validIds = new Set(songs.map((song) => song.id));
  const queueIds = [];

  for (const id of plan.queueIds ?? []) {
    if (validIds.has(id) && !queueIds.includes(id)) queueIds.push(id);
  }

  if (!queueIds.length) queueIds.push(songs[0].id);

  return {
    mood: plan.mood ?? 'open',
    queueIds: queueIds.slice(0, 4),
    say: String(plan.say ?? '').replace(/^Claudio:\s*/i, '').trim(),
    reason: String(plan.reason ?? '').trim()
  };
}

export function hasOpenAIKey() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function has9RouterKey() {
  return Boolean(process.env.NINEROUTER_API_KEY);
}

export function hasDeepSeekKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function configuredProvider() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER.toLowerCase();
  if (has9RouterKey()) return '9router';
  if (hasDeepSeekKey()) return 'deepseek';
  if (hasOpenAIKey()) return 'openai';
  return 'local';
}

export function configuredFallbackProvider(primaryProvider) {
  const provider = process.env.LLM_FALLBACK_PROVIDER?.toLowerCase();
  if (provider && provider !== primaryProvider) return provider;
  if (primaryProvider !== 'deepseek' && hasDeepSeekKey()) return 'deepseek';
  return null;
}

export async function planWithOpenAI({ input, context, candidates }) {
  if (!hasOpenAIKey()) return null;

  const model = process.env.OPENAI_MODEL ?? defaultModel;
  const data = await runExternal('llm', async ({ signal }) => {
    const response = await fetch(openaiUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                '你是 Claudio，一个在"写代码的人"身边的私人 AI 电台 DJ。',
                '用户大多数时间在 vibe coding：独自一人，屏幕前，脑子半浸在工作里。',
                '他要的不是背景音乐推荐引擎，而是一个懂他节奏的朋友。',
                '',
                '选歌原则：',
                '- 从候选池里真的选最像"此刻"的一首，不要默认挑第一首。',
                '- 优先器乐、低歌词密度、有画面感的电子/独立/氛围/爵士器乐。',
                '- 稳定节拍 > 旋律爆发。能让人保持一条线 > 能让人情绪起伏。',
                '- 中文人声/榜单甜歌除非用户明说想听，否则避开。',
                '- 写代码 / 调 bug / 重构 / 看文档 都是不同状态，用能量和声音密度区分。',
                '',
                '播报要求：',
                '- say 20-60 中文字，一句话，像私人电台朋友，不像客服。',
                '- 不要说"已为你选择""根据你的偏好""系统推荐""为你播放"。',
                '- 允许的表达："先别急""那就不催你""把房间托住""写代码最怕被打断""调 bug 呢 不说话了""这一段你自己走"。',
                '- 不要总用同一个开场白。',
                '- 不要解释歌曲信息，除非真的对当下有帮助。',
                '',
                '只从候选 id 选，不要编造歌。输出必须符合 JSON schema。'
              ].join('\n')
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify({
                userInput: input,
                localTime: context.localTime,
                weather: context.weather,
                calendar: context.calendar,
                taste: context.taste,
                routines: context.routines,
                moodRules: context.moodRules,
                recent: context.recent,
                preferenceSummary: context.preferenceSummary,
                preferenceSummaryText: context.preferenceSummaryText,
                candidates: candidatePayload(candidates)
                })
              }
            ]
          }
        ],
        reasoning: { effort: 'low' },
        text: {
          verbosity: 'low',
          format: {
            type: 'json_schema',
            name: 'music_radio_plan',
            strict: true,
            schema: plannerSchema
          }
        },
        max_output_tokens: 500
      }),
      signal
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload.error?.message ?? `OpenAI request failed with ${response.status}`;
      throw externalError(message, response.status >= 500 ? 'http_5xx' : 'http_4xx');
    }
    return payload;
  });

  return {
    model,
    ...normalizePlan(parsePlan(data), candidates)
  };
}

function deepSeekPrompt({ input, context, candidates }) {
  // Keep the payload focused on what actually matters for picking the right
  // song in the moment: what the user said, when it is, what they've been
  // listening to lately, and the candidate pool.
  return JSON.stringify({
    userInput: input || '(没有明确输入，按当下状态选)',
    now: {
      localTime: context.localTime,
      vibeLine: context.vibeLine ?? '',
      weather: context.weather
    },
    recentlyPlayed: (context.recent ?? []).slice(0, 6).map((item) => ({
      title: item.title,
      artist: item.artist,
      mood: item.mood,
      action: item.action
    })),
    preferenceHints: context.preferenceSummaryText ?? '',
    taste: context.taste,
    routinesForThisTime: context.routines,
    candidates: candidatePayload(candidates),
    outputContract: {
      mood: 'focus | low-energy | morning | night | social | open',
      queueIds: '1-4 ids from candidates',
      say: '20-60 中文字，一句话，不加 Claudio: 前缀',
      reason: '一句中文，说为什么挑这首'
    }
  });
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('DeepSeek returned no JSON object');
    return JSON.parse(match[0]);
  }
}

function extractDeepSeekText(data) {
  const choice = data.choices?.[0] ?? {};
  const message = choice.message ?? {};
  const content = message.content;

  if (typeof content === 'string' && content.trim()) return content;

  if (Array.isArray(content)) {
    const text = content
      .map((item) => item?.text ?? item?.content ?? '')
      .join('')
      .trim();
    if (text) return text;
  }

  if (content && typeof content === 'object') {
    const text = content.text ?? content.content ?? '';
    if (typeof text === 'string' && text.trim()) return text;
  }

  if (typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    return message.reasoning_content;
  }

  if (typeof choice.text === 'string' && choice.text.trim()) {
    return choice.text;
  }

  return '';
}

export async function planWith9Router({ input, context, candidates }) {
  if (!has9RouterKey()) return null;

  const model = process.env.NINEROUTER_MODEL ?? defaultNineRouterModel;
  const baseUrl = (process.env.NINEROUTER_BASE_URL ?? defaultNineRouterBaseUrl).replace(/\/$/, '');
  const data = await runExternal('llm', async ({ signal }) => {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.NINEROUTER_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Claudio，一个在"写代码的人"身边的私人 AI 电台 DJ。',
              '用户大多数时间在 vibe coding，要的不是背景音乐推荐引擎，而是一个懂他节奏的朋友。',
              '',
              '选歌原则：',
              '- 从候选池里真的挑最像"此刻"的，不要默认第一首。',
              '- 优先器乐、低歌词密度、有画面感的电子/独立/氛围/爵士器乐。',
              '- 稳定节拍 > 旋律爆发。能让人保持一条线 > 能让人情绪起伏。',
              '- 中文人声/榜单甜歌除非用户明说想听，否则避开。',
              '- 写代码 / 调 bug / 重构 / 看文档 是不同状态，用能量和声音密度区分。',
              '',
              '你必须只从候选 id 里选歌，不能编造。',
              '只输出一个 JSON object，不要 markdown，不要代码块。',
              'JSON keys 必须是 mood, queueIds, say, reason。',
              'mood 只能是 focus, low-energy, morning, night, social, open。',
              '',
              'say 20-60 中文字，一句话，私人电台朋友口吻，不加 "Claudio:" 前缀。',
              '不要说"已为你选择""根据你的偏好""系统推荐""为你播放"。',
              '允许："先别急""那就不催你""把房间托住""写代码最怕被打断""调 bug 呢 不说话了""这一段你自己走"。',
              '不要反复用同一个开场白。',
              'reason 用中文，一句话，给用户看不是给用户读。'
            ].join('\n')
          },
          {
            role: 'user',
            content: deepSeekPrompt({ input, context, candidates })
          }
        ],
        stream: false,
        temperature: 0.4,
        response_format: {
          type: 'json_object'
        },
        max_tokens: 500
      }),
      signal
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload.error?.message ?? `9router request failed with ${response.status}`;
      throw externalError(message, response.status >= 500 ? 'http_5xx' : 'http_4xx');
    }
    return payload;
  });

  const text = extractDeepSeekText(data);
  if (!text) throw new Error('9router returned no message content');

  return {
    model,
    ...normalizePlan(parseJsonObject(text), candidates)
  };
}

export async function planWithDeepSeek({ input, context, candidates }) {
  if (!hasDeepSeekKey()) return null;

  const model = process.env.DEEPSEEK_MODEL ?? defaultDeepSeekModel;
  const data = await runExternal('llm', async ({ signal }) => {
    const response = await fetch(deepSeekUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              '你是 Claudio，一个在"写代码的人"身边的私人 AI 电台 DJ。',
              '用户大多数时间在 vibe coding，要的不是背景音乐推荐引擎，而是一个懂他节奏的朋友。',
              '',
              '选歌原则：',
              '- 从候选池里真的挑最像"此刻"的，不要默认第一首。',
              '- 优先器乐、低歌词密度、有画面感的电子/独立/氛围/爵士器乐。',
              '- 稳定节拍 > 旋律爆发。能让人保持一条线 > 能让人情绪起伏。',
              '- 中文人声/榜单甜歌除非用户明说想听，否则避开。',
              '- 写代码 / 调 bug / 重构 / 看文档 是不同状态，用能量和声音密度区分。',
              '',
              '你必须只从候选 id 里选歌，不能编造。',
              '只输出一个 JSON object，不要 markdown，不要代码块。',
              'JSON keys 必须是 mood, queueIds, say, reason。',
              'mood 只能是 focus, low-energy, morning, night, social, open。',
              '',
              'say 20-60 中文字，一句话，私人电台朋友口吻，不加 "Claudio:" 前缀。',
              '不要说"已为你选择""根据你的偏好""系统推荐""为你播放"。',
              '允许："先别急""那就不催你""把房间托住""写代码最怕被打断""调 bug 呢 不说话了""这一段你自己走"。',
              '不要反复用同一个开场白。',
              'reason 用中文，一句话，给用户看不是给用户读。'
            ].join('\n')
          },
          {
            role: 'user',
            content: deepSeekPrompt({ input, context, candidates })
          }
        ],
        stream: false,
        temperature: 0.4,
        response_format: {
          type: 'json_object'
        },
        max_tokens: 500
      }),
      signal
    });

    const payload = await response.json();
    if (!response.ok) {
      const message = payload.error?.message ?? `DeepSeek request failed with ${response.status}`;
      throw externalError(message, response.status >= 500 ? 'http_5xx' : 'http_4xx');
    }
    return payload;
  });

  const text = extractDeepSeekText(data);
  if (!text) {
    throw new Error('DeepSeek returned no message content');
  }

  return {
    model,
    ...normalizePlan(parseJsonObject(text), candidates)
  };
}
