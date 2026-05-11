// "当下这一刻" context for Claudio: local time band, sun position,
// weather, recent listening stretch, and a short human-readable vibe line.
// Uses Open-Meteo free API (no key) for weather, cached for 15 min.

import { getPref, setPref, recentPlays } from './db.js';

const WEATHER_TTL_MS = 15 * 60 * 1000;
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const IP_GEO_URL = 'https://ipapi.co/json/';

let geoCache = null;
let weatherCache = null;

async function fetchJson(url, { timeoutMs = 3500 } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`request failed ${response.status}`);
  return response.json();
}

async function resolveLocation() {
  // Priority: explicit env vars > cached > IP-based guess
  const envLat = Number(process.env.CLAUDIO_LAT);
  const envLon = Number(process.env.CLAUDIO_LON);
  if (Number.isFinite(envLat) && Number.isFinite(envLon)) {
    return { lat: envLat, lon: envLon, city: process.env.CLAUDIO_CITY ?? '本地', source: 'env' };
  }
  if (geoCache) return geoCache;
  try {
    const data = await fetchJson(IP_GEO_URL, { timeoutMs: 2500 });
    if (Number.isFinite(Number(data.latitude)) && Number.isFinite(Number(data.longitude))) {
      geoCache = {
        lat: Number(data.latitude),
        lon: Number(data.longitude),
        city: data.city || data.region || '未知',
        source: 'ip'
      };
      return geoCache;
    }
  } catch {
    // fall through
  }
  return null;
}

async function fetchWeather() {
  if (weatherCache && Date.now() - weatherCache.fetchedAt < WEATHER_TTL_MS) {
    return weatherCache.value;
  }
  const location = await resolveLocation();
  if (!location) return null;

  try {
    const url = new URL(OPEN_METEO_URL);
    url.searchParams.set('latitude', location.lat);
    url.searchParams.set('longitude', location.lon);
    url.searchParams.set('current', 'temperature_2m,weather_code,wind_speed_10m,is_day');
    url.searchParams.set('daily', 'sunrise,sunset');
    url.searchParams.set('timezone', 'auto');
    const data = await fetchJson(url.toString());

    const current = data.current ?? {};
    const daily = data.daily ?? {};
    const value = {
      city: location.city,
      source: location.source,
      temperature: Number(current.temperature_2m),
      windSpeed: Number(current.wind_speed_10m),
      weatherCode: Number(current.weather_code),
      isDay: current.is_day === 1 || current.is_day === true,
      sunrise: Array.isArray(daily.sunrise) ? daily.sunrise[0] : null,
      sunset: Array.isArray(daily.sunset) ? daily.sunset[0] : null,
      fetchedAt: new Date().toISOString()
    };
    weatherCache = { value, fetchedAt: Date.now() };
    return value;
  } catch (error) {
    return weatherCache?.value ?? null;
  }
}

function weatherLabel(code) {
  // Condensed mapping of WMO codes, tuned for vibe not precision.
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '多云';
  if (code === 3) return '阴';
  if (code >= 45 && code <= 48) return '雾';
  if (code >= 51 && code <= 57) return '毛毛雨';
  if (code >= 61 && code <= 67) return '雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 95 && code <= 99) return '雷雨';
  return '天气未知';
}

function timeBand(hour) {
  if (hour >= 0 && hour < 5) return { key: 'deep-night', label: '凌晨' };
  if (hour < 7) return { key: 'pre-dawn', label: '清晨' };
  if (hour < 10) return { key: 'morning', label: '上午' };
  if (hour < 12) return { key: 'late-morning', label: '临近中午' };
  if (hour < 14) return { key: 'noon', label: '中午' };
  if (hour < 17) return { key: 'afternoon', label: '下午' };
  if (hour < 19) return { key: 'dusk', label: '黄昏' };
  if (hour < 22) return { key: 'evening', label: '晚上' };
  return { key: 'late-night', label: '深夜' };
}

function weekdayLabel(date) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[date.getDay()] ?? '';
}

// How long the user has been listening in this session.
// Defined as: plays in the last 3 hours, if any, measured from the earliest to now.
function currentStretch() {
  const plays = recentPlays(60);
  if (!plays.length) return null;
  const now = Date.now();
  const threeHoursAgo = now - 3 * 60 * 60 * 1000;
  const recent = plays
    .map((row) => ({ ...row, ts: Date.parse(row.created_at) }))
    .filter((row) => Number.isFinite(row.ts) && row.ts >= threeHoursAgo)
    .sort((a, b) => a.ts - b.ts);
  if (!recent.length) return null;
  const earliest = recent[0].ts;
  const minutes = Math.max(0, Math.round((now - earliest) / 60000));
  return {
    songCount: recent.length,
    minutes,
    startedAt: new Date(earliest).toISOString()
  };
}

function buildVibeLine({ bandLabel, weather, stretch, now }) {
  const parts = [];
  parts.push(`${bandLabel} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  if (weather) {
    const label = weatherLabel(weather.weatherCode);
    const temp = Number.isFinite(weather.temperature) ? `${Math.round(weather.temperature)}°C` : '';
    parts.push([label, temp].filter(Boolean).join(' '));
  }
  if (stretch && stretch.minutes >= 5) {
    parts.push(`已经听了 ${stretch.minutes} 分钟`);
  }
  return parts.join(' · ');
}

export async function buildAmbience({ includeWeather = true } = {}) {
  const now = new Date();
  const band = timeBand(now.getHours());
  const weather = includeWeather ? await fetchWeather() : null;
  const stretch = currentStretch();
  const ambience = {
    capturedAt: now.toISOString(),
    localTime: now.toLocaleString('zh-CN', { hour12: false }),
    weekday: weekdayLabel(now),
    timeBand: band,
    weather,
    stretch,
    vibeLine: buildVibeLine({ bandLabel: band.label, weather, stretch, now })
  };
  setPref('last_ambience', ambience);
  return ambience;
}

export function getCachedAmbience() {
  return getPref('last_ambience', null);
}
