import { buildContext } from './context.js';
import { recommend } from './music.js';
import {
  configuredFallbackProvider,
  configuredProvider,
  planWith9Router,
  planWithDeepSeek,
  planWithOpenAI
} from './llm.js';
import { planWithClaude } from './claude.js';
import { logger } from './logger.js';

function detectMood(input) {
  const text = input.toLowerCase();
  if (/累|困|疲|难过|丧|烦|躺|发呆|脑子空|tired|sleep|rest/i.test(text)) return 'low-energy';
  if (/写代码|敲代码|代码|coding|debug|调bug|调 bug|重构|写东西|写作|工作|专注|学习|看文档|读论文|focus|work|flow/i.test(text)) return 'focus';
  if (/早|清晨|morning|通勤|上班/i.test(text)) return 'morning';
  if (/夜|晚|睡|凌晨|深夜|night|late/i.test(text)) return 'night';
  if (/开心|朋友|聚|吃|下班|放松|走路|散步|social|chill/i.test(text)) return 'social';
  return 'open';
}

function summarySignal(summary, song) {
  if (!summary) return '';

  const currentLabel = `${song.title} — ${song.artist}`;
  const likedSongs = summary.songs?.liked ?? [];
  const avoidedSongs = summary.songs?.avoided ?? [];
  const likedArtists = summary.artists?.liked ?? [];
  const avoidedArtists = summary.artists?.avoided ?? [];
  const likedScenes = summary.scenes?.liked ?? [];

  if (likedSongs.some((item) => item.label === currentLabel)) {
    return '这首也在你的正向反馈里，继续它最稳。';
  }

  if (avoidedSongs.some((item) => item.label === currentLabel)) {
    return '这首在你的反馈里有过负向信号，我先谨慎放它。';
  }

  if (likedArtists.some((item) => item.label === song.artist)) {
    return `你最近对 ${song.artist} 的反馈偏正向。`;
  }

  if (avoidedArtists.some((item) => item.label === song.artist)) {
    return `你最近对 ${song.artist} 的反馈偏保守。`;
  }

  if (likedScenes.some((item) => item.label === 'focus') && song.mood.includes('focus')) {
    return '你的偏好摘要里，focus 场景更稳。';
  }

  if (likedScenes.some((item) => item.label === 'night') && song.mood.includes('night')) {
    return '你的偏好摘要里，night 场景更稳。';
  }

  return '';
}

function reasonFor(song, input, context) {
  const base = input ? `你刚才说「${input}」` : '现在没有明确指令';
  let historyHint = summarySignal(context.preferenceSummary, song);

  if (!historyHint && context.recent.length && context.recent[0].title !== song.title) {
    historyHint = `我避开了刚播过的 ${context.recent[0].title}，换一条更干净的线。`;
  } else if (!historyHint && context.recent.length) {
    historyHint = '本地歌库还很小，我先选最贴近当前状态的一首。';
  }

  return `${base}，所以先放 ${song.artist} 的 ${song.title}。${historyHint}`;
}

