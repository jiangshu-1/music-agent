const state = {
  current: null,
  queue: [],
  speaking: false,
  playing: false,
  repeatOne: localStorage.getItem('claudio.repeatOne') === '1',
  seeking: false,
  duration: 0,
  lyrics: [],
  activeLyricIndex: -1,
  audio: null,
  lastMood: 'unknown',
  lastInput: '',
  preferenceSummary: null,
  importedPlaylists: [],
  neteasePlaylists: [],
  stations: [],
  voices: [],
  voiceName: localStorage.getItem('claudio.voiceName') ?? '',
  voiceStyle: localStorage.getItem('claudio.voiceStyle') ?? 'calm',
  fishVoiceId: localStorage.getItem('claudio.fishVoiceId') ?? '',
  ttsStatus: null,
  castDevices: [],
  castTargetId: localStorage.getItem('claudio.castTargetId') ?? '',
  playbackFailureSongId: '',
  handlingPlaybackFailure: false,
  sleepTimer: null,
  songBackgroundIntro: localStorage.getItem('claudio.songBackgroundIntro') !== '0',
  crossfadeEnabled: localStorage.getItem('claudio.crossfade') !== '0',
  crossfadeSec: Number(localStorage.getItem('claudio.crossfadeSec') ?? '3'),
  crossfadeInterval: null,
  crossfadeTail: null,
  neteaseLastSync: null,
  preMuteVolume: null,
  ambience: null,
  ambientActive: false,
  ambientLyricLine: null,
  clientId: null,
  player: new Audio()
};

const els = {
  status: document.querySelector('#status'),
  vibeLine: document.querySelector('#vibeLine'),
  cover: document.querySelector('#cover'),
  title: document.querySelector('#title'),
  artist: document.querySelector('#artist'),
  dispatch: document.querySelector('#dispatch'),
  message: document.querySelector('#message'),
  send: document.querySelector('#send'),
  feedback: document.querySelector('.feedback'),
  play: document.querySelector('#play'),
  next: document.querySelector('#next'),
  prev: document.querySelector('#prev'),
  repeat: document.querySelector('#repeat'),
  progress: document.querySelector('#progress'),
  elapsed: document.querySelector('#elapsed'),
  duration: document.querySelector('#duration'),
  volume: document.querySelector('#volume'),
  voice: document.querySelector('#voice'),
  cast: document.querySelector('#cast'),
  ambient: document.querySelector('#ambient'),
  ambientMode: document.querySelector('#ambientMode'),
  ambientClose: document.querySelector('#ambientClose'),
  ambientBackdrop: document.querySelector('#ambientBackdrop'),
  ambientCover: document.querySelector('#ambientCover'),
  ambientTitle: document.querySelector('#ambientTitle'),
  ambientArtist: document.querySelector('#ambientArtist'),
  ambientLyric: document.querySelector('#ambientLyric'),
  ambientDispatch: document.querySelector('#ambientDispatch'),
  ambientProgressBar: document.querySelector('#ambientProgressBar'),
  tabs: document.querySelectorAll('.tabs button'),
  views: {
    queue: document.querySelector('#queueView'),
    lyrics: document.querySelector('#lyricsView'),
    library: document.querySelector('#libraryView'),
    netease: document.querySelector('#neteaseView'),
    profile: document.querySelector('#profileView')
  }
};

state.player.volume = Number(localStorage.getItem('claudio.volume') ?? '0.82');
if (els.volume) els.volume.value = String(Math.round(state.player.volume * 100));
if (els.repeat) els.repeat.textContent = state.repeatOne ? '单曲循环' : '循环关';
if (els.repeat) els.repeat.classList.toggle('active', state.repeatOne);

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', 'x-client-id': getClientId() };
  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    let message = `请求失败，状态码 ${response.status}`;
    try {
      const data = await response.json();
      message = data.error ?? message;
    } catch {
      // Keep the status-based message.
    }
    throw new Error(message);
  }
  return response.json();
}

