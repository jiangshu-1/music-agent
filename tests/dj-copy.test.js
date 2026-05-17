import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { buildLocalIntro, buildSongBackgroundIntro, stationTransitionLine } from '../server/dj.js';
import { hasDislikedDjPhrase, sanitizeDjLine } from '../server/dj-copy.js';

const forbiddenDjCopy = /稳住|接住|托住|撑住|兜住|抱住|接上|已接上|节奏稳|背景稳|稳的线|稳定的底/;

test('sanitizes AI-ish DJ cushion phrases', () => {
  const lines = [
    '先稳住，把这一段接住。',
    '这首歌把房间托住。',
    '电台已接上。',
    '节奏稳，你继续。'
  ];

  for (const line of lines) {
    const cleaned = sanitizeDjLine(line);
    assert.equal(hasDislikedDjPhrase(cleaned), false, `${line} -> ${cleaned}`);
    assert.doesNotMatch(cleaned, forbiddenDjCopy, `${line} -> ${cleaned}`);
  }
});

test('local DJ transitions avoid disliked phrasing', () => {
  const from = {
    title: 'A Walk',
    artist: 'Tycho',
    mood: ['focus'],
    energy: 48
  };
  const to = {
    title: 'Glue',
    artist: 'Bicep',
    mood: ['drive'],
    energy: 82
  };

  for (let i = 0; i < 20; i += 1) {
    const intro = buildLocalIntro({ from, to, hour: 21 });
    assert.equal(hasDislikedDjPhrase(intro), false, intro);
    assert.doesNotMatch(intro, forbiddenDjCopy);
  }

  for (const id of ['focus', 'night', 'discovery', 'commute', 'sleep', 'local', 'wind-down', 'custom']) {
    for (let i = 0; i < 20; i += 1) {
      const line = stationTransitionLine({ id, name: id }, to);
      assert.equal(hasDislikedDjPhrase(line), false, line);
      assert.doesNotMatch(line, forbiddenDjCopy);
    }
  }
});

test('song background intros use known facts and avoid fabricated dates', () => {
  const known = buildSongBackgroundIntro({
    song: {
      title: 'Midnight City',
      artist: 'M83',
      album: 'Hurry Up, We Are Dreaming',
      mood: ['night'],
      energy: 72
    }
  });
  assert.match(known, /2011/);
  assert.match(known, /Midnight City/);
  assert.equal(hasDislikedDjPhrase(known), false, known);

  const local = buildSongBackgroundIntro({
    song: {
      title: 'Unknown File',
      artist: '本地曲库',
      source: 'local',
      album: '本地曲库',
      mood: ['local'],
      energy: 40
    }
  });
  assert.match(local, /不乱编/);
  assert.equal(hasDislikedDjPhrase(local), false, local);
});

test('hardcoded DJ-facing source does not reintroduce disliked phrases', () => {
  const root = process.cwd();
  const files = [
    'server/brain.js',
    'server/dj.js',
    'web/app.js',
    'web/mini.js'
  ];

  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
      .replace(/function sanitizeDjCopy[\s\S]*?\nfunction setDispatch/, 'function setDispatch');
    assert.doesNotMatch(source, forbiddenDjCopy, file);
  }
});
