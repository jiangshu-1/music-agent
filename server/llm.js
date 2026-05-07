const defaultModel = 'gpt-4o-mini';
const openaiUrl = 'https://api.openai.com/v1/responses';
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

export function hasDeepSeekKey() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function configuredProvider() {
  if (process.env.LLM_PROVIDER) return process.env.LLM_PROVIDER.toLowerCase();
  if (hasDeepSeekKey()) return 'deepseek';
  if (hasOpenAIKey()) return 'openai';
  return 'claude';
}

export async function planWithOpenAI({ input, context, candidates }) {
  if (!hasOpenAIKey()) return null;

  const model = process.env.OPENAI_MODEL ?? defaultModel;
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
                '你是 Claudio，一个本地优先的个人 AI 音乐电台 DJ。',
                '目标：从候选歌曲里选择最适合当前用户状态的播放队列，并写一句短播报。',
                '只允许选择候选歌曲 id，不要编造不存在的歌。',
                '播报要短、具体、有判断，中文输出，不要解释系统实现。',
                '如果歌库很小，可以承认选择受限，但仍要给出最贴近状态的选择。',
                '输出必须符合 JSON schema。'
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
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message ?? `OpenAI request failed with ${response.status}`;
    throw new Error(message);
  }

  return {
    model,
    ...normalizePlan(parsePlan(data), candidates)
  };
}

function deepSeekPrompt({ input, context, candidates }) {
  return JSON.stringify({
    task: 'Choose a personal radio playback plan from candidate songs.',
    outputContract: {
      mood: 'one of focus, low-energy, morning, night, social, open',
      queueIds: '1 to 4 ids selected only from candidates',
      say: 'Chinese DJ line, <= 180 chars, do not prefix Claudio:',
      reason: 'Chinese rationale, <= 240 chars'
    },
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

export async function planWithDeepSeek({ input, context, candidates }) {
  if (!hasDeepSeekKey()) return null;

  const model = process.env.DEEPSEEK_MODEL ?? defaultDeepSeekModel;
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
              '你是 Claudio，一个本地优先的个人 AI 音乐电台 DJ。',
              '你必须只从候选歌曲 id 里选歌，不能编造歌曲。',
              '只输出一个 JSON object，不要 markdown，不要代码块。',
              'JSON keys 必须是 mood, queueIds, say, reason。',
              'mood 只能是 focus, low-energy, morning, night, social, open。',
              'say 和 reason 用中文，短、具体、有判断。'
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
      })
    });

  const data = await response.json();
  if (!response.ok) {
    const message = data.error?.message ?? `DeepSeek request failed with ${response.status}`;
    throw new Error(message);
  }

  const text = extractDeepSeekText(data);
  if (!text) {
    console.error(
      'DeepSeek empty content:',
      JSON.stringify(data.choices?.[0]?.message ?? data).slice(0, 800)
    );
    throw new Error('DeepSeek returned no message content');
  }

  return {
    model,
    ...normalizePlan(parseJsonObject(text), candidates)
  };
}