function getClientId() {
  if (state.clientId) return state.clientId;
  let id = sessionStorage.getItem('claudio.clientId');
  if (!id) {
    id = `full-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem('claudio.clientId', id);
  }
  state.clientId = id;
  return id;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function displayAlbum(album) {
  return album === 'Local Files' ? '本地曲库' : album;
}

function applyDjSettings(settings = {}) {
  if (typeof settings.voiceStyle === 'string') {
    state.voiceStyle = settings.voiceStyle || 'calm';
    localStorage.setItem('claudio.voiceStyle', state.voiceStyle);
  }
  if (typeof settings.fishVoiceId === 'string') {
    state.fishVoiceId = settings.fishVoiceId;
    localStorage.setItem('claudio.fishVoiceId', state.fishVoiceId);
  }
  if (typeof settings.songBackgroundIntro === 'boolean') {
    state.songBackgroundIntro = settings.songBackgroundIntro;
    localStorage.setItem('claudio.songBackgroundIntro', state.songBackgroundIntro ? '1' : '0');
  }
}

async function loadDjSettings() {
  try {
    const settings = await api('/api/dj/settings');
    if (settings.saved === false) {
      await saveDjSettings({
        voiceStyle: state.voiceStyle,
        fishVoiceId: state.fishVoiceId,
        songBackgroundIntro: state.songBackgroundIntro
      });
      return;
    }
    applyDjSettings(settings);
  } catch {
    // Keep local settings when the server is older or temporarily unavailable.
  }
}

async function saveDjSettings(partial = {}) {
  applyDjSettings(partial);
  try {
    applyDjSettings(await api('/api/dj/settings', {
      method: 'POST',
      body: JSON.stringify({
        voiceStyle: state.voiceStyle,
        fishVoiceId: state.fishVoiceId,
        songBackgroundIntro: state.songBackgroundIntro,
        ...partial
      })
    }));
  } catch (error) {
    console.warn('DJ settings sync failed:', error);
  }
}

function renderSleepTimerInfoHtml() {
  const timer = state.sleepTimer;
  if (!timer) return '暂无倒计时。选择下面的时长可以在音乐淡出后自动停止。';
  const minutes = Math.max(1, Math.ceil(Number(timer.remainingMs ?? 0) / 60000));
  return `倒计时约 ${minutes} 分钟，到时会淡出 ${timer.fadeSec ?? 20}s 后停止。`;
}

function renderSyncStatusHtml(lastSync) {
  if (!lastSync?.syncedAt) return '还没有执行过增量同步。每天凌晨 3:30 会自动同步一次。';
  const when = new Date(lastSync.syncedAt);
  const now = new Date();
  const diffMin = Math.max(0, Math.round((now - when) / 60000));
  const humanAgo = diffMin < 1 ? '刚才' : diffMin < 60 ? `${diffMin} 分钟前` : diffMin < 60 * 24 ? `${Math.round(diffMin / 60)} 小时前` : `${Math.round(diffMin / 60 / 24)} 天前`;
  const added = Number(lastSync.totalAdded ?? 0);
  return `上次同步：${humanAgo}，新增 ${added} 首。每天凌晨 3:30 会自动同步。`;
}

function renderSleepTimerBadge() {
  const info = document.querySelector('#sleepTimerInfo');
  if (info) info.textContent = renderSleepTimerInfoHtml();
}

async function refreshSleepTimer() {
  try {
    const data = await api('/api/sleep-timer');
    state.sleepTimer = data.timer;
    renderSleepTimerBadge();
  } catch {
    // ignore
  }
}

async function refreshAmbience() {
  try {
    const data = await api('/api/ambience');
    state.ambience = data.ambience;
    renderAmbience();
  } catch {
    // ignore
  }
}

function renderAmbience() {
  if (!els.vibeLine) return;
  const ambience = state.ambience;
  if (!ambience?.vibeLine) {
    els.vibeLine.textContent = '';
    return;
  }
  els.vibeLine.textContent = ambience.vibeLine;
}

// --- Ambient mode ---

function enterAmbientMode() {
  if (!els.ambientMode) return;
  state.ambientActive = true;
  els.ambientMode.classList.add('active');
  els.ambientMode.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  updateAmbientTrack();
  updateAmbientDispatch();
  updateAmbientProgress();
}

function exitAmbientMode() {
  if (!els.ambientMode) return;
  state.ambientActive = false;
  els.ambientMode.classList.remove('active');
  els.ambientMode.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function toggleAmbientMode() {
  if (state.ambientActive) exitAmbientMode();
  else enterAmbientMode();
}

function updateAmbientTrack() {
  if (!state.ambientActive) return;
  const song = state.current;
  if (!song) return;
  els.ambientTitle.textContent = song.title ?? '—';
  els.ambientArtist.textContent = song.artist ?? '—';
  // cover is a CSS gradient/background; reuse the same value so the backdrop
  // matches the front cover.
  const bg = song.cover ?? '#050504';
  els.ambientCover.style.background = bg;
  els.ambientBackdrop.style.background = bg;
  // Lyric resets until next timeupdate picks the right line.
  state.ambientLyricLine = null;
  els.ambientLyric.textContent = '';
  els.ambientLyric.classList.remove('visible');
}

function sanitizeDjCopy(text = '') {
  let clean = String(text ?? '')
    .replace(/^(?:Claudio|此刻):\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
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
  for (const [pattern, replacement] of replacements) {
    clean = clean.replace(pattern, replacement);
  }
  return clean.replace(/\s+([，。！？、])/g, '$1').trim();
}

function setDispatch(text) {
  const clean = sanitizeDjCopy(text);
  if (clean) els.dispatch.textContent = clean;
  return clean;
}

function scrubDispatchElement() {
  if (!els.dispatch) return '';
  const text = els.dispatch.textContent ?? '';
  const clean = sanitizeDjCopy(text);
  if (clean && clean !== text) els.dispatch.textContent = clean;
  return clean;
}

function updateAmbientDispatch() {
  if (!state.ambientActive || !els.ambientDispatch) return;
  const text = scrubDispatchElement();
  if (!text || text === els.ambientDispatch.textContent) return;
  els.ambientDispatch.style.opacity = '0';
  setTimeout(() => {
    els.ambientDispatch.textContent = sanitizeDjCopy(text);
    els.ambientDispatch.style.opacity = '';
  }, 300);
}

// Observe the main DJ dispatch element so any place that writes to it
// automatically gets scrubbed and synced into ambient mode.
if (typeof MutationObserver !== 'undefined') {
  const observer = new MutationObserver(() => {
    scrubDispatchElement();
    updateAmbientDispatch();
  });
  const attach = () => {
    if (els.dispatch) {
      observer.observe(els.dispatch, { childList: true, characterData: true, subtree: true });
    }
  };
  attach();
}

function updateAmbientLyric() {
  if (!state.ambientActive) return;
  const lyrics = state.lyrics ?? [];
  if (!lyrics.length) {
    els.ambientLyric.classList.remove('visible');
    return;
  }

  const currentTime = state.player.currentTime ?? 0;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;

  // Pick a line by timestamp if available, otherwise split duration evenly
  // across the lines (so the user still sees them advance).
  let activeIndex = -1;
  const hasTimes = lyrics.some((line) => Number.isFinite(line.time));
  if (hasTimes) {
    for (let i = 0; i < lyrics.length; i += 1) {
      if (Number.isFinite(lyrics[i].time) && lyrics[i].time <= currentTime + 0.15) activeIndex = i;
    }
  } else if (duration > 0) {
    const ratio = Math.max(0, Math.min(0.999, currentTime / duration));
    activeIndex = Math.floor(ratio * lyrics.length);
  } else {
    activeIndex = 0;
  }

  if (activeIndex < 0 || activeIndex === state.ambientLyricLine) return;

  const line = lyrics[activeIndex];
  if (!line?.text) {
    els.ambientLyric.classList.remove('visible');
    return;
  }

  state.ambientLyricLine = activeIndex;
  els.ambientLyric.classList.remove('visible');
  setTimeout(() => {
    els.ambientLyric.textContent = line.text;
    els.ambientLyric.classList.add('visible');
  }, 250);
}

function updateAmbientProgress() {
  if (!state.ambientActive || !els.ambientProgressBar) return;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  const current = Number.isFinite(state.player.currentTime) ? state.player.currentTime : 0;
  const ratio = duration > 0 ? Math.max(0, Math.min(1, current / duration)) : 0;
  els.ambientProgressBar.style.width = `${ratio * 100}%`;
}

// Refresh ambience every 5 minutes so "已经听了 X 分钟" stays live.
setInterval(() => {
  refreshAmbience().catch(() => {});
}, 5 * 60 * 1000);

async function setSleepTimer(minutes) {
  const payload = minutes ? { minutes, fadeSec: 20 } : { action: 'clear' };
  const data = await api('/api/sleep-timer', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  state.sleepTimer = data.timer;
  renderSleepTimerBadge();
  if (minutes) {
    els.status.textContent = `睡眠定时：${minutes} 分钟后淡出`;
  } else {
    els.status.textContent = '已取消睡眠定时';
  }
}

function fadeOutAndStop(fadeSec = 20) {
  const totalMs = Math.max(1, fadeSec) * 1000;
  const startVolume = state.player.volume;
  const startedAt = performance.now();
  if (state.sleepFadeInterval) clearInterval(state.sleepFadeInterval);
  state.sleepFadeInterval = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const ratio = Math.min(1, elapsed / totalMs);
    state.player.volume = Math.max(0, startVolume * (1 - ratio));
    if (ratio >= 1) {
      clearInterval(state.sleepFadeInterval);
      state.sleepFadeInterval = null;
      setPlaying(false);
      state.player.volume = startVolume;
      els.volume.value = String(Math.round(startVolume * 100));
    }
  }, 200);
}

function displayMood(mood) {
  const moodMap = {
    focus: '专注',
    work: '工作',
    calm: '平静',
    quiet: '安静',
    rest: '休息',
    soft: '柔和',
    night: '夜晚',
    late: '深夜',
    deep: '沉浸',
    drive: '提神',
    clean: '清爽',
    morning: '早晨',
    social: '社交',
    afternoon: '下午',
    unknown: '未知'
  };
  return moodMap[mood] ?? mood ?? '未知';
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function normalizeLyricLine(line, index) {
  if (typeof line === 'string') return { time: null, text: line, index };
  return {
    time: Number.isFinite(Number(line?.time)) ? Number(line.time) : null,
    text: String(line?.text ?? '').trim(),
    index
  };
}

function renderSong(song) {
  if (!song) return;
  state.current = song;
  if (state.playbackFailureSongId !== song.id) {
    state.playbackFailureSongId = '';
    state.handlingPlaybackFailure = false;
  }
  els.title.textContent = song.title;
  els.artist.textContent = `${song.artist} · ${displayAlbum(song.album)}`;
  els.cover.style.background = song.cover;
  updateMediaSession();
  resetTransport();
  updateAmbientTrack();
  if (state.playing) startPlayback();
}

function renderQueue() {
  const stationRail = `
    <div class="station-rail">
      ${state.stations.map((station) => `
        <article class="station-card ${station.custom ? 'custom' : ''}">
          <button type="button" data-station="${station.id}">
            <strong>${escapeHtml(station.name)}</strong>
            <span>${escapeHtml(station.description)}${station.count ? ` · ${station.count} 首` : ''}</span>
          </button>
          ${station.custom ? `<button class="station-delete" type="button" title="删除 ${escapeHtml(station.name)}" data-delete-station="${station.id}">×</button>` : ''}
        </article>
      `).join('')}
    </div>
  `;
  const controls = `
    <div class="queue-toolbar">
      <button type="button" data-queue-shuffle>智能随机</button>
      <button type="button" data-save-station>保存电台</button>
      <button type="button" data-queue-clear>清空队列</button>
    </div>
  `;
  if (!state.queue.length) {
    els.views.queue.innerHTML = `${stationRail}${controls}<p class="empty-note">暂无待播放歌曲</p>`;
    return;
  }
  els.views.queue.innerHTML = stationRail + controls + state.queue.map((song) => `
    <article class="song-row">
      <div class="swatch" style="background:${song.cover}"></div>
      <div>
        <h3>${song.title}</h3>
        <p>${song.artist} · 能量 ${song.energy}${song.playlistName ? ` · ${escapeHtml(song.playlistName)}` : ''}</p>
      </div>
      <button type="button" title="上移 ${escapeHtml(song.title)}" data-move-queue="${song.id}" data-direction="up">↑</button>
      <button type="button" title="下移 ${escapeHtml(song.title)}" data-move-queue="${song.id}" data-direction="down">↓</button>
      <button type="button" title="从队列移除 ${escapeHtml(song.title)}" data-remove-queue="${song.id}">×</button>
      <button type="button" title="播放 ${song.title}" data-play="${song.id}">▶</button>
    </article>
  `).join('');
}

function renderSongRows(songs, { editable = false } = {}) {
  return songs.map((song) => `
    <article class="song-row">
      <div class="swatch" style="background:${song.cover}"></div>
      <div>
        <h3>${song.title}</h3>
        <p>${song.artist} · 能量 ${song.energy}${song.playlistName ? ` · ${escapeHtml(song.playlistName)}` : ''}</p>
        ${editable ? `
          <div class="tag-editor">
            <input type="text" value="${song.mood.join(', ')}" data-mood="${song.id}" aria-label="心情标签">
            <input type="number" min="0" max="100" value="${song.energy}" data-energy="${song.id}" aria-label="能量值">
            <button type="button" data-save-tags="${song.id}">保存</button>
          </div>
        ` : ''}
      </div>
      <button type="button" title="播放 ${song.title}" data-play="${song.id}">▶</button>
    </article>
  `).join('');
}

async function renderLyrics() {
  if (!state.current) return;
  try {
    const data = await api(`/api/lyric?id=${encodeURIComponent(state.current.id)}`);
    state.lyrics = (data.lyric || [])
      .map(normalizeLyricLine)
      .filter((line) => line.text);
    state.activeLyricIndex = -1;
    els.views.lyrics.innerHTML = state.lyrics.length
      ? state.lyrics.map((line) => `
          <p data-lyric-index="${line.index}" ${line.time == null ? '' : `data-lyric-time="${line.time}"`}>
            ${escapeHtml(line.text)}
          </p>
        `).join('')
      : '<p>暂无歌词</p>';
    updateLyricHighlight();
  } catch (err) {
    state.lyrics = [];
    state.activeLyricIndex = -1;
    els.views.lyrics.innerHTML = '<p>暂无歌词</p>';
  }
}

async function renderProfile() {
  const data = await api('/api/taste');
  const network = await api('/api/network');
  const tts = await api('/api/tts/status');
  const cast = await api('/api/cast/devices').catch(() => ({ devices: [] }));
  const health = await api('/api/health').catch(() => null);
  const insights = await api('/api/insights?days=7').catch(() => null);
  const summary = state.preferenceSummary;
  state.ttsStatus = tts;
  state.castDevices = cast.devices ?? [];
  // Seed the Fish voice from the server default on first run; after that
  // we trust what the user picked and saved in localStorage.
  if (!state.fishVoiceId && tts?.defaultVoiceId) {
    state.fishVoiceId = tts.defaultVoiceId;
  }
  const selectedVoice = resolveVoice();
  const selectedCastDevice = resolveCastDevice();
  const fishVoices = Array.isArray(tts.voices) ? tts.voices : [];
  const activeFishVoiceId = state.fishVoiceId || tts.defaultVoiceId || 'env';
  const activeFishVoice = fishVoices.find((voice) => voice.id === activeFishVoiceId);
  const activeFishVoiceName = activeFishVoice?.name || (tts.voice === 'custom' ? '固定声音' : '默认声音');
  const fishVoiceOptions = fishVoices.length
    ? fishVoices.map((voice) => `
      <option value="${escapeHtml(voice.id)}" ${voice.id === activeFishVoiceId ? 'selected' : ''}>
        ${escapeHtml(voice.name)}
      </option>
    `).join('')
    : `<option value="${escapeHtml(activeFishVoiceId)}">${escapeHtml(activeFishVoiceName)}</option>`;
  const voiceCurrent = tts.provider === 'fish'
    ? activeFishVoiceName
    : selectedVoice?.name || '自动';
  const styleDefaults = {
    calm: { id: 'calm', name: '自然主持', hint: '轻、慢、留白', speed: 1 },
    radio: { id: 'radio', name: '明亮电台', hint: '亮、饱满、热场', speed: 1 },
    whisper: { id: 'whisper', name: '贴耳低语', hint: '低、近、柔', speed: 1 },
    concise: { id: 'concise', name: '短句播报', hint: '短、清、直给', speed: 1 }
  };
  const rawStylesById = new Map((tts.styles ?? []).map((style) => [style.id, style]));
  const ttsStyleList = Object.keys(styleDefaults).map((id) => ({
    ...(rawStylesById.get(id) ?? {}),
    ...styleDefaults[id]
  }));
  const selectedStyle = ttsStyleList.find((style) => style.id === state.voiceStyle) ?? ttsStyleList[0];
  const voiceMetaParts = tts.provider === 'fish'
    ? [
        'Fish',
        tts.model || null,
        selectedStyle?.hint || null,
        tts.credit?.error
          ? '余额检查失败'
          : tts.credit?.credit != null ? `余额 ${tts.credit.credit}` : null
      ]
    : [
        '浏览器朗读',
        selectedStyle?.hint || null,
        selectedVoice?.lang || null
      ];
  const voiceMeta = voiceMetaParts.filter(Boolean).map(escapeHtml).join(' · ');
  const voiceOptions = [
    '<option value="">自动选择声音</option>',
    ...state.voices.map((voice) => `
      <option value="${escapeHtml(voice.name)}" ${voice.name === state.voiceName ? 'selected' : ''}>
        ${escapeHtml(voice.name)}${voice.lang ? ` · ${escapeHtml(voice.lang)}` : ''}
      </option>
    `)
  ].join('');
  const styleOptions = ttsStyleList.map((style) => `
    <option value="${escapeHtml(style.id)}" ${style.id === state.voiceStyle ? 'selected' : ''}>
      ${escapeHtml(style.name)}${style.hint ? ` · ${escapeHtml(style.hint)}` : ''}
    </option>
  `).join('');
  const castOptions = [
    '<option value="">自动选择音箱</option>',
    ...state.castDevices.map((device) => `
      <option value="${escapeHtml(device.id)}" ${device.id === state.castTargetId ? 'selected' : ''}>
        ${escapeHtml(device.name || device.address || '媒体播放设备')}
      </option>
    `)
  ].join('');

  els.views.profile.innerHTML = `
    <div class="profile-section">
      <p class="label">偏好与日常</p>
      <pre>${data.taste}</pre>
      <pre>${data.routines}</pre>
      <pre>${data.moodRules}</pre>
    </div>
    <div class="preference-summary">
      <p class="label">DJ 偏好记忆</p>
      <pre>${summary ? summary.summaryText : '还没有足够反馈，DJ 正在观察你的听歌习惯。'}</pre>
    </div>
    ${renderHealthPanel(health)}
    ${renderInsightsPanel(insights)}
    <div class="dj-auto-panel">
      <p class="label">歌曲背景播报</p>
      <label class="switch-row">
        <input type="checkbox" id="songBackgroundIntroToggle" ${state.songBackgroundIntro ? 'checked' : ''}>
        <span>每首歌开始前，先说一句歌曲背景</span>
      </label>
      <label class="switch-row">
        <input type="checkbox" id="crossfadeToggle" ${state.crossfadeEnabled ? 'checked' : ''}>
        <span>歌曲之间自动交叉淡化</span>
      </label>
      <label class="switch-row">
        <span>交叉淡化 ${state.crossfadeSec} 秒</span>
        <input type="range" id="crossfadeSecRange" min="1" max="8" value="${state.crossfadeSec}">
      </label>
    </div>
    <div class="sleep-timer-panel">
      <p class="label">睡眠定时</p>
      <p class="tts-info" id="sleepTimerInfo">${renderSleepTimerInfoHtml()}</p>
      <div class="sleep-timer-options">
        ${[15, 30, 45, 60, 90].map((mins) => `
          <button type="button" data-sleep-timer="${mins}">${mins} 分</button>
        `).join('')}
        <button type="button" data-sleep-timer="0">取消</button>
      </div>
    </div>
    <div class="backup-panel">
      <div class="section-head">
        <p class="label">备份</p>
        <button type="button" data-export-backup>导出</button>
      </div>
      <p class="tts-info">导出偏好、播放历史、反馈摘要、标签和已导入歌单。</p>
    </div>
    <div class="phone-access">
      <p class="label">手机访问地址</p>
      ${network.addresses.length ? network.addresses.map((item) => `
        <div class="phone-row">
          <code>${item.url}</code>
          <button type="button" data-copy-url="${item.url}">复制</button>
        </div>
      `).join('') : '<p>没有找到局域网地址</p>'}
    </div>
    <div class="cast-settings">
      <p class="label">音箱投放</p>
      <div class="cast-row">
        <select id="castTargetSelect" aria-label="UPnP 音箱目标" ${state.castDevices.length ? '' : 'disabled'}>
          ${castOptions}
        </select>
        <button type="button" data-refresh-cast>刷新</button>
      </div>
      <p class="tts-info">
        ${selectedCastDevice ? `当前目标：${escapeHtml(selectedCastDevice.name || selectedCastDevice.address)}` : '还没有选择 UPnP 音箱'}
      </p>
      <div class="output-actions">
        <button type="button" data-airplay ${supportsAirPlay() ? '' : 'disabled'}>AirPlay</button>
      </div>
      <p class="tts-info">
        ${supportsAirPlay() ? '当前浏览器支持 AirPlay 选择器。' : '当前浏览器没有暴露 AirPlay 选择器。'}
      </p>
    </div>
    <div class="voice-settings">
      <div class="section-head voice-head">
        <p class="label">DJ 声音</p>
        <span class="voice-current">${escapeHtml(voiceCurrent)}</span>
      </div>
      ${tts.provider === 'fish' ? `
        <div class="voice-row voice-main-row">
          <select id="fishVoiceSelect" aria-label="Fish DJ 声音">${fishVoiceOptions}</select>
          <button type="button" data-test-voice>试听</button>
        </div>
      ` : `
        <div class="voice-row voice-main-row">
          <select id="voiceSelect" aria-label="浏览器声音">${voiceOptions}</select>
          <button type="button" data-test-voice>试听</button>
        </div>
      `}
      <div class="voice-row voice-style-row">
        <select id="voiceStyleSelect" aria-label="DJ 声音风格">${styleOptions}</select>
      </div>
      <p class="tts-info voice-meta">${voiceMeta}</p>
    </div>
  `;
}

function renderHealthPanel(health) {
  if (!health) {
    return `
      <div class="health-panel">
        <div class="section-head">
          <p class="label">系统体检</p>
          <button type="button" data-refresh-health>刷新</button>
        </div>
        <p class="tts-info">暂时没有拿到体检结果</p>
      </div>
    `;
  }

  const statusText = {
    ok: '正常',
    warn: '注意',
    bad: '异常'
  };
  return `
    <div class="health-panel">
      <div class="section-head">
        <p class="label">系统体检 · ${statusText[health.status] ?? '未知'}</p>
        <button type="button" data-refresh-health>刷新</button>
      </div>
      <div class="health-grid">
        ${health.checks.map((check) => `
          <article class="health-card ${check.status}">
            <strong>${escapeHtml(check.label)}</strong>
            <span>${statusText[check.status] ?? check.status}</span>
            <p>${escapeHtml(check.detail)}</p>
          </article>
        `).join('')}
      </div>
    </div>
  `;
}

function renderInsightsPanel(insights) {
  if (!insights || !insights.totals) {
    return `
      <div class="insights-panel">
        <p class="label">最近 7 天听歌洞察</p>
        <p class="tts-info">还没有足够数据。</p>
      </div>
    `;
  }

  const maxHourPlays = insights.hourBuckets.reduce((max, item) => Math.max(max, item.plays), 0) || 1;
  const hourMap = new Map(insights.hourBuckets.map((item) => [item.hour, item.plays]));
  const hours = Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, '0');
    return { hour: key, plays: hourMap.get(key) ?? 0 };
  });

  return `
    <div class="insights-panel">
      <p class="label">最近 ${insights.days} 天听歌洞察</p>
      <div class="insights-totals">
        <div><strong>${insights.totals.plays}</strong><span>播放</span></div>
        <div><strong>${insights.totals.uniqueSongs}</strong><span>不同歌曲</span></div>
        <div><strong>${insights.totals.uniqueArtists}</strong><span>不同艺人</span></div>
        <div><strong>${insights.feedbackTotals.like}</strong><span>喜欢</span></div>
        <div><strong>${insights.feedbackTotals.skip}</strong><span>跳过</span></div>
        <div><strong>${insights.feedbackTotals.badFit}</strong><span>不合适</span></div>
      </div>
      ${insights.topArtists.length ? `
        <p class="insights-sub">常听艺人</p>
        <ul class="insights-list">
          ${insights.topArtists.map((artist) => `
            <li><span>${escapeHtml(artist.artist)}</span><span>${artist.plays}</span></li>
          `).join('')}
        </ul>
      ` : ''}
      ${insights.topMoods.length ? `
        <p class="insights-sub">常见心情</p>
        <ul class="insights-list">
          ${insights.topMoods.map((mood) => `
            <li><span>${escapeHtml(displayMood(mood.mood))}</span><span>${mood.plays}</span></li>
          `).join('')}
        </ul>
      ` : ''}
      <p class="insights-sub">时段分布（本地时间）</p>
      <div class="insights-bars">
        ${hours.map((item) => `
          <div class="bar" title="${item.hour}:00 · ${item.plays} 次" style="height:${Math.max(2, Math.round((item.plays / maxHourPlays) * 40))}px"></div>
        `).join('')}
      </div>
    </div>
  `;
}

async function renderLibrary() {
  const data = await api('/api/library');
  const imported = await api('/api/playlists').catch(() => ({ playlists: [] }));
  const stats = await api('/api/library/stats').catch(() => null);
  const duplicates = await api('/api/library/duplicates').catch(() => ({ groups: [] }));
  const syncStatus = await api('/api/netease/sync/status').catch(() => ({ lastSync: null }));
  state.importedPlaylists = imported.playlists ?? [];
  state.neteaseLastSync = syncStatus.lastSync;
  const songs = data.songs.slice(0, 48);
  const note = data.count
    ? `已扫描到 ${data.count} 首本地音乐。`
    : '库里还是空的。请往 library/ 文件夹放歌。';

  els.views.library.innerHTML = `
    <p class="library-note">${note}<span class="library-path">${data.writableImportDir}</span></p>
    ${renderLibraryStats(stats)}
    ${renderDuplicateReview(duplicates.groups ?? [])}
    <div class="imported-section">
      <div class="section-head">
        <p class="label">已导入歌单</p>
        <button type="button" data-sync-playlists>立即同步</button>
      </div>
      <p class="tts-info" id="syncStatus">${renderSyncStatusHtml(state.neteaseLastSync)}</p>
      ${renderImportedPlaylists(state.importedPlaylists)}
    </div>
    ${renderSongRows(songs, { editable: true })}
  `;
}

function renderLibraryStats(stats) {
  if (!stats) return '';
  return `
    <div class="library-stats">
      <p class="label">曲库体检</p>
      <div class="stat-grid">
        <div><strong>${stats.imported}</strong><span>网易云歌曲</span></div>
        <div><strong>${stats.playlistCount}</strong><span>来源歌单</span></div>
        <div><strong>${stats.missingUrl}</strong><span>无播放地址</span></div>
        <div><strong>${stats.hidden ?? 0}</strong><span>已隐藏</span></div>
        <div><strong>${stats.duplicateGroups?.length ?? 0}</strong><span>疑似重复组</span></div>
      </div>
      <div class="library-actions">
        <button type="button" data-clean-missing-url ${stats.missingUrl ? '' : 'disabled'}>清理无地址</button>
      </div>
      ${stats.duplicateGroups?.length ? `
        <details>
          <summary>查看疑似重复</summary>
          ${stats.duplicateGroups.map((item) => `
            <p>${escapeHtml(item.title)} · ${escapeHtml(item.artist)} × ${item.count}</p>
          `).join('')}
        </details>
      ` : ''}
    </div>
  `;
}

function renderDuplicateReview(groups) {
  if (!groups.length) return '';
  return `
    <div class="duplicate-review">
      <p class="label">重复治理</p>
      ${groups.slice(0, 8).map((group) => `
        <details>
          <summary>${escapeHtml(group.title)} · ${escapeHtml(group.artist)} × ${group.count}</summary>
          ${group.songs.map((song) => `
            <article class="duplicate-row ${song.hidden ? 'muted' : ''}">
              <div>
                <h3>${escapeHtml(song.album || '网易云')}</h3>
                <p>
                  ${song.playlistName ? `${escapeHtml(song.playlistName)} · ` : ''}
                  ${song.url ? '有地址' : '无地址'}
                  ${song.hidden ? ' · 已隐藏' : ''}
                </p>
              </div>
              <button type="button" data-keep-duplicate="${song.id}" ${song.hidden ? 'disabled' : ''}>保留</button>
            </article>
          `).join('')}
          <button class="restore-duplicates" type="button" data-unhide-duplicate-group="${group.songs[0]?.id ?? ''}">恢复本组</button>
        </details>
      `).join('')}
    </div>
  `;
}

function renderImportedPlaylists(playlists) {
  if (!playlists.length) return '<p class="library-note">还没有导入网易云歌单</p>';
  return playlists.map((playlist) => `
    <article class="playlist-row">
      <div>
        <h3>${escapeHtml(playlist.name)}</h3>
        <p>${playlist.importedCount} / ${playlist.trackCount} 首 · ${escapeHtml(playlist.creator || '网易云')}</p>
      </div>
      <button type="button" data-play-imported-playlist="${playlist.providerId}">播放</button>
      <button type="button" data-shuffle-imported-playlist="${playlist.providerId}">随机</button>
    </article>
  `).join('');
}

async function renderNetease() {
  const status = await api('/api/netease/status');
  els.views.netease.innerHTML = `
    <div class="netease-account">
      <input id="neteaseUserId" type="text" placeholder="网易云用户 ID" value="${escapeHtml(status.userId ?? '')}">
      <button id="neteaseLoadPlaylists" type="button">读取我的歌单</button>
    </div>
    <p class="library-note">
      ${status.configured ? `网易云接口：${status.base}` : '网易云接口未配置。'}
      ${status.userId ? ` · 用户 ${escapeHtml(status.userId)}` : ''}
      ${status.hasCookie ? ' · 已配置登录 Cookie' : ''}
    </p>
    <div id="neteasePlaylists"></div>
    <div class="netease-playlist">
      <input id="neteasePlaylist" type="text" placeholder="粘贴网易云歌单链接或 ID">
      <select id="neteaseImportLimit" aria-label="导入数量">
        <option value="30">前 30 首</option>
        <option value="100" selected>前 100 首</option>
        <option value="300">前 300 首</option>
        <option value="all">尽量全部</option>
      </select>
      <button id="neteasePreviewPlaylist" type="button">预览歌单</button>
      <button id="neteaseImportPlaylist" type="button">导入歌单</button>
    </div>
    <div id="neteasePlaylistPreview"></div>
    <div class="netease-search">
      <input id="neteaseQuery" type="text" placeholder="搜索网易云歌曲">
      <button id="neteaseSearch" type="button">搜索</button>
    </div>
    <div id="neteaseResults"></div>
  `;
}

function renderNeteasePlaylists(playlists) {
  const target = document.querySelector('#neteasePlaylists');
  if (!target) return;
  if (!playlists.length) {
    target.innerHTML = '<p class="library-note">没有读到歌单</p>';
    return;
  }
  target.innerHTML = `
    <div class="playlist-bulk">
      <label>
        <input id="neteaseSelectAll" type="checkbox">
        全选当前列表
      </label>
      <select id="neteaseBatchLimit" aria-label="批量导入数量">
        <option value="30">每单前 30 首</option>
        <option value="100" selected>每单前 100 首</option>
        <option value="300">每单前 300 首</option>
        <option value="all">每单尽量全部</option>
      </select>
      <button id="neteaseImportSelected" type="button">导入所选</button>
    </div>
    <div id="neteaseBulkProgress" class="bulk-progress" aria-live="polite"></div>
    <div class="playlist-list">
      ${playlists.map((playlist) => `
        <article class="playlist-row selectable">
          <label class="playlist-check" title="选择 ${escapeHtml(playlist.name)}">
            <input type="checkbox" data-select-playlist="${playlist.id}">
          </label>
          <div>
            <h3>${escapeHtml(playlist.name)}</h3>
            <p>
              ${playlist.source === 'collected' ? '收藏' : '创建'}
              · ${playlist.trackCount} 首
              ${playlist.creator ? ` · ${escapeHtml(playlist.creator)}` : ''}
            </p>
          </div>
          <button type="button" data-preview-playlist="${playlist.id}">预览</button>
          <button type="button" data-import-playlist="${playlist.id}">导入</button>
        </article>
      `).join('')}
    </div>
  `;
}

function renderNeteasePlaylist(playlist) {
  const target = document.querySelector('#neteasePlaylistPreview');
  if (!target) return;
  const songs = playlist.songs ?? [];
  target.innerHTML = `
    <div class="playlist-preview">
      <p class="label">${escapeHtml(playlist.name)}</p>
      <p class="library-note">
        ${playlist.creator ? `${escapeHtml(playlist.creator)} · ` : ''}
        共 ${playlist.trackCount ?? songs.length} 首，预览 ${songs.length} 首
      </p>
      ${songs.slice(0, 8).map((song) => `
        <article class="song-row compact">
          <div class="swatch" style="background:${song.cover}"></div>
          <div>
            <h3>${escapeHtml(song.title)}</h3>
            <p>${escapeHtml(song.artist)} · ${escapeHtml(song.album)}</p>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderNeteaseResults(songs) {
  const target = document.querySelector('#neteaseResults');
  target.innerHTML = songs.map((song) => `
    <article class="song-row">
      <div class="swatch" style="background:${song.cover}"></div>
      <div>
        <h3>${song.title}</h3>
        <p>${song.artist} · ${song.album}</p>
      </div>
      <button type="button" data-import-netease="${song.id}">导入</button>
    </article>
  `).join('');
  target.dataset.results = JSON.stringify(songs);
}

async function searchNetease() {
  const query = document.querySelector('#neteaseQuery')?.value.trim();
  if (!query) return;
  els.status.textContent = '搜索中';
  const data = await api(`/api/netease/search?q=${encodeURIComponent(query)}`);
  renderNeteaseResults(data.results);
  els.status.textContent = `找到 ${data.results.length} 首`;
}

async function loadNeteasePlaylists() {
  const uid = document.querySelector('#neteaseUserId')?.value.trim();
  els.status.textContent = '读取歌单列表中';
  const query = uid ? `?uid=${encodeURIComponent(uid)}` : '';
  const data = await api(`/api/netease/playlists${query}`);
  state.neteasePlaylists = data.playlists ?? [];
  renderNeteasePlaylists(state.neteasePlaylists);
  els.status.textContent = `读到 ${state.neteasePlaylists.length} 个歌单`;
}

async function previewNeteasePlaylist() {
  const id = document.querySelector('#neteasePlaylist')?.value.trim();
  if (!id) return;
  els.status.textContent = '读取歌单中';
  const data = await api(`/api/netease/playlist?id=${encodeURIComponent(id)}`);
  renderNeteasePlaylist(data.playlist);
  els.status.textContent = `歌单：${data.playlist.name}`;
}

async function importNeteasePlaylist() {
  const id = document.querySelector('#neteasePlaylist')?.value.trim();
  if (!id) return;
  const limitValue = document.querySelector('#neteaseImportLimit')?.value ?? '100';
  const limit = limitValue === 'all' ? 2000 : Number(limitValue);
  els.status.textContent = '读取曲目与播放地址';
  const data = await api('/api/netease/playlist/import', {
    method: 'POST',
    body: JSON.stringify({ id, limit })
  });
  state.queue = data.queue;
  if (data.current) renderSong(data.current);
  renderQueue();
  await renderLyrics();
  await renderLibrary().catch(() => {});
  els.status.textContent = `已导入 ${data.imported.length} 首`;
}

async function importNeteasePlaylistById(id) {
  const input = document.querySelector('#neteasePlaylist');
  if (input) input.value = id;
  await importNeteasePlaylist();
}

function selectedNeteasePlaylistIds() {
  return [...els.views.netease.querySelectorAll('[data-select-playlist]:checked')]
    .map((input) => input.dataset.selectPlaylist)
    .filter(Boolean);
}

function neteaseBatchLimit() {
  const value = document.querySelector('#neteaseBatchLimit')?.value ?? '100';
  return value === 'all' ? 2000 : Number(value);
}

function renderBulkProgress(results, active = '') {
  const target = document.querySelector('#neteaseBulkProgress');
  if (!target) return;
  const rows = results.map((item) => `
    <p class="${item.ok ? 'done' : 'failed'}">
      ${escapeHtml(item.name)} · ${item.ok ? `已导入 ${item.count} 首` : escapeHtml(item.error)}
    </p>
  `).join('');
  target.innerHTML = `${active ? `<p>${escapeHtml(active)}</p>` : ''}${rows}`;
}

async function importSelectedNeteasePlaylists() {
  const ids = selectedNeteasePlaylistIds();
  if (!ids.length) {
    els.status.textContent = '先选歌单';
    return;
  }

  const button = document.querySelector('#neteaseImportSelected');
  if (button) button.disabled = true;
  const limit = neteaseBatchLimit();
  const results = [];
  let total = 0;

  try {
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      const playlist = state.neteasePlaylists.find((item) => item.id === id);
      const name = playlist?.name ?? `歌单 ${id}`;
      const active = `导入 ${index + 1} / ${ids.length}：${name}`;
      els.status.textContent = active;
      renderBulkProgress(results, active);

      try {
        const data = await api('/api/netease/playlist/import', {
          method: 'POST',
          body: JSON.stringify({ id, limit })
        });
        const count = data.imported?.length ?? 0;
        total += count;
        results.push({ name, ok: true, count });
        state.queue = data.queue ?? state.queue;
        if (data.current) renderSong(data.current);
        renderQueue();
      } catch (error) {
        results.push({ name, ok: false, error: error.message });
      }
    }

    renderBulkProgress(results);
    await renderLyrics();
    await renderLibrary().catch(() => {});
    els.status.textContent = `批量导入完成：${total} 首`;
  } finally {
    if (button) button.disabled = false;
  }
}

async function playImportedPlaylist(id, shuffle = false) {
  els.status.textContent = shuffle ? '随机歌单中' : '载入歌单中';
  const data = await api('/api/playlist/play', {
    method: 'POST',
    body: JSON.stringify({ id, shuffle })
  });
  state.queue = data.queue ?? [];
  if (data.current) renderSong(data.current);
  renderQueue();
  await renderLyrics();
  setPlaying(Boolean(data.current));
  els.status.textContent = data.current ? `已载入 ${state.queue.length} 首` : '这个歌单还没有导入歌曲';
}

async function updateQueue(action, body = {}) {
  const data = await api('/api/queue', {
    method: 'POST',
    body: JSON.stringify({ action, ...body })
  });
  state.queue = data.queue ?? [];
  if (data.current) renderSong(data.current);
  renderQueue();
  els.status.textContent = action === 'clear' ? '队列已清空' : '队列已更新';
}

async function playStation(id) {
  els.status.textContent = '调台中';
  const data = await api('/api/station/play', {
    method: 'POST',
    body: JSON.stringify({ id, limit: 18 })
  });
  state.queue = data.queue ?? [];
  if (data.current) renderSong(data.current);
  renderQueue();
  await renderLyrics();
  const say = setDispatch(data.say ?? `${data.station?.name ?? '电台'}已切换`);
  els.status.textContent = `${data.station?.name ?? '电台'} · ${state.queue.length} 首`;
  speak(say);
}

async function saveCurrentQueueAsStation() {
  if (!state.queue.length) {
    els.status.textContent = '队列为空';
    return;
  }
  const fallback = state.current?.playlistName || '我的电台';
  const name = window.prompt('给这个队列起个名字', fallback);
  if (name === null) return;
  const data = await api('/api/station/save', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
  state.stations = data.stations ?? state.stations;
  renderQueue();
  els.status.textContent = `已保存：${data.station.name}`;
}

async function deleteCustomStation(id) {
  const station = state.stations.find((item) => item.id === id);
  if (!station?.custom) return;
  if (!window.confirm(`删除电台「${station.name}」？`)) return;
  const data = await api('/api/station/delete', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  state.stations = data.stations ?? state.stations;
  renderQueue();
  els.status.textContent = '电台已删除';
}

async function exportBackup() {
  els.status.textContent = '导出备份';
  const response = await fetch('/api/backup');
  if (!response.ok) throw new Error(`备份导出失败，状态码 ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  link.href = url;
  link.download = `cike-backup-${stamp}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  els.status.textContent = '备份已导出';
}

async function importNetease(songId) {
  const results = JSON.parse(document.querySelector('#neteaseResults')?.dataset.results ?? '[]');
  const song = results.find((item) => item.id === songId);
  if (!song) return;
  els.status.textContent = '导入中';
  const data = await api('/api/netease/import', {
    method: 'POST',
    body: JSON.stringify({ song })
  });
  state.queue = data.queue;
  renderSong(data.current);
  renderQueue();
  await renderLyrics();
  els.status.textContent = '已导入';
}

async function saveTags(songId) {
  const mood = els.views.library.querySelector(`[data-mood="${songId}"]`)?.value ?? '';
  const energy = els.views.library.querySelector(`[data-energy="${songId}"]`)?.value ?? '';
  els.status.textContent = '保存中';
  await api('/api/song/tags', {
    method: 'POST',
    body: JSON.stringify({ songId, mood, energy })
  });
  await renderLibrary();
  els.status.textContent = '标签已保存';
}

async function boot() {
  try {
    const [data, stations] = await Promise.all([
      api('/api/now'),
      api('/api/stations').catch(() => ({ stations: [] }))
    ]);
    state.queue = data.queue || [];
    state.stations = stations.stations ?? [];
    state.preferenceSummary = data.preferenceSummary ?? null;
    await loadDjSettings();
    
    if (data.current) {
      renderSong(data.current);
    }
    renderQueue();
    
    await renderLyrics().catch(() => {});
    await renderProfile().catch(() => {});
    await renderLibrary().catch(() => {});
    await renderNetease().catch(() => {});
    await refreshSleepTimer().catch(() => {});
    await refreshAmbience().catch(() => {});

    els.status.textContent = '就绪';
  } catch (err) {
    console.error('Boot failed:', err);
    els.status.textContent = '服务未连接';
    els.dispatch.textContent = '无法连接服务器，请确认 npm start 正在运行。';
  }

  // WebSocket
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'sleep-expired') {
          fadeOutAndStop(Number(msg.timer?.fadeSec ?? 20));
          els.status.textContent = '睡眠定时到了，正在淡出';
          state.sleepTimer = null;
          renderSleepTimerBadge();
          return;
        }
        if (msg.type === 'now-playing' && msg.sourceClientId !== getClientId()) {
          // Another window changed what is playing. Sync our UI and stop
          // our own audio so we don't double-play.
          if (Array.isArray(msg.queue)) state.queue = msg.queue;
          if (msg.current && msg.current.id !== state.current?.id) {
            state.playing = false;
            pausePlayback();
            renderSong(msg.current);
            renderQueue();
            renderLyrics().catch(() => {});
          }
          if (msg.say) setDispatch(msg.say);
          els.status.textContent = '与另一个窗口同步';
          return;
        }
        if (msg.type === 'transport' && msg.sourceClientId !== getClientId()) {
          if (msg.action === 'pause') setPlaying(false);
          else if (msg.action === 'play') setPlaying(true);
          else if (msg.action === 'toggle') setPlaying(!state.playing);
          return;
        }
        if (msg.type === 'dj-settings' && msg.sourceClientId !== getClientId()) {
          applyDjSettings(msg.settings);
          renderProfile().catch(() => {});
          return;
        }
        if (msg.type === 'plan') {
          state.queue = msg.queue;
          state.preferenceSummary = msg.context?.preferenceSummary ?? state.preferenceSummary;
          renderSong(msg.queue[0]);
          renderQueue();
          const say = setDispatch(msg.say);
          state.lastMood = msg.mood ?? 'unknown';
          els.status.textContent = `定时推荐：${displayMood(msg.mood)}`;
          speak(say);
        }
      } catch (err) {
        console.error('WS message error:', err);
      }
    };
  } catch (err) {
    console.warn('WS connection failed');
  }
}

async function sendMessage() {
  if (els.send.disabled) return;
  const message = els.message.value.trim();
  if (!message) return;
  els.status.textContent = '思考中';
  els.send.disabled = true;
  const sendLabel = els.send.textContent;
  els.send.textContent = '思考中…';
  try {
    state.lastInput = message;
    const plan = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    state.queue = plan.queue;
    state.preferenceSummary = plan.context?.preferenceSummary ?? state.preferenceSummary;
    renderSong(plan.queue[0]);
    renderQueue();
    await renderLyrics();
    const say = setDispatch(plan.say);
    els.message.value = '';
    state.lastMood = plan.mood ?? 'unknown';
    els.status.textContent = plan.mood ? `推荐：${displayMood(plan.mood)}` : '已推荐';
    speak(say);
  } catch (err) {
    els.status.textContent = '出错了';
    els.dispatch.textContent = err.message;
  } finally {
    els.send.disabled = false;
    els.send.textContent = sendLabel;
  }
}

async function sendFeedback(action) {
  if (!state.current) return;
  const note = action === 'like'
    ? '播放器里点了喜欢'
    : action === 'skip'
      ? '播放器里点了跳过'
      : '播放器里标记为不合适';

  els.status.textContent = action === 'like' ? '已喜欢' : action === 'skip' ? '已跳过' : '已标记';
  const data = await api('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      songId: state.current.id,
      action,
      mood: state.lastMood,
      note,
      userInput: state.lastInput
    })
  });
  state.preferenceSummary = data.preferenceSummary ?? state.preferenceSummary;
  if (els.views.profile.classList.contains('active')) {
    renderProfile().catch(() => {});
  }

  if (action === 'skip') {
    await nextSong();
  } else {
    els.status.textContent = '反馈已保存';
  }
}

async function castToSpeaker() {
  if (!state.current) return;
  els.status.textContent = '投放中';
  try {
    const data = await api('/api/cast', {
      method: 'POST',
      body: JSON.stringify({ id: state.current.id, targetId: state.castTargetId || null })
    });
    if (data.error) throw new Error(data.error);
    els.status.textContent = '已投放';
  } catch (err) {
    els.status.textContent = '投放失败';
    els.dispatch.textContent = err.message;
  }
}

function openAirPlayPicker() {
  if (!supportsAirPlay()) {
    els.status.textContent = '当前浏览器不支持 AirPlay';
    return;
  }
  try {
    state.player.webkitShowPlaybackTargetPicker();
    els.status.textContent = '选择 AirPlay 设备';
  } catch (error) {
    els.status.textContent = 'AirPlay 不可用';
    els.dispatch.textContent = error.message;
  }
}

async function playSong(id) {
  const data = await api('/api/play', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  renderSong(data.current);
  await renderLyrics();
  await announceSongBackground(data.current?.id);
  setPlaying(true);
}

async function nextSong() {
  if (state.repeatOne && state.current) {
    state.player.currentTime = 0;
    setPlaying(true);
    return;
  }
  const fromId = state.current?.id;
  const data = await api('/api/next', { method: 'POST', body: '{}' });
  renderSong(data.current);
  await renderLyrics();
  await announceSongBackground(data.current?.id, { fromId });
  setPlaying(true);
}

async function announceSongBackground(songId, { fromId } = {}) {
  if (!state.songBackgroundIntro || !songId || fromId === songId) return;
  try {
    const data = await api('/api/dj/background', {
      method: 'POST',
      body: JSON.stringify({ songId })
    });
    if (data.say) {
      const say = setDispatch(data.say);
      els.status.textContent = '歌曲背景';
      await speak(say);
    }
  } catch (error) {
    console.warn('Song background intro failed:', error);
  }
}

function setPlaying(value) {
  state.playing = value;
  els.play.textContent = value ? 'Ⅱ' : '▶';
  els.cover.classList.toggle('playing', value);
  updateMediaSessionPlaybackState();
  if (value) {
    startPlayback();
  } else {
    pausePlayback();
  }
}

function speak(text) {
  if (!text) return Promise.resolve();
  text = sanitizeDjCopy(text);
  if (!text) return Promise.resolve();
  if (state.ttsStatus?.provider !== 'fish') {
    return speakWithBrowser(text);
  }

  els.status.textContent = 'DJ 朗读中';
  return speakWithFish(text).then(() => {
    els.status.textContent = '朗读完成';
  }).catch((error) => {
    els.status.textContent = 'Fish 语音失败，改用浏览器朗读';
    console.warn('Fish TTS failed:', error);
    return speakWithBrowser(text);
  });
}

async function speakWithFish(text, { voiceId } = {}) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text,
      style: state.voiceStyle,
      voiceId: voiceId ?? state.fishVoiceId ?? undefined
    })
  });
  if (!response.ok) throw new Error(`朗读请求失败，状态码 ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  const finished = new Promise((resolve) => {
    audio.addEventListener('ended', resolve, { once: true });
    audio.addEventListener('error', resolve, { once: true });
  });
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
  await finished;
}

function speakWithBrowser(text) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve();
  speechSynthesis.cancel();
  const clean = text.replace(/^(?:Claudio|此刻):\s*/i, '');
  const spoken = {
    radio: () => {
      const energized = clean.replace(/。/g, '！').replace(/！{2,}/g, '！');
      return /^好[，,]/.test(energized) ? energized : `好，${energized}`;
    },
    whisper: () => {
      const softened = clean.replace(/[！!]/g, '。').replace(/[：:]/g, '，').replace(/。/g, '……');
      return /^嗯[，,]/.test(softened) ? softened : `嗯，${softened}`;
    },
    concise: () => (clean.split(/[。！？.!?]/).find(Boolean)?.trim() || clean).slice(0, 46)
  }[state.voiceStyle]?.() ?? clean;
  const utterance = new SpeechSynthesisUtterance(spoken);
  utterance.lang = 'zh-CN';
  const voice = resolveVoice();
  if (voice) {
    utterance.voice = voice;
    utterance.lang = voice.lang || utterance.lang;
  }
  const voiceStyle = {
    calm: { rate: 1, pitch: 0.96, volume: 0.82 },
    radio: { rate: 1, pitch: 1.08, volume: 1 },
    whisper: { rate: 1, pitch: 0.82, volume: 0.48 },
    concise: { rate: 1, pitch: 1, volume: 0.95 }
  }[state.voiceStyle] ?? { rate: 1, pitch: 0.96, volume: 0.82 };
  utterance.rate = voiceStyle.rate;
  utterance.pitch = voiceStyle.pitch;
  utterance.volume = voiceStyle.volume;
  return new Promise((resolve) => {
    utterance.onend = resolve;
    utterance.onerror = resolve;
    speechSynthesis.speak(utterance);
  });
}

function resolveVoice() {
  if (!state.voices.length) return null;
  const exact = state.voices.find((voice) => voice.name === state.voiceName);
  if (exact) return exact;

  return state.voices.find((voice) => /^zh(-|_)?cn/i.test(voice.lang))
    ?? state.voices.find((voice) => /^zh/i.test(voice.lang))
    ?? state.voices[0];
}

function resolveCastDevice() {
  if (!state.castDevices.length) return null;
  const exact = state.castDevices.find((device) => device.id === state.castTargetId);
  return exact ?? state.castDevices.find((device) => device.selected) ?? state.castDevices[0];
}

function supportsAirPlay() {
  return typeof state.player.webkitShowPlaybackTargetPicker === 'function';
}

function loadVoices() {
  if (!('speechSynthesis' in window)) return;
  const voices = speechSynthesis.getVoices();
  state.voices = voices
    .filter((voice) => voice.lang || voice.name)
    .sort((a, b) => {
      const aZh = /^zh/i.test(a.lang) ? 0 : 1;
      const bZh = /^zh/i.test(b.lang) ? 0 : 1;
      return aZh - bZh || a.name.localeCompare(b.name);
    });

  if (els.views.profile.classList.contains('active')) {
    renderProfile().catch(() => {});
  }
}

function startTone() {
  stopTone();
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext || !state.current) return;

  const context = new AudioContext();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const oscA = context.createOscillator();
  const oscB = context.createOscillator();
  const base = 110 + state.current.energy * 2.1;

  oscA.type = 'sine';
  oscB.type = 'triangle';
  oscA.frequency.value = base;
  oscB.frequency.value = base * 1.5;
  filter.type = 'lowpass';
  filter.frequency.value = 420 + state.current.energy * 12;
  gain.gain.value = 0.0001;

  oscA.connect(filter);
  oscB.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscA.start();
  oscB.start();
  gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.5);

  const pulse = window.setInterval(() => {
    const t = context.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0.065, t + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.035, t + 0.42);
  }, Math.max(360, 980 - state.current.energy * 6));

  state.audio = { context, gain, oscA, oscB, pulse };
}

