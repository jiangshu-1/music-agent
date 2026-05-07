import { buildContext } from './context.js';
import { recommend } from './music.js';
import { configuredProvider, planWithDeepSeek, planWithOpenAI } from './llm.js';
import { planWithClaude } from './claude.js';

function detectMood(input) {
  if (/累|困|疲|sleep|rest/i.test(input)) return 'low-energy';
  if (/工作|专注|focus|work/i.test(input)) return 'focus';
  if (/早|morning/i.test(input)) return 'morning';
  if (/夜|晚|night/i.test(input)) return 'night';
  if (/开心|social|朋友/i.test(input)) return 'social';
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

function sharedContext(context) {
  return {
    localTime: context.localTime,
    preferenceSummary: context.preferenceSummary,
    preferenceSummaryText: context.preferenceSummaryText,
    recent: context.recent.slice(0, 5)
  };
}

function localPlan(input = '', context = buildContext(input), error = null) {
  const queue = recommend({ intent: input, recent: context.recent });
  const current = queue[0];
  const mood = detectMood(input);
  const reason = reasonFor(current, input, context);

  return {
    mode: current.source ?? 'mock',
    planner: error ? 'fallback' : 'local-rules',
    model: null,
    mood,
    say: `Claudio: ${reason}`,
    reason,
    queue,
    error: error?.message,
    context: sharedContext(context)
  };
}

export async function planNext(input = '') {
  const context = buildContext(input);
  const candidates = recommend({ intent: input, recent: context.recent });
  const provider = configuredProvider();

  if (provider === 'local') return localPlan(input, context);

  try {
    const llmPlan = provider === 'deepseek'
      ? await planWithDeepSeek({ input, context, candidates })
      : provider === 'openai'
        ? await planWithOpenAI({ input, context, candidates })
        : await planWithClaude({ input, context, candidates });

    if (!llmPlan) return localPlan(input, context);

    const byId = new Map(candidates.map((song) => [song.id, song]));
    const queue = llmPlan.queueIds.map((id) => byId.get(id)).filter(Boolean);
    const current = queue[0] ?? candidates[0];

    return {
      mode: current.source ?? 'mock',
      planner: provider,
      model: llmPlan.model,
      mood: llmPlan.mood,
      say: `Claudio: ${llmPlan.say}`,
      reason: llmPlan.reason,
      queue: queue.length ? queue : candidates,
      context: sharedContext(context)
    };
  } catch (error) {
    console.error('LLM planner failed, falling back to local rules:', error.message);
    return localPlan(input, context, error);
  }
}
