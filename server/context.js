import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPreferenceSummary, recentPlays } from './db.js';

const root = join(process.cwd());

function readUserFile(name) {
  try {
    return readFileSync(join(root, 'user', name), 'utf8').trim();
  } catch {
    return '';
  }
}

export function buildContext(input = '') {
  const now = new Date();
  const preferenceSummary = getPreferenceSummary();
  
  // Mock environment injection as per architecture diagram
  const weather = process.env.WEATHER_MOCK ?? '晴，22°C';
  const calendar = process.env.CALENDAR_MOCK ?? '暂无日程';

  return {
    input,
    now: now.toISOString(),
    localTime: now.toLocaleString('zh-CN', { hour12: false }),
    weather,
    calendar,
    taste: readUserFile('taste.md'),
    routines: readUserFile('routines.md'),
    moodRules: readUserFile('mood-rules.md'),
    playlists: readUserFile('playlists.json'),
    recent: recentPlays(10),
    preferenceSummary,
    preferenceSummaryText: preferenceSummary?.summaryText ?? ''
  };
}