async function refreshPlayableUrl(song) {
  if (!song || song.provider !== 'netease') return song;
  try {
    const data = await api('/api/song/refresh-url', {
      method: 'POST',
      body: JSON.stringify({ id: song.id })
    });
    state.queue = data.queue ?? state.queue;
    if (data.current) state.current = data.current;
    renderQueue();
    return data.song ?? song;
  } catch (error) {
    console.warn('Failed to refresh NetEase URL:', error);
    return song;
  }
}

async function startPlayback() {
  stopTone();
  const requestedId = state.current?.id;
  const song = await refreshPlayableUrl(state.current);
  if (!state.playing || state.current?.id !== requestedId) return;
  state.current = song;

  if (!song?.url) {
    handlePlaybackFailure();
    return;
  }

  const targetVolume = Number(localStorage.getItem('claudio.volume') ?? state.player.volume);
  const switchingSong = state.player.dataset.songId !== song.id;
  const wasPlayingSomething = switchingSong
    && state.player.src
    && !state.player.paused
    && !state.player.ended
    && state.player.currentTime > 0.3;

  if (switchingSong && state.crossfadeEnabled && wasPlayingSomething) {
    // Hand off to a clone for the fade-out tail so the main player
    // can load the new track and fade in in parallel.
    spawnCrossfadeTail(state.player, targetVolume);
    state.player.removeAttribute('src');
    delete state.player.dataset.songId;
    state.player.load();
    state.player.src = song.url;
    state.player.dataset.songId = song.id;
    state.player.loop = state.repeatOne;
    state.player.volume = 0;
    state.player.play().then(() => {
      fadeMainPlayerIn(targetVolume);
    }).catch(() => handlePlaybackFailure());
    return;
  }

  if (switchingSong) {
    stopPlayback();
    state.player.src = song.url;
    state.player.dataset.songId = song.id;
  }
  state.player.loop = state.repeatOne;
  state.player.volume = targetVolume;
  state.player.play().catch(() => {
    handlePlaybackFailure();
  });
}