function djLineFor(song, input, context, mood) {
  const title = `《${song.title}》`;
  const artist = song.artist;
  const historyHint = summarySignal(context.preferenceSummary, song);
  const smallLibrary = context.recent.length ? '我先从现有曲库里挑最贴近的一首。' : '';
  const text = (input || '').toLowerCase();

  // Pick one of several coding-aware lines so it doesn't sound like a loop.
  const pick = (lines) => lines[Math.floor(Math.random() * lines.length)];

  if (/调bug|调 bug|debug|卡住/.test(text)) {
    return pick([
      `调 bug 呢，那不说话了。${artist} 的${title}给你把背景稳住。`,
      `卡着呢我知道，先不吵你。${title}铺一层底，看着办。`,
      `这会儿别分心。${title}给你留着节奏，脑子自己走。`
    ]);
  }

  if (/写代码|敲代码|代码|coding|重构|写东西|写作/.test(text)) {
    return pick([
      `写代码最怕被打断，我把声音放轻点。${artist} 的${title}不抢你。`,
      `给你铺一条稳的线。${title}这种，能让你一直在里面。`,
      `${artist} 的${title}，节奏稳，你接着敲。`
    ]);
  }

  if (mood === 'focus') {
    return pick([
      `先别把劲儿用猛了。${artist} 的${title}给你铺一层稳定的底。`,
      `把注意力收窄一点。${title}替你挡掉外面。`,
      `桌面干净些，${title}陪你把这一段走完。`
    ]);
  }

  if (mood === 'low-energy') {
    return pick([
      `那就不催你。先让${title}慢慢进来，一小段一小段地过。`,
      `今天到这儿了。${title}留着陪你，剩下的不急。`,
      `先把声音放低。${artist} 这首${title}不逼你往前。`
    ]);
  }

  if (mood === 'night') {
    return pick([
      `夜里适合把声音放近一点。${artist} 这首${title}只把房间托住。`,
      `把灯拧暗些。${title}给你搭一个半掩的窗。`,
      `${title}不抢你注意力，夜里刚好。`
    ]);
  }

  if (mood === 'morning') {
    return pick([
      `早上的第一下别太硬。用${title}把速度提起来一点。`,
      `别急着冲。${title}帮你把节奏找回来。`
    ]);
  }

  if (mood === 'social') {
    return pick([
      `这会儿需要一点松动感。${title}先把气氛打开。`,
      `下班了，${title}把你从屏幕里拽出来。`
    ]);
  }

  return `${smallLibrary || historyHint || '我先不讲大道理。'}放 ${artist} 的${title}，让它替你把现在这一段接住。`;
}

function sharedContext(context) {
  return {
    localTime: context.localTime,
    preferenceSummary: context.preferenceSummary,
    preferenceSummaryText: context.preferenceSummaryText,
    recent: context.recent.slice(0, 5)
  };
}

function localPlan(input = '', context, error = null) {
  const pool = recommend({ intent: input, recent: context.recent });
  const queue = pool.slice(0, 4);
  const current = queue[0];
  const mood = detectMood(input);
  const reason = reasonFor(current, input, context);

  return {
    mode: current.source ?? 'mock',
    planner: error ? 'fallback' : 'local-rules',
    model: null,
    mood,
    say: `Claudio: ${djLineFor(current, input, context, mood)}`,
    reason,
    queue,
    error: error?.message,
    context: sharedContext(context)
  };
}

export async function planNext(input = '') {
  const context = await buildContext(input);
  const candidates = recommend({ intent: input, recent: context.recent });
  const provider = configuredProvider();

  if (provider === 'local') return localPlan(input, context);

  const fallbackProvider = configuredFallbackProvider(provider);
  const providers = [provider, fallbackProvider].filter(Boolean);
  let lastError = null;

  for (const activeProvider of providers) {
    try {
      const llmPlan = activeProvider === '9router'
        ? await planWith9Router({ input, context, candidates })
        : activeProvider === 'deepseek'
          ? await planWithDeepSeek({ input, context, candidates })
          : activeProvider === 'openai'
            ? await planWithOpenAI({ input, context, candidates })
            : await planWithClaude({ input, context, candidates });

      if (!llmPlan) continue;

      const byId = new Map(candidates.map((song) => [song.id, song]));
      const queue = llmPlan.queueIds.map((id) => byId.get(id)).filter(Boolean);
      const current = queue[0] ?? candidates[0];

      return {
        mode: current.source ?? 'mock',
        planner: activeProvider,
        model: llmPlan.model,
        mood: llmPlan.mood,
        say: `Claudio: ${llmPlan.say}`,
        reason: llmPlan.reason,
        queue: queue.length ? queue : candidates.slice(0, 4),
        context: sharedContext(context)
      };
    } catch (error) {
      lastError = error;
      logger.withTag('brain').warn('planner failed', { provider: activeProvider, error: error.message });
    }
  }

  if (lastError) {
    logger.withTag('brain').warn('llm planners failed, falling back to local rules', { error: lastError.message });
  }
  return localPlan(input, context, lastError);
}
