import { djBackgroundForSong, djIntroForTransition } from '../dj.js';
import { broadcast } from '../broadcast.js';
import { getPref, setPref } from '../db.js';

const djSettingsKey = 'dj_settings';
const defaultDjSettings = {
  voiceStyle: 'calm',
  fishVoiceId: '',
  songBackgroundIntro: true
};

function normalizeDjSettings(value = {}) {
  const allowedStyles = new Set(['calm', 'radio', 'whisper', 'concise']);
  const voiceStyle = allowedStyles.has(value.voiceStyle) ? value.voiceStyle : defaultDjSettings.voiceStyle;
  return {
    voiceStyle,
    fishVoiceId: typeof value.fishVoiceId === 'string' ? value.fishVoiceId : '',
    songBackgroundIntro: value.songBackgroundIntro !== false
  };
}

function currentDjSettings() {
  return normalizeDjSettings(getPref(djSettingsKey, defaultDjSettings));
}

function djSettingsPayload() {
  return {
    ...currentDjSettings(),
    saved: Boolean(getPref(djSettingsKey, null))
  };
}

export const routes = [
  {
    method: 'GET',
    path: '/api/dj/settings',
    async handler(req, res) {
      res.json(djSettingsPayload());
    }
  },
  {
    method: 'POST',
    path: '/api/dj/settings',
    async handler(req, res) {
      const body = await req.body();
      const settings = normalizeDjSettings({ ...currentDjSettings(), ...body });
      setPref(djSettingsKey, settings);
      broadcast({
        type: 'dj-settings',
        settings,
        sourceClientId: req.headers['x-client-id'] || null
      });
      res.json({ ...settings, saved: true });
    }
  },
  {
    method: 'POST',
    path: '/api/dj/intro',
    async handler(req, res) {
      const body = await req.body();
      const intro = djIntroForTransition({ fromId: body.fromId, toId: body.toId });
      res.json(intro ?? { say: null });
    }
  },
  {
    method: 'POST',
    path: '/api/dj/background',
    async handler(req, res) {
      const body = await req.body();
      const intro = djBackgroundForSong({ songId: body.songId });
      res.json(intro ?? { say: null });
    }
  }
];