function spawnCrossfadeTail(fromPlayer, targetVolume) {
  // If there's already a tail still fading, dispose it so volumes stay sane.
  if (state.crossfadeTail) {
    try { state.crossfadeTail.audio.pause(); } catch {}
    if (state.crossfadeTail.interval) clearInterval(state.crossfadeTail.interval);
  }

  const tail = new Audio();
  tail.src = fromPlayer.src;
  tail.currentTime = fromPlayer.currentTime;
  tail.volume = fromPlayer.volume || targetVolume;
  tail.play().catch(() => {
    // Some browsers deny autoplay on a fresh element; cleanest thing is to drop the tail.
    tail.pause();
    state.crossfadeTail = null;
  });

  const fadeSec = Math.max(1, Math.min(10, state.crossfadeSec));
  const totalMs = fadeSec * 1000;
  const startVolume = tail.volume;
  const startedAt = performance.now();
  const interval = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const ratio = Math.min(1, elapsed / totalMs);
    tail.volume = Math.max(0, startVolume * (1 - ratio));
    if (ratio >= 1) {
      clearInterval(interval);
      try { tail.pause(); } catch {}
      tail.removeAttribute('src');
      tail.load?.();
      if (state.crossfadeTail?.audio === tail) state.crossfadeTail = null;
    }
  }, 60);

  state.crossfadeTail = { audio: tail, interval };
}

