import { scanLibrary } from './library.js';
import { externalSongs, getExternalSong } from './db.js';

const mockSongs = [
  {
    id: 'mock-001',
    source: 'mock',
    title: 'Midnight City',
    artist: 'M83',
    album: 'Hurry Up, We Are Dreaming',
    mood: ['night', 'focus', 'cinematic'],
    energy: 72,
    color: '#e8704e',
    cover: 'linear-gradient(135deg, #2a1113, #e8704e 52%, #f2d39b)',
    url: null,
    lyric: ['Waiting in a car', 'Waiting for a ride in the dark', 'The night city opens slowly']
  },
  {
    id: 'mock-002',
    source: 'mock',
    title: 'A Walk',
    artist: 'Tycho',
    album: 'Dive',
    mood: ['focus', 'calm', 'work'],
    energy: 48,
    color: '#87b38d',
    cover: 'linear-gradient(135deg, #0e211a, #87b38d 55%, #d8e7b5)',
    url: null,
    lyric: ['Soft pulse under daylight', 'Keep the desk clean', 'Let the loop carry the hour']
  },
  {
    id: 'mock-003',
    source: 'mock',
    title: 'Innerbloom',
    artist: 'RUFUS DU SOL',
    album: 'Bloom',
    mood: ['deep', 'late', 'emotional'],
    energy: 61,
    color: '#d7b85d',
    cover: 'linear-gradient(135deg, #201b11, #d7b85d 48%, #6f87a8)',
    url: null,
    lyric: ['A long room of echoes', 'Breath turns into rhythm', 'The night has patience']
  },
  {
    id: 'mock-004',
    source: 'mock',
    title: 'Glue',
    artist: 'Bicep',
    album: 'Bicep',
    mood: ['drive', 'morning', 'clean'],
    energy: 82,
    color: '#5a9fd6',
    cover: 'linear-gradient(135deg, #071725, #5a9fd6 50%, #b8d2df)',
    url: null,
    lyric: ['Kick, air, motion', 'The day starts with edges', 'Do the next small thing']
  },
  {
    id: 'mock-005',
    source: 'mock',
    title: 'Avril 14th',
    artist: 'Aphex Twin',
    album: 'Drukqs',
    mood: ['quiet', 'rest', 'soft'],
    energy: 22,
    color: '#cfc7b0',
    cover: 'linear-gradient(135deg, #161512, #cfc7b0 58%, #746b58)',
    url: null,
    lyric: ['Small keys in a dim room', 'No need to hurry', 'Let the edges settle']
  },
  {
    id: 'mock-006',
    source: 'mock',
    title: 'On Hold',
    artist: 'The xx',
    album: 'I See You',
    mood: ['social', 'memory', 'afternoon'],
    energy: 55,
    color: '#d66b8b',
    cover: 'linear-gradient(135deg, #220d18, #d66b8b 50%, #e8bac4)',
    url: null,
    lyric: ['The hook remembers first', 'A clean beat, a half-smile', 'Back to the room']
  }
];

export function allSongs() {
  const localSongs = scanLibrary();
  const imported = externalSongs();
  const realSongs = [...localSongs, ...imported];
  return realSongs.length ? realSongs : mockSongs;
}

export function toClientSong(song) {
  if (!song) return song;
  const { path, ...clientSong } = song;
  return clientSong;
}

export function toClientSongs(songs) {
  return songs.map(toClientSong);
}

export function searchSongs(query = '') {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const songs = allSongs();
  if (!terms.length) return songs;
  return songs.filter((song) => {
    const haystack = `${song.title} ${song.artist} ${song.album} ${song.mood.join(' ')}`.toLowerCase();
    return terms.some((term) => haystack.includes(term));
  });
}

export function getSong(id) {
  if (id?.startsWith('netease-')) {
    const song = getExternalSong(id);
    if (song) return song;
  }
  const songs = allSongs();
  return songs.find((song) => song.id === id) ?? songs[0];
}

export function getLyric(id) {
  return getSong(id).lyric;
}

