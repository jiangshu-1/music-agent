import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPreferenceSummary, recentPlays } from './db.js';
import { buildAmbience, getCachedAmbience } from './ambience.js';

const root = join(process.cwd());

function readUserFile(name) {
  try {
    return readFileSync(join(root, 'user', name), 'utf8').trim();
  } catch {
    return '';
  }
}

export async function buildContext(input = '') {
  const now = new Date();
  const preferenceSummary = getPreferenceSummary();

  // "当下这一刻": time band, weather, listening stretch. Falls back to
  // whatever we cached if the network call fails or times out.
  let ambience = null;
  try {
    ambience = await buildAmbience();
  } catch {
    ambience = getCachedAmbience();
  }

  return {
    input,
    now: now.toISOString(),
    localTime: now.toLocaleString('zh-CN', { hour12: false }),
    ambience,
    vibeLine: ambience?.vibeLine ?? '',
    weather: ambience?.weather
      ? `${ambience.weather.city ?? ''} ${Math.round(ambience.weather.temperature ?? 0)}°C`.trim()
      : (process.env.WEATHER_MOCK ?? ''),
    calendar: process.env.CALENDAR_MOCK ?? '暂无日程',
    taste: readUserFile('taste.md'),
    routines: readUserFile('routines.md'),
    moodRules: readUserFile('mood-rules.md'),
    playlists: readUserFile('playlists.json'),
    recent: recentPlays(10),
    preferenceSummary,
    preferenceSummaryText: preferenceSummary?.summaryText ?? ''
  };
}