function fadeMainPlayerIn(targetVolume) {
  if (state.crossfadeInterval) clearInterval(state.crossfadeInterval);
  const fadeSec = Math.max(1, Math.min(10, state.crossfadeSec));
  const totalMs = fadeSec * 1000;
  const startedAt = performance.now();
  state.crossfadeInterval = setInterval(() => {
    const elapsed = performance.now() - startedAt;
    const ratio = Math.min(1, elapsed / totalMs);
    state.player.volume = Math.max(0, Math.min(1, targetVolume * ratio));
    if (ratio >= 1) {
      clearInterval(state.crossfadeInterval);
      state.crossfadeInterval = null;
      state.player.volume = targetVolume;
    }
  }, 60);
}

// Pre-trigger nextSong just before the current track actually ends so the
// fade-out tail overlaps with the fade-in of the next track.
let crossfadeScheduledForId = null;
function maybeTriggerCrossfade() {
  if (!state.crossfadeEnabled || state.repeatOne || state.sleepFadeInterval) return;
  if (!state.playing || !state.current?.id) return;
  const duration = state.player.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const remaining = duration - state.player.currentTime;
  const fadeSec = Math.max(1, Math.min(10, state.crossfadeSec));
  if (remaining > fadeSec + 0.2) return;
  if (crossfadeScheduledForId === state.current.id) return;
  crossfadeScheduledForId = state.current.id;
  nextSong().catch((error) => {
    console.warn('Crossfade auto-advance failed:', error);
    crossfadeScheduledForId = null;
  });
}