export function recommend({ intent = '', recent = [] } = {}) {
  const text = intent.toLowerCase();
  const skipped = new Set(recent.slice(0, 6).map((item) => item.song_id));

  // Vibe dictionary — mapping natural Chinese/English phrases (especially the
  // things someone says while coding) to mood tags that exist on songs. Keys
  // are substring-matched, so "写代码" catches "正在写代码" and so on.
  const moodWeights = new Map([
    // Coding states — the use-case the user actually cares about
    ['写代码', ['focus', 'work', 'calm', 'clean']],
    ['敲代码', ['focus', 'work', 'calm', 'clean']],
    ['代码', ['focus', 'work', 'clean']],
    ['coding', ['focus', 'work', 'clean']],
    ['vibe coding', ['focus', 'work', 'calm', 'night']],
    ['调bug', ['focus', 'calm', 'quiet']],
    ['调 bug', ['focus', 'calm', 'quiet']],
    ['debug', ['focus', 'calm', 'quiet']],
    ['重构', ['focus', 'clean', 'work']],
    ['看文档', ['focus', 'calm', 'quiet']],
    ['读论文', ['focus', 'calm', 'quiet']],
    ['设计', ['focus', 'calm', 'clean']],
    ['思考', ['calm', 'deep', 'quiet']],
    ['开会', ['calm', 'quiet', 'clean']],
    ['会议', ['calm', 'quiet']],
    ['deadline', ['drive', 'focus', 'clean']],
    ['ddl', ['drive', 'focus']],
    ['赶工', ['drive', 'focus']],
    ['上线', ['focus', 'clean', 'drive']],
    ['发版', ['focus', 'clean']],
    ['提交', ['clean', 'focus']],

    // Feelings / vibes
    ['累', ['soft', 'calm', 'quiet', 'rest']],
    ['困', ['soft', 'calm', 'quiet', 'rest']],
    ['疲', ['soft', 'calm', 'quiet', 'rest']],
    ['烦', ['calm', 'quiet', 'soft']],
    ['烦躁', ['calm', 'quiet', 'soft']],
    ['焦虑', ['calm', 'quiet', 'soft']],
    ['紧张', ['calm', 'quiet', 'soft']],
    ['压力', ['calm', 'quiet', 'soft']],
    ['卡住', ['calm', 'quiet', 'soft']],
    ['脑子乱', ['calm', 'quiet', 'soft']],
    ['乱', ['calm', 'quiet']],
    ['空', ['quiet', 'soft', 'calm']],
    ['发呆', ['quiet', 'soft', 'calm']],
    ['冷静', ['calm', 'quiet', 'clean']],
    ['安静', ['quiet', 'soft', 'calm']],
    ['松', ['soft', 'calm']],
    ['放松', ['soft', 'calm', 'quiet']],
    ['躺', ['soft', 'quiet', 'rest']],
    ['伤', ['emotional', 'quiet', 'soft']],
    ['哭', ['emotional', 'quiet', 'soft']],
    ['丧', ['emotional', 'quiet']],
    ['想家', ['emotional', 'soft']],
    ['孤独', ['emotional', 'quiet', 'night']],
    ['难过', ['emotional', 'quiet', 'soft']],
    ['开心', ['social', 'afternoon', 'clean']],
    ['高兴', ['social', 'afternoon', 'clean']],
    ['兴奋', ['drive', 'cinematic']],
    ['上头', ['drive', 'cinematic']],
    ['燃', ['drive', 'cinematic']],
    ['爽', ['drive', 'clean']],

    // Tasks / moments
    ['工作', ['focus', 'work', 'clean']],
    ['专注', ['focus', 'work']],
    ['学习', ['focus', 'work', 'calm']],
    ['写东西', ['focus', 'calm']],
    ['写作', ['focus', 'calm']],
    ['摸鱼', ['calm', 'soft', 'afternoon']],
    ['下班', ['clean', 'afternoon', 'social']],
    ['吃饭', ['social', 'afternoon', 'clean']],
    ['吃完饭', ['calm', 'soft']],
    ['走路', ['drive', 'clean', 'morning']],
    ['散步', ['calm', 'soft', 'afternoon']],
    ['跑步', ['drive', 'clean']],
    ['健身', ['drive', 'cinematic']],
    ['开车', ['drive', 'clean']],
    ['地铁', ['drive', 'clean', 'morning']],
    ['通勤', ['drive', 'clean']],
    ['路上', ['drive', 'clean']],

    // Times / weather
    ['早', ['morning', 'clean']],
    ['清晨', ['morning', 'calm', 'clean']],
    ['上午', ['morning', 'clean']],
    ['下午', ['afternoon', 'calm']],
    ['傍晚', ['afternoon', 'calm', 'soft']],
    ['晚上', ['night', 'late', 'soft']],
    ['夜', ['night', 'late', 'deep']],
    ['深夜', ['night', 'late', 'deep']],
    ['凌晨', ['night', 'late', 'deep']],
    ['睡', ['quiet', 'rest', 'soft']],
    ['睡前', ['quiet', 'rest', 'soft']],
    ['睡不着', ['quiet', 'night', 'soft']],
    ['失眠', ['quiet', 'night', 'soft']],
    ['雨', ['quiet', 'soft', 'calm', 'emotional']],
    ['下雨', ['quiet', 'soft', 'calm', 'emotional']],
    ['晴', ['clean', 'morning']],
    ['阴', ['calm', 'quiet', 'soft']],
    ['冬', ['quiet', 'soft', 'emotional']],
    ['咖啡', ['calm', 'focus', 'afternoon']],

    // English coding vocabulary
    ['focus', ['focus', 'work']],
    ['work', ['focus', 'work']],
    ['flow', ['focus', 'calm', 'clean']],
    ['sad', ['emotional', 'quiet']],
    ['tired', ['soft', 'calm', 'quiet']],
    ['sleep', ['quiet', 'rest']],
    ['chill', ['calm', 'soft', 'afternoon']],
    ['night', ['night', 'late']],
    ['late', ['night', 'late', 'deep']],
    ['morning', ['morning', 'clean']],
    ['run', ['drive', 'clean']],
    ['drive', ['drive', 'clean']]
  ]);

  const wanted = [];
  for (const [needle, moods] of moodWeights.entries()) {
    if (text.includes(needle)) wanted.push(...moods);
  }

  const songs = allSongs();
  const scored = songs.map((song) => {
    const moodScore = wanted.reduce((sum, mood) => sum + (song.mood.includes(mood) ? 8 : 0), 0);
    const freshness = skipped.has(song.id) ? -18 : 0;
    const defaultFit = wanted.length ? 0 : Math.abs(58 - song.energy) * -0.08;
    const jitter = Math.random() * 0.5;
    return { song, score: moodScore + freshness + defaultFit + song.energy / 100 + jitter };
  });

  // Return a wider pool (40 songs) so the LLM has room to curate, but keep
  // the strongest match at the top. Callers that only need one can still
  // take .slice(0, 1).
  return scored.sort((a, b) => b.score - a.score).slice(0, 40).map((item) => item.song);
}
