import { getSong, toClientSong } from './music.js';
import { getCachedAmbience } from './ambience.js';

const timeBands = [
  { start: 0, end: 6, hint: '夜还没散，声音放轻' },
  { start: 6, end: 9, hint: '早上的第一下别太硬' },
  { start: 9, end: 12, hint: '保持一条线往前做' },
  { start: 12, end: 14, hint: '午休前不催你' },
  { start: 14, end: 18, hint: '下午把状态慢慢拉回来' },
  { start: 18, end: 22, hint: '晚上把房间压低一点' },
  { start: 22, end: 24, hint: '收尾时间，把声音放近' }
];

function pickBand(hour) {
  return timeBands.find((band) => hour >= band.start && hour < band.end) ?? timeBands[0];
}

function energyMove(from, to) {
  const a = Number(from?.energy ?? 50);
  const b = Number(to?.energy ?? 50);
  if (b - a >= 18) return '节奏抬一点';
  if (a - b >= 18) return '把速度再压低些';
  return null;
}

function moodBridge(from, to) {
  const fromMoods = new Set(from?.mood ?? []);
  const toMoods = to?.mood ?? [];
  const shared = toMoods.find((mood) => fromMoods.has(mood));
  if (shared) return `继续在${shared}的线上`;
  if (toMoods[0]) return `切到${toMoods[0]}的氛围`;
  return null;
}

export function buildLocalIntro({ from, to, hour = new Date().getHours() } = {}) {
  if (!to) return null;
  const band = pickBand(hour);
  const bridge = moodBridge(from, to);
  const energy = energyMove(from, to);
  const ambience = getCachedAmbience();
  const weather = ambience?.weather;

  const parts = [];
  // Weather flavor every now and then — only if it actually colors the moment.
  if (weather && Math.random() < 0.35) {
    const code = weather.weatherCode;
    if (code >= 51 && code <= 67) parts.push('外头在下雨');
    else if (code >= 95 && code <= 99) parts.push('雷声还没停');
    else if (code >= 71 && code <= 77) parts.push('外头在下雪');
    else if (code === 3) parts.push('天沉着');
    else if (code === 0 && weather.isDay === false) parts.push('夜里很清');
  }
  parts.push(bridge ?? band.hint);
  if (energy && Math.random() < 0.5) parts.push(energy);
  parts.push(`接下来是 ${to.artist} 的《${to.title}》`);
  return parts.join('，') + '。';
}

export function djIntroForTransition({ fromId, toId } = {}) {
  const from = fromId ? getSong(fromId) : null;
  const to = toId ? getSong(toId) : null;
  if (!to) return null;
  return {
    say: buildLocalIntro({ from, to }),
    from: toClientSong(from),
    to: toClientSong(to)
  };
}

// When the user switches stations (e.g. focus → late night), we want the DJ
// to briefly acknowledge the shift instead of saying "已接上". These are hand
// written because templates are what make it feel like the DJ knows the room.
const stationTransitionLines = {
  focus: [
    '把工作那层壳压一下，先稳住手头。',
    '现在把注意力收窄一点，只留这一件事。',
    '把速度找回来。',
    '桌面干净些，声音替你挡掉外面。'
  ],
  night: [
    '把灯先暗下来。',
    '夜里不催。',
    '把房间声音压低，剩下的慢慢走。',
    '这会儿不急，声音放近一点。'
  ],
  discovery: [
    '翻点新东西给你。',
    '换一条没走过的路试试。',
    '今天换换口味，接几首不熟的。'
  ],
  commute: [
    '把速度拉起来，门在外面。',
    '上路了，给你一条有推进的线。',
    '出发。'
  ],
  sleep: [
    '把呼吸交给声音就好。',
    '不用记得什么了。',
    '灯可以灭了，声音留给你。',
    '把今天关上。'
  ],
  local: [
    '回到你自己电脑里的东西。',
    '先播你自己存的。'
  ],
  'wind-down': [
    '收尾时间，先把速度压下来。',
    '把今天慢慢收回来。'
  ],
  custom: [
    '回到你存的那份清单。',
    '换回你自己那条电台。'
  ]
};

function stationLineFor(stationId, fallback) {
  const bucket = stationTransitionLines[stationId] ?? (stationId?.startsWith('custom-') ? stationTransitionLines.custom : null);
  if (!bucket || !bucket.length) return fallback;
  return bucket[Math.floor(Math.random() * bucket.length)];
}

export function stationTransitionLine(station, current) {
  if (!station) return null;
  const opener = stationLineFor(station.id, `${station.name}电台。`);
  if (!current) return opener;
  return `${opener}先放 ${current.artist} 的《${current.title}》。`;
}