async function handlePlaybackFailure() {
  if (!state.current) {
    startTone();
    return;
  }
  if (state.playbackFailureSongId === state.current.id) return;
  state.handlingPlaybackFailure = true;
  state.playbackFailureSongId = state.current.id;
  els.status.textContent = '播放失败，跳过';
  recordPlaybackProblem().catch(() => {});
  const index = state.queue.findIndex((song) => song.id === state.current.id);
  if (state.queue.length > 1 && index !== -1) {
    try {
      await updateQueue('remove', { id: state.current.id });
      state.handlingPlaybackFailure = false;
      setPlaying(true);
    } catch (error) {
      state.handlingPlaybackFailure = false;
      throw error;
    }
    return;
  }
  startTone();
  state.handlingPlaybackFailure = false;
}

async function recordPlaybackProblem() {
  if (!state.current) return;
  await api('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      songId: state.current.id,
      action: 'bad-fit',
      mood: state.lastMood,
      note: '播放失败或没有可用音频地址',
      userInput: state.lastInput
    })
  });
}

function pausePlayback() {
  stopTone();
  state.player.pause();
}

function stopPlayback() {
  pausePlayback();
  state.player.removeAttribute('src');
  delete state.player.dataset.songId;
  state.player.load();
}

function stopTone() {
  if (!state.audio) return;
  const { context, gain, oscA, oscB, pulse } = state.audio;
  window.clearInterval(pulse);
  const t = context.currentTime;
  gain.gain.cancelScheduledValues(t);
  gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
  window.setTimeout(() => {
    oscA.stop();
    oscB.stop();
    context.close();
  }, 220);
  state.audio = null;
}

function resetTransport() {
  state.duration = 0;
  if (els.progress && !state.seeking) els.progress.value = '0';
  if (els.elapsed) els.elapsed.textContent = '0:00';
  if (els.duration) els.duration.textContent = '0:00';
}

function updateTransport() {
  if (state.seeking) return;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  const current = Number.isFinite(state.player.currentTime) ? state.player.currentTime : 0;
  state.duration = duration;
  if (els.elapsed) els.elapsed.textContent = formatTime(current);
  if (els.duration) els.duration.textContent = formatTime(duration);
  if (els.progress) {
    els.progress.value = duration ? String(Math.round((current / duration) * 1000)) : '0';
  }
  updateLyricHighlight(current);
  if (state.ambientActive) {
    updateAmbientProgress();
    updateAmbientLyric();
  }
}

