export const dislikedDjPatterns = [
  /稳住/,
  /接住/,
  /托住/,
  /撑住/,
  /兜住/,
  /抱住/,
  /接上/,
  /稳(?:一点|一些|下来|着|的线|的底)/,
  /节奏稳/,
  /背景稳/
];

export const djCopyGuardrail = [
  '播报禁用："稳住""接住""托住""撑住""兜住""接上"，也不要用类似的 AI 安慰腔。',
  '不要把音乐写成心理托举；直接说时间、场景、声音位置，或者下一首歌。',
  '可用表达："那就不催你""我把声音放轻点""写代码最怕被打断""这一段你自己走""我少说两句"。'
].join('\n');

const fallbackLine = '这首先放近一点，我少说两句。';

const replacements = [
  [/让它替你把(?:现在|当下|这一段|这段|此刻)?接住/g, '让它在后面走着'],
  [/把(?:现在|当下|这一段|这段|此刻)?接住/g, '把歌放进去'],
  [/接住(?:当下|现在|这一段|这段|此刻)?/g, '往下走'],
  [/把(?:现在|当下|这一段|这段|此刻)?(?:先)?稳住/g, '先把声音放低'],
  [/稳住(?:手头|节奏|背景|当下|现在|这一段|这段)?/g, '慢一点'],
  [/把房间(?:声音)?托住/g, '把声音放低一点'],
  [/托住(?:房间|这一段|这段|当下|现在|此刻)?/g, '留在后面'],
  [/撑住/g, '缓一缓'],
  [/兜住/g, '收在后面'],
  [/抱住/g, '留在旁边'],
  [/已接上/g, '已经切过去'],
  [/接上/g, '切过去']
];

export function hasDislikedDjPhrase(line = '') {
  const text = String(line ?? '');
  return dislikedDjPatterns.some((pattern) => pattern.test(text));
}

export function sanitizeDjLine(line = '', fallback = fallbackLine) {
  let text = String(line ?? '')
    .replace(/^(?:Claudio|此刻):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const [pattern, replacement] of replacements) {
    text = text.replace(pattern, replacement);
  }

  text = text
    .replace(/\s+([，。！？、])/g, '$1')
    .replace(/([，、]){2,}/g, '$1')
    .trim();

  if (!text || hasDislikedDjPhrase(text)) return fallback;
  return text;
}
