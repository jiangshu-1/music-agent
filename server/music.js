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
  const skipped = new Set(recent.slice(0, 4).map((item) => item.song_id));

  const moodWeights = new Map([
    ['累', ['soft', 'calm', 'quiet']],
    ['困', ['soft', 'calm', 'quiet']],
    ['工作', ['focus', 'work', 'clean']],
    ['专注', ['focus', 'work']],
    ['早', ['morning', 'clean']],
    ['睡', ['quiet', 'rest', 'soft']],
    ['夜', ['night', 'late', 'deep']],
    ['燃', ['drive', 'cinematic']],
    ['开心', ['social', 'afternoon']],
    ['sad', ['emotional', 'quiet']],
    ['focus', ['focus', 'work']],
    ['work', ['focus', 'work']],
    ['sleep', ['quiet', 'rest']],
    ['night', ['night', 'late']]
  ]);

  const wanted = [];
  for (const [needle, moods] of moodWeights.entries()) {
    if (text.includes(needle)) wanted.push(...moods);
  }

  const songs = allSongs();
  const scored = songs.map((song) => {
    const moodScore = wanted.reduce((sum, mood) => sum + (song.mood.includes(mood) ? 8 : 0), 0);
    const freshness = skipped.has(song.id) ? -12 : 0;
    const defaultFit = wanted.length ? 0 : Math.abs(58 - song.energy) * -0.08;
    return { song, score: moodScore + freshness + defaultFit + song.energy / 100 };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 4).map((item) => item.song);
}