function updateLyricHighlight(current = state.player.currentTime) {
  if (!state.lyrics.length) return;
  let activeIndex = -1;
  for (let i = 0; i < state.lyrics.length; i += 1) {
    const time = state.lyrics[i].time;
    if (time == null) continue;
    if (time <= current + 0.15) activeIndex = i;
    if (time > current + 0.15) break;
  }

  if (activeIndex === -1) {
    activeIndex = state.lyrics.findIndex((line) => line.time == null);
  }
  if (activeIndex === state.activeLyricIndex) return;

  state.activeLyricIndex = activeIndex;
  const lines = els.views.lyrics.querySelectorAll('[data-lyric-index]');
  lines.forEach((line, index) => {
    const active = index === activeIndex;
    line.classList.toggle('active', active);
    if (active && els.views.lyrics.classList.contains('active')) {
      line.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  });
}

function seekToProgress(value) {
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  if (!duration) return;
  state.player.currentTime = (Number(value) / 1000) * duration;
  updateTransport();
}

function toggleRepeat() {
  state.repeatOne = !state.repeatOne;
  state.player.loop = state.repeatOne;
  localStorage.setItem('claudio.repeatOne', state.repeatOne ? '1' : '0');
  els.repeat.textContent = state.repeatOne ? '单曲循环' : '循环关';
  els.repeat.classList.toggle('active', state.repeatOne);
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.current.title,
    artist: state.current.artist,
    album: state.current.playlistName || state.current.album || '此刻'
  });
  updateMediaSessionPlaybackState();
}

function updateMediaSessionPlaybackState() {
  if (!('mediaSession' in navigator)) return;
  navigator.mediaSession.playbackState = state.playing ? 'playing' : 'paused';
}

els.send.addEventListener('click', sendMessage);
els.message.addEventListener('keydown', (event) => {
  // Enter sends, Shift+Enter inserts a newline (standard chat UX).
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
els.message.addEventListener('input', () => {
  // Auto-grow the textarea up to a max height.
  els.message.style.height = 'auto';
  els.message.style.height = `${Math.min(128, els.message.scrollHeight)}px`;
});

// Quick phrases — one-click common coding moods.
document.querySelectorAll('[data-quick]').forEach((button) => {
  button.addEventListener('click', () => {
    els.message.value = button.dataset.quick;
    sendMessage();
  });
});

els.play.addEventListener('click', () => {
  const next = !state.playing;
  setPlaying(next);
  // Broadcast so the other window (mini ↔ full) stays in sync.
  api('/api/transport', { method: 'POST', body: JSON.stringify({ action: next ? 'play' : 'pause' }) }).catch(() => {});
});
els.next.addEventListener('click', nextSong);
els.prev.addEventListener('click', () => {
  const index = state.queue.findIndex((song) => song.id === state.current?.id);
  const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
  if (previous) playSong(previous.id);
});
els.repeat.addEventListener('click', toggleRepeat);
els.progress.addEventListener('input', (event) => {
  state.seeking = true;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  const current = duration ? (Number(event.target.value) / 1000) * duration : 0;
  els.elapsed.textContent = formatTime(current);
});
els.progress.addEventListener('change', (event) => {
  seekToProgress(event.target.value);
  state.seeking = false;
});
els.volume.addEventListener('input', (event) => {
  const volume = Math.max(0, Math.min(1, Number(event.target.value) / 100));
  state.player.volume = volume;
  localStorage.setItem('claudio.volume', String(volume));
});

window.addEventListener('storage', (event) => {
  if (event.key === 'claudio.songBackgroundIntro') {
    state.songBackgroundIntro = event.newValue !== '0';
  }
  if (event.key === 'claudio.voiceStyle') {
    state.voiceStyle = event.newValue || 'calm';
  }
  if (event.key === 'claudio.fishVoiceId') {
    state.fishVoiceId = event.newValue || '';
  }
});

els.voice.addEventListener('click', () => speak(els.dispatch.textContent));
els.cast.addEventListener('click', castToSpeaker);

els.ambient?.addEventListener('click', toggleAmbientMode);
els.ambientClose?.addEventListener('click', exitAmbientMode);

// Clicking the backdrop (not the stage) exits ambient mode — easy out.
els.ambientMode?.addEventListener('click', (event) => {
  if (event.target === els.ambientMode || event.target === els.ambientBackdrop) {
    exitAmbientMode();
  }
});

els.feedback.addEventListener('click', (event) => {
  const button = event.target.closest('[data-feedback]');
  if (button) sendFeedback(button.dataset.feedback).catch((error) => {
    els.status.textContent = '出错了';
    els.dispatch.textContent = error.message;
  });
});

els.views.queue.addEventListener('click', (event) => {
  const deleteStation = event.target.closest('[data-delete-station]');
  if (deleteStation) {
    deleteCustomStation(deleteStation.dataset.deleteStation).catch((error) => {
      els.status.textContent = '删除失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const station = event.target.closest('[data-station]');
  if (station) {
    playStation(station.dataset.station).catch((error) => {
      els.status.textContent = '调台失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const clear = event.target.closest('[data-queue-clear]');
  if (clear) {
    updateQueue('clear').catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const shuffle = event.target.closest('[data-queue-shuffle]');
  if (shuffle) {
    updateQueue('shuffle').catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const saveStation = event.target.closest('[data-save-station]');
  if (saveStation) {
    saveCurrentQueueAsStation().catch((error) => {
      els.status.textContent = '保存失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const remove = event.target.closest('[data-remove-queue]');
  if (remove) {
    updateQueue('remove', { id: remove.dataset.removeQueue }).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const move = event.target.closest('[data-move-queue]');
  if (move) {
    updateQueue('move', {
      id: move.dataset.moveQueue,
      direction: move.dataset.direction
    }).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const button = event.target.closest('[data-play]');
  if (button) playSong(button.dataset.play);
});

els.views.library.addEventListener('click', (event) => {
  const syncPlaylists = event.target.closest('[data-sync-playlists]');
  if (syncPlaylists) {
    syncPlaylists.disabled = true;
    els.status.textContent = '正在同步已导入歌单...';
    const syncInfoEl = document.querySelector('#syncStatus');
    if (syncInfoEl) syncInfoEl.textContent = '正在同步...';
    api('/api/netease/sync', { method: 'POST', body: '{}' }).then((data) => {
      if (data.skipped) {
        els.status.textContent = '未配置网易云接口';
      } else {
        state.neteaseLastSync = { syncedAt: data.syncedAt, totalAdded: data.totalAdded };
        els.status.textContent = `同步完成：新增 ${data.totalAdded} 首`;
      }
      return renderLibrary();
    }).catch((error) => {
      els.status.textContent = '同步失败';
      els.dispatch.textContent = error.message;
    }).finally(() => {
      syncPlaylists.disabled = false;
    });
    return;
  }

  const keepDuplicate = event.target.closest('[data-keep-duplicate]');
  if (keepDuplicate) {
    els.status.textContent = '处理重复项';
    api('/api/library/duplicates', {
      method: 'POST',
      body: JSON.stringify({ action: 'keep', id: keepDuplicate.dataset.keepDuplicate })
    }).then((data) => {
      els.status.textContent = `已隐藏同组 ${Math.max(0, (data.changed ?? 1) - 1)} 首`;
      return renderLibrary();
    }).catch((error) => {
      els.status.textContent = '处理失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const unhideGroup = event.target.closest('[data-unhide-duplicate-group]');
  if (unhideGroup) {
    els.status.textContent = '恢复重复组';
    api('/api/library/duplicates', {
      method: 'POST',
      body: JSON.stringify({ action: 'unhide-group', id: unhideGroup.dataset.unhideDuplicateGroup })
    }).then((data) => {
      els.status.textContent = `已恢复 ${data.changed ?? 0} 首`;
      return renderLibrary();
    }).catch((error) => {
      els.status.textContent = '恢复失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const cleanMissingUrl = event.target.closest('[data-clean-missing-url]');
  if (cleanMissingUrl) {
    els.status.textContent = '清理中';
    api('/api/library/cleanup', {
      method: 'POST',
      body: JSON.stringify({ action: 'missing-url' })
    }).then((data) => {
      els.status.textContent = `已清理 ${data.removed} 首`;
      return renderLibrary();
    }).catch((error) => {
      els.status.textContent = '清理失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const playImported = event.target.closest('[data-play-imported-playlist]');
  if (playImported) {
    playImportedPlaylist(playImported.dataset.playImportedPlaylist).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const shuffleImported = event.target.closest('[data-shuffle-imported-playlist]');
  if (shuffleImported) {
    playImportedPlaylist(shuffleImported.dataset.shuffleImportedPlaylist, true).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const save = event.target.closest('[data-save-tags]');
  if (save) {
    saveTags(save.dataset.saveTags).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const button = event.target.closest('[data-play]');
  if (button) playSong(button.dataset.play);
});

els.views.profile.addEventListener('click', (event) => {
  const sleepButton = event.target.closest('[data-sleep-timer]');
  if (sleepButton) {
    const minutes = Number(sleepButton.dataset.sleepTimer);
    setSleepTimer(minutes).catch((error) => {
      els.status.textContent = '睡眠定时失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }

  const refreshHealth = event.target.closest('[data-refresh-health]');
  if (refreshHealth) {
    els.status.textContent = '体检中';
    renderProfile().then(() => {
      els.status.textContent = '体检完成';
    }).catch((error) => {
      els.status.textContent = '体检失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }

  const exportButton = event.target.closest('[data-export-backup]');
  if (exportButton) {
    exportBackup().catch((error) => {
      els.status.textContent = '导出失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }

  const refreshCast = event.target.closest('[data-refresh-cast]');
  if (refreshCast) {
    els.status.textContent = '正在扫描音箱';
    api('/api/cast/devices?refresh=1').then((data) => {
      state.castDevices = data.devices ?? [];
      els.status.textContent = `找到 ${state.castDevices.length} 个音箱`;
      return renderProfile();
    }).catch((error) => {
      els.status.textContent = '扫描失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }

  const airplay = event.target.closest('[data-airplay]');
  if (airplay) {
    openAirPlayPicker();
    return;
  }

  const test = event.target.closest('[data-test-voice]');
  if (test) {
    speak('此刻: 这就是新的 DJ 声音。我少说两句，让它更像一个人在旁边说话。');
    return;
  }

  const copy = event.target.closest('[data-copy-url]');
  if (!copy) return;
  navigator.clipboard?.writeText(copy.dataset.copyUrl).then(() => {
    els.status.textContent = '已复制';
  }).catch(() => {
    els.status.textContent = '复制失败';
  });
});

els.views.profile.addEventListener('change', (event) => {
  if (event.target.id === 'songBackgroundIntroToggle') {
    saveDjSettings({ songBackgroundIntro: event.target.checked });
    els.status.textContent = event.target.checked ? '歌曲背景播报已开' : '歌曲背景播报已关';
    return;
  }
  if (event.target.id === 'crossfadeToggle') {
    state.crossfadeEnabled = event.target.checked;
    localStorage.setItem('claudio.crossfade', state.crossfadeEnabled ? '1' : '0');
    els.status.textContent = state.crossfadeEnabled ? '交叉淡化已开' : '交叉淡化已关';
    return;
  }
  if (event.target.id === 'crossfadeSecRange') {
    state.crossfadeSec = Number(event.target.value) || 3;
    localStorage.setItem('claudio.crossfadeSec', String(state.crossfadeSec));
    const infoLabel = event.target.parentElement?.querySelector('span');
    if (infoLabel) infoLabel.textContent = `交叉淡化 ${state.crossfadeSec} 秒`;
    return;
  }

  if (event.target.id === 'voiceSelect') {
    state.voiceName = event.target.value;
    if (state.voiceName) {
      localStorage.setItem('claudio.voiceName', state.voiceName);
    } else {
      localStorage.removeItem('claudio.voiceName');
    }
    els.status.textContent = '声音已保存';
    return;
  }

  if (event.target.id === 'fishVoiceSelect') {
    saveDjSettings({ fishVoiceId: event.target.value });
    const current = els.views.profile.querySelector('.voice-current');
    const label = event.target.selectedOptions?.[0]?.textContent?.trim();
    if (current && label) current.textContent = label;
    els.status.textContent = 'DJ 声音已保存';
    return;
  }

  if (event.target.id === 'voiceStyleSelect') {
    saveDjSettings({ voiceStyle: event.target.value || 'calm' });
    els.status.textContent = '声音风格已保存';
    renderProfile().catch(() => {});
    return;
  }

  if (event.target.id === 'castTargetSelect') {
    state.castTargetId = event.target.value;
    if (state.castTargetId) {
      localStorage.setItem('claudio.castTargetId', state.castTargetId);
    } else {
      localStorage.removeItem('claudio.castTargetId');
    }
    els.status.textContent = '音箱已保存';
  }
});

els.views.netease.addEventListener('click', (event) => {
  const loadPlaylists = event.target.closest('#neteaseLoadPlaylists');
  if (loadPlaylists) {
    loadNeteasePlaylists().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const selectAll = event.target.closest('#neteaseSelectAll');
  if (selectAll) {
    els.views.netease.querySelectorAll('[data-select-playlist]').forEach((input) => {
      input.checked = selectAll.checked;
    });
    return;
  }
  const importSelected = event.target.closest('#neteaseImportSelected');
  if (importSelected) {
    importSelectedNeteasePlaylists().catch((error) => {
      els.status.textContent = '批量导入失败';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const previewSavedPlaylist = event.target.closest('[data-preview-playlist]');
  if (previewSavedPlaylist) {
    const input = document.querySelector('#neteasePlaylist');
    if (input) input.value = previewSavedPlaylist.dataset.previewPlaylist;
    previewNeteasePlaylist().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const importSavedPlaylist = event.target.closest('[data-import-playlist]');
  if (importSavedPlaylist) {
    importNeteasePlaylistById(importSavedPlaylist.dataset.importPlaylist).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const previewPlaylist = event.target.closest('#neteasePreviewPlaylist');
  if (previewPlaylist) {
    previewNeteasePlaylist().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const importPlaylist = event.target.closest('#neteaseImportPlaylist');
  if (importPlaylist) {
    importNeteasePlaylist().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const search = event.target.closest('#neteaseSearch');
  if (search) {
    searchNetease().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const imported = event.target.closest('[data-import-netease]');
  if (imported) {
    importNetease(imported.dataset.importNetease).catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
  }
});

els.views.netease.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'neteaseUserId') {
    loadNeteasePlaylists().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
  }
  if (event.key === 'Enter' && event.target.id === 'neteasePlaylist') {
    previewNeteasePlaylist().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
  }
  if (event.key === 'Enter' && event.target.id === 'neteaseQuery') {
    searchNetease().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
  }
});

state.player.addEventListener('loadedmetadata', updateTransport);
state.player.addEventListener('durationchange', updateTransport);
state.player.addEventListener('timeupdate', updateTransport);
state.player.addEventListener('timeupdate', maybeTriggerCrossfade);
state.player.addEventListener('error', handlePlaybackFailure);
state.player.addEventListener('playing', () => {
  state.playbackFailureSongId = '';
  state.handlingPlaybackFailure = false;
  crossfadeScheduledForId = null;
});
state.player.addEventListener('play', () => {
  state.playing = true;
  els.play.textContent = 'Ⅱ';
  els.cover.classList.add('playing');
  updateMediaSessionPlaybackState();
});
state.player.addEventListener('pause', () => {
  if (!state.audio) {
    state.playing = false;
    els.play.textContent = '▶';
    els.cover.classList.remove('playing');
    updateMediaSessionPlaybackState();
  }
});
state.player.addEventListener('ended', nextSong);

function setMediaAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Some browsers expose Media Session but support only part of the action set.
  }
}

if ('mediaSession' in navigator) {
  setMediaAction('play', () => setPlaying(true));
  setMediaAction('pause', () => setPlaying(false));
  setMediaAction('nexttrack', nextSong);
  setMediaAction('previoustrack', () => {
    const index = state.queue.findIndex((song) => song.id === state.current?.id);
    const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
    if (previous) playSong(previous.id);
  });
  setMediaAction('seekto', (details) => {
    if (details.seekTime != null) {
      state.player.currentTime = details.seekTime;
    }
  });
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((item) => item.classList.toggle('active', item === tab));
    Object.entries(els.views).forEach(([key, view]) => {
      view.classList.toggle('active', key === tab.dataset.tab);
    });
  });
});

// --- Lyrics interactions ---
async function copyLyricLine(text) {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    }
    return true;
  } catch {
    return false;
  }
}

els.views.lyrics.addEventListener('click', (event) => {
  const line = event.target.closest('[data-lyric-index]');
  if (!line) return;
  const timeAttr = line.getAttribute('data-lyric-time');
  if (timeAttr == null) return;
  const seconds = Number(timeAttr);
  if (!Number.isFinite(seconds)) return;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  if (duration > 0 && seconds <= duration) {
    state.player.currentTime = Math.max(0, seconds);
    updateTransport();
    if (!state.playing) setPlaying(true);
    els.status.textContent = `跳到 ${formatTime(seconds)}`;
  }
});

els.views.lyrics.addEventListener('dblclick', async (event) => {
  const line = event.target.closest('[data-lyric-index]');
  if (!line) return;
  const ok = await copyLyricLine(line.textContent.trim());
  els.status.textContent = ok ? '已复制歌词' : '复制失败';
});

els.views.lyrics.addEventListener('contextmenu', async (event) => {
  const line = event.target.closest('[data-lyric-index]');
  if (!line) return;
  event.preventDefault();
  const ok = await copyLyricLine(line.textContent.trim());
  els.status.textContent = ok ? '已复制歌词' : '复制失败';
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

loadVoices();
if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener('voiceschanged', loadVoices);
}

// Keyboard shortcuts — ignored while the user is typing in an input/textarea.
function isTypingTarget(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (target.isContentEditable) return true;
  return false;
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  const key = event.key;

  if (key === ' ' || key === 'Spacebar') {
    event.preventDefault();
    setPlaying(!state.playing);
    return;
  }
  if (key === 'ArrowRight') {
    event.preventDefault();
    nextSong().catch((error) => {
      els.status.textContent = '出错了';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  if (key === 'ArrowLeft') {
    event.preventDefault();
    const index = state.queue.findIndex((song) => song.id === state.current?.id);
    const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
    if (previous) playSong(previous.id).catch(() => {});
    return;
  }
  if (key === 'l' || key === 'L') {
    event.preventDefault();
    sendFeedback('like').catch(() => {});
    return;
  }
  if (key === 's' || key === 'S') {
    event.preventDefault();
    sendFeedback('skip').catch(() => {});
    return;
  }
  if (key === 'b' || key === 'B') {
    event.preventDefault();
    sendFeedback('bad-fit').catch(() => {});
    return;
  }
  if (key === 'm' || key === 'M') {
    event.preventDefault();
    toggleMute();
    return;
  }
  if (key === '/') {
    event.preventDefault();
    els.message?.focus();
    return;
  }
  if (key === '?') {
    event.preventDefault();
    toggleShortcutHelp();
    return;
  }
  if (key === 'f' || key === 'F') {
    event.preventDefault();
    toggleAmbientMode();
    return;
  }
  if (key === 'Escape' && state.ambientActive) {
    event.preventDefault();
    exitAmbientMode();
    return;
  }
});

function toggleMute() {
  if (state.player.volume > 0) {
    state.preMuteVolume = state.player.volume;
    state.player.volume = 0;
    els.volume.value = '0';
    els.status.textContent = '静音';
  } else {
    const restore = Number(state.preMuteVolume ?? localStorage.getItem('claudio.volume') ?? 0.82);
    state.player.volume = restore;
    els.volume.value = String(Math.round(restore * 100));
    els.status.textContent = '取消静音';
  }
}

let shortcutHelpEl = null;
function toggleShortcutHelp() {
  if (shortcutHelpEl) {
    shortcutHelpEl.remove();
    shortcutHelpEl = null;
    return;
  }
  shortcutHelpEl = document.createElement('div');
  shortcutHelpEl.className = 'shortcut-help';
  shortcutHelpEl.innerHTML = `
    <div class="shortcut-card">
      <p class="label">键盘快捷键</p>
      <ul>
        <li><kbd>空格</kbd> 播放 / 暂停</li>
        <li><kbd>←</kbd> / <kbd>→</kbd> 上一首 / 下一首</li>
        <li><kbd>L</kbd> 喜欢</li>
        <li><kbd>S</kbd> 跳过</li>
        <li><kbd>B</kbd> 不合适</li>
        <li><kbd>M</kbd> 静音</li>
        <li><kbd>F</kbd> 氛围模式</li>
        <li><kbd>/</kbd> 聚焦到对话框</li>
        <li><kbd>?</kbd> 打开 / 关闭此帮助</li>
      </ul>
      <p class="hint">按任意键关闭</p>
    </div>
  `;
  document.body.appendChild(shortcutHelpEl);
  shortcutHelpEl.addEventListener('click', () => toggleShortcutHelp());
  setTimeout(() => {
    const dismiss = (e) => {
      if (isTypingTarget(e.target)) return;
      toggleShortcutHelp();
      window.removeEventListener('keydown', dismiss);
    };
    window.addEventListener('keydown', dismiss, { once: true });
  }, 100);
}

boot().catch((error) => {
  els.status.textContent = '出错了';
  els.dispatch.textContent = error.message;
});
