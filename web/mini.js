const state = {
  current: null,
  queue: [],
  playing: false,
  repeatOne: false,
  seeking: false,
  lastMood: 'unknown',
  lastInput: '',
  ttsStatus: null,
  playbackFailureSongId: '',
  handlingPlaybackFailure: false,
  sleepTimer: null,
  sleepFadeInterval: null,
  clientId: null,
  uiState: 'loading',
  lyrics: [],
  activeLyricIndex: -1,
  lyricRequestId: 0,
  crossfadeEnabled: localStorage.getItem('claudio.crossfade') !== '0',
  crossfadeSec: Number(localStorage.getItem('claudio.crossfadeSec') ?? '3'),
  crossfadeInterval: null,
  crossfadeTail: null,
  handoffInProgress: false,
  player: new Audio()
};

const els = {
  mini: document.querySelector('#mini'),
  status: document.querySelector('#status'),
  cover: document.querySelector('#cover'),
  title: document.querySelector('#title'),
  artist: document.querySelector('#artist'),
  lyricStrip: document.querySelector('#lyricStrip'),
  lyricLine: document.querySelector('#lyricLine'),
  dispatch: document.querySelector('#dispatch'),
  queuePreview: document.querySelector('#queuePreview'),
  queueCount: document.querySelector('#queueCount'),
  message: document.querySelector('#message'),
  send: document.querySelector('#send'),
  play: document.querySelector('#play'),
  prev: document.querySelector('#prev'),
  next: document.querySelector('#next'),
  progress: document.querySelector('#progress'),
  elapsed: document.querySelector('#elapsed'),
  duration: document.querySelector('#duration'),
  volume: document.querySelector('#volume'),
  openFull: document.querySelector('#openFull'),
  sleepTimer: document.querySelector('#sleepTimer'),
  sleepMenu: document.querySelector('#sleepMenu'),
  quit: document.querySelector('#quit'),
  feedback: document.querySelectorAll('[data-feedback]')
};

state.player.volume = Number(localStorage.getItem('claudio.volume') ?? '0.82');
els.volume.value = String(Math.round(state.player.volume * 100));

const bridge = window.cike ?? window.claudio ?? null;

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', 'x-client-id': getClientId() };
  const response = await fetch(path, {
    ...options,
    headers: { ...headers, ...(options.headers ?? {}) }
  });
  if (!response.ok) {
    let message = `请求失败 ${response.status}`;
    try {
      const data = await response.json();
      message = data.error ?? message;
    } catch {
      // use default
    }
    throw new Error(message);
  }
  return response.json();
}

function getClientId() {
  if (state.clientId) return state.clientId;
  let id = sessionStorage.getItem('claudio.clientId.mini');
  if (!id) {
    id = `mini-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    sessionStorage.setItem('claudio.clientId.mini', id);
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

function setStatus(text, mode = 'ready') {
  state.uiState = mode;
  if (els.status) els.status.textContent = text;
  if (els.mini) els.mini.dataset.state = mode;
  syncMiniClasses();
}

function syncMiniClasses() {
  if (!els.mini) return;
  els.mini.classList.toggle('playing', state.playing);
  els.mini.classList.toggle('sleep-active', Boolean(state.sleepTimer));
  els.mini.classList.toggle('syncing', state.uiState === 'syncing');
}

function setButtonBusy(button, value) {
  if (!button) return;
  button.classList.toggle('busy', value);
  button.disabled = value;
}

async function withButtonBusy(button, action) {
  if (button?.disabled) return undefined;
  setButtonBusy(button, true);
  try {
    return await action();
  } finally {
    setButtonBusy(button, false);
  }
}

function queuePreviewSongs() {
  const currentId = state.current?.id;
  return (state.queue ?? [])
    .filter((song) => song?.id && song.id !== currentId)
    .slice(0, 2);
}

function renderQueuePreview() {
  if (!els.queuePreview) return;
  const upcoming = queuePreviewSongs();
  const upcomingTotal = (state.queue ?? [])
    .filter((song) => song?.id && song.id !== state.current?.id)
    .length;
  if (els.queueCount) els.queueCount.textContent = String(upcomingTotal);
  if (!upcoming.length) {
    els.queuePreview.innerHTML = '<p>这一段先让当前歌曲自己走。</p>';
    return;
  }
  els.queuePreview.innerHTML = upcoming.map((song) => `
    <div class="queue-item">
      <span>${escapeHtml(song.title)} · ${escapeHtml(song.artist)}</span>
    </div>
  `).join('');
}

function setMiniLyric(text, mode = 'active') {
  if (els.lyricLine) els.lyricLine.textContent = text || '暂无歌词';
  if (els.lyricStrip) els.lyricStrip.dataset.lyricState = mode;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
}

function normalizeLyricLine(line, index) {
  if (typeof line === 'string') return { time: null, text: line.trim(), index };
  return {
    time: Number.isFinite(Number(line?.time)) ? Number(line.time) : null,
    text: String(line?.text ?? '').trim(),
    index
  };
}

function activeLyricIndexFor(current, duration) {
  if (!state.lyrics.length) return -1;
  const hasTimes = state.lyrics.some((line) => Number.isFinite(line.time));
  if (hasTimes) {
    let activeIndex = -1;
    for (let i = 0; i < state.lyrics.length; i += 1) {
      const time = state.lyrics[i].time;
      if (!Number.isFinite(time)) continue;
      if (time <= current + 0.15) activeIndex = i;
      if (time > current + 0.15) break;
    }
    if (activeIndex >= 0) return activeIndex;
    const untimed = state.lyrics.findIndex((line) => line.time == null);
    return untimed >= 0 ? untimed : 0;
  }
  if (duration > 0) {
    const ratio = Math.max(0, Math.min(0.999, current / duration));
    return Math.floor(ratio * state.lyrics.length);
  }
  return 0;
}

function updateLyricLine(current = state.player.currentTime, { force = false } = {}) {
  if (!state.lyrics.length) return;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  const activeIndex = activeLyricIndexFor(current, duration);
  if (activeIndex < 0 || (!force && activeIndex === state.activeLyricIndex)) return;
  const line = state.lyrics[activeIndex];
  if (!line?.text) return;
  state.activeLyricIndex = activeIndex;
  setMiniLyric(line.text, 'active');
}

async function renderLyrics(song = state.current) {
  const requestId = state.lyricRequestId + 1;
  state.lyricRequestId = requestId;
  state.lyrics = [];
  state.activeLyricIndex = -1;
  setMiniLyric('歌词调频中', 'loading');

  if (!song?.id) {
    setMiniLyric('暂无歌词', 'empty');
    return;
  }

  try {
    const data = await api(`/api/lyric?id=${encodeURIComponent(song.id)}`);
    if (requestId !== state.lyricRequestId) return;
    state.lyrics = (data.lyric ?? [])
      .map(normalizeLyricLine)
      .filter((line) => line.text);
    state.activeLyricIndex = -1;
    if (state.lyrics.length) {
      const current = state.player.dataset.songId === song.id ? state.player.currentTime : 0;
      updateLyricLine(current, { force: true });
    } else {
      setMiniLyric('暂无歌词', 'empty');
    }
  } catch {
    if (requestId === state.lyricRequestId) setMiniLyric('歌词暂时不可用', 'empty');
  }
}

function renderSong(song) {
  if (!song) return;
  state.current = song;
  if (state.playbackFailureSongId !== song.id) {
    state.playbackFailureSongId = '';
    state.handlingPlaybackFailure = false;
  }
  els.title.textContent = song.title;
  els.title.title = song.title;
  els.artist.textContent = `${song.artist} · ${song.album === 'Local Files' ? '本地曲库' : song.album}`;
  els.artist.title = els.artist.textContent;
  els.cover.style.background = song.cover;
  updateMediaSession();
  resetTransport();
  renderQueuePreview();
  renderLyrics(song).catch(() => {});
  if (state.playing) startPlayback();
}

function sanitizeDjCopy(text = '') {
  let clean = String(text)
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
  if (!text) return '';
  const clean = sanitizeDjCopy(text);
  if (clean) els.dispatch.textContent = clean;
  return clean;
}

async function boot() {
  setStatus('启动中', 'loading');
  syncMiniClasses();
  try {
    const data = await api('/api/now');
    state.queue = data.queue ?? [];
    if (data.current) renderSong(data.current);
    renderQueuePreview();
    setStatus('就绪', 'ready');
  } catch (error) {
    setStatus('未连接', 'error');
    els.dispatch.textContent = '连接不到服务器，请检查 npm run dev 是否运行。';
    syncMiniClasses();
    return;
  }

  try {
    state.ttsStatus = await api('/api/tts/status');
  } catch {
    state.ttsStatus = null;
  }

  try {
    const timer = await api('/api/sleep-timer');
    state.sleepTimer = timer.timer;
    updateSleepBadge();
  } catch {
    // ignore
  }

  connectWebSocket();
  syncMiniClasses();
}

function updateSleepBadge() {
  if (!els.sleepTimer) return;
  if (state.sleepTimer) {
    if (els.sleepMenu) els.sleepMenu.hidden = true;
    const mins = Math.max(1, Math.ceil(Number(state.sleepTimer.remainingMs ?? 0) / 60000));
    els.sleepTimer.textContent = `☾ ${mins}`;
    els.sleepTimer.classList.add('active');
    els.sleepTimer.title = `睡眠定时：${mins} 分钟后淡出`;
    els.sleepTimer.setAttribute('aria-expanded', 'false');
  } else {
    els.sleepTimer.textContent = '☾';
    els.sleepTimer.classList.remove('active');
    els.sleepTimer.title = '设置睡眠定时';
  }
  syncMiniClasses();
}

function setSleepMenuOpen(open) {
  if (!els.sleepMenu || !els.sleepTimer) return;
  els.sleepMenu.hidden = !open;
  els.sleepTimer.setAttribute('aria-expanded', open ? 'true' : 'false');
}

async function clearSleepTimer() {
  await api('/api/sleep-timer', {
    method: 'POST',
    body: JSON.stringify({ action: 'clear' })
  });
  state.sleepTimer = null;
  setStatus('已取消睡眠定时', 'ready');
  updateSleepBadge();
}

async function setSleepTimerMinutes(minutes) {
  const data = await api('/api/sleep-timer', {
    method: 'POST',
    body: JSON.stringify({ minutes, fadeSec: 20 })
  });
  state.sleepTimer = data.timer;
  setStatus(`睡眠定时 ${minutes} 分钟`, 'ready');
  updateSleepBadge();
}

function fadeOutAndStop(fadeSec = 20) {
  const totalMs = Math.max(1, fadeSec) * 1000;
  const startVolume = state.player.volume;
  const startedAt = performance.now();
  stopCrossfadeTail();
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

function connectWebSocket() {
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'sleep-expired') {
          fadeOutAndStop(Number(msg.timer?.fadeSec ?? 20));
          state.sleepTimer = null;
          updateSleepBadge();
          setStatus('睡眠到了，淡出中', 'ready');
          return;
        }
        if (msg.type === 'now-playing' && msg.sourceClientId !== getClientId()) {
          if (Array.isArray(msg.queue)) state.queue = msg.queue;
          if (msg.current && msg.current.id !== state.current?.id) {
            state.playing = false;
            pausePlayback();
            renderSong(msg.current);
          }
          renderQueuePreview();
          if (msg.say) setDispatch(msg.say);
          setStatus('同步中', 'syncing');
          setTimeout(() => {
            if (state.uiState === 'syncing') {
              setStatus('已同步', 'ready');
              syncMiniClasses();
            }
          }, 900);
          return;
        }
        if (msg.type === 'transport' && msg.sourceClientId !== getClientId()) {
          if (msg.action === 'pause') setPlaying(false);
          else if (msg.action === 'play') setPlaying(true);
          else if (msg.action === 'toggle') setPlaying(!state.playing);
          return;
        }
        if (msg.type === 'plan' && msg.queue?.length) {
          state.queue = msg.queue;
          renderSong(msg.queue[0]);
          renderQueuePreview();
          const say = setDispatch(msg.say);
          state.lastMood = msg.mood ?? 'unknown';
          setStatus('定时推荐', 'ready');
          speak(say);
        }
      } catch {
        // ignore
      }
    };
  } catch {
    // ignore
  }
}

async function sendMessage() {
  if (els.send.disabled) return;
  const message = els.message.value.trim();
  if (!message) return;
  setStatus('思考中', 'thinking');
  els.send.disabled = true;
  els.send.classList.add('busy');
  const sendLabel = els.send.textContent;
  els.send.textContent = '思考';
  try {
    state.lastInput = message;
    const plan = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message })
    });
    state.queue = plan.queue ?? [];
    if (plan.queue?.[0]) renderSong(plan.queue[0]);
    renderQueuePreview();
    const say = setDispatch(plan.say);
    els.message.value = '';
    state.lastMood = plan.mood ?? 'unknown';
    setStatus('已推荐', 'ready');
    speak(say);
    setPlaying(true);
  } catch (error) {
    setStatus('出错了', 'error');
    els.dispatch.textContent = error.message;
  } finally {
    els.send.disabled = false;
    els.send.classList.remove('busy');
    els.send.textContent = sendLabel;
    syncMiniClasses();
  }
}

async function sendFeedback(action) {
  if (!state.current) return;
  const button = document.querySelector(`[data-feedback="${action}"]`);
  const note = action === 'like'
    ? 'Mini 里点了喜欢'
    : action === 'skip' ? 'Mini 里点了跳过' : 'Mini 里标记为不合适';
  setStatus(action === 'like' ? '已喜欢' : action === 'skip' ? '已跳过' : '已标记', 'ready');
  setButtonBusy(button, true);
  try {
    await api('/api/feedback', {
      method: 'POST',
      body: JSON.stringify({
        songId: state.current.id,
        action,
        mood: state.lastMood,
        note,
        userInput: state.lastInput
      })
    });
    if (action === 'skip') await nextSong();
  } catch (error) {
    setStatus('反馈失败', 'error');
    els.dispatch.textContent = error.message;
  } finally {
    setTimeout(() => setButtonBusy(button, false), 420);
  }
}

async function playSong(id) {
  const data = await api('/api/play', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  renderSong(data.current);
  renderQueuePreview();
  setPlaying(true);
}

async function nextSong() {
  if (state.repeatOne && state.current) {
    state.player.currentTime = 0;
    setPlaying(true);
    return;
  }
  const data = await api('/api/next', { method: 'POST', body: '{}' });
  state.queue = data.queue ?? state.queue;
  renderSong(data.current);
  renderQueuePreview();
  setPlaying(true);
}

async function prevSong() {
  const index = state.queue.findIndex((song) => song.id === state.current?.id);
  const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
  if (previous) await playSong(previous.id);
}

function setPlaying(value) {
  state.playing = value;
  els.play.textContent = value ? 'Ⅱ' : '▶';
  els.cover.classList.toggle('playing', value);
  syncMiniClasses();
  updateMediaSessionPlaybackState();
  if (value) startPlayback();
  else pausePlayback();
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
    renderQueuePreview();
    return data.song ?? song;
  } catch {
    return song;
  }
}

async function startPlayback() {
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

  if (switchingSong && state.crossfadeEnabled && wasPlayingSomething && !state.sleepFadeInterval) {
    spawnCrossfadeTail(state.player, targetVolume);
    if (state.crossfadeInterval) clearInterval(state.crossfadeInterval);
    state.crossfadeInterval = null;
    state.handoffInProgress = true;
    state.player.removeAttribute('src');
    delete state.player.dataset.songId;
    state.player.load();
    state.player.src = song.url;
    state.player.dataset.songId = song.id;
    state.player.loop = state.repeatOne;
    state.player.volume = 0;
    state.player.play().then(() => {
      state.handoffInProgress = false;
      fadeMainPlayerIn(targetVolume);
    }).catch(() => {
      state.handoffInProgress = false;
      handlePlaybackFailure();
    });
    return;
  }

  if (switchingSong) {
    stopPlayback();
    state.player.src = song.url;
    state.player.dataset.songId = song.id;
  }
  state.player.loop = state.repeatOne;
  state.player.volume = targetVolume;
  state.player.play().catch(() => handlePlaybackFailure());
}

function stopCrossfadeTail() {
  if (state.crossfadeTail) {
    try { state.crossfadeTail.audio.pause(); } catch {}
    if (state.crossfadeTail.interval) clearInterval(state.crossfadeTail.interval);
    state.crossfadeTail = null;
  }
  if (state.crossfadeInterval) {
    clearInterval(state.crossfadeInterval);
    state.crossfadeInterval = null;
  }
}

function spawnCrossfadeTail(fromPlayer, targetVolume) {
  stopCrossfadeTail();
  const tail = new Audio();
  tail.src = fromPlayer.src;
  tail.currentTime = fromPlayer.currentTime;
  tail.volume = fromPlayer.volume || targetVolume;
  tail.play().catch(() => {
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

let crossfadeScheduledForId = null;
function maybeTriggerCrossfade() {
  if (!state.crossfadeEnabled || state.repeatOne || state.sleepFadeInterval) return;
  if (!state.playing || !state.current?.id) return;
  const duration = state.player.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const fadeSec = Math.max(1, Math.min(10, state.crossfadeSec));
  const remaining = duration - state.player.currentTime;
  if (remaining > fadeSec + 0.2) return;
  if (crossfadeScheduledForId === state.current.id) return;
  crossfadeScheduledForId = state.current.id;
  nextSong().catch(() => {
    crossfadeScheduledForId = null;
  });
}

async function handlePlaybackFailure() {
  if (state.handoffInProgress) return;
  if (!state.current) return;
  if (state.playbackFailureSongId === state.current.id) return;
  state.handlingPlaybackFailure = true;
  state.playbackFailureSongId = state.current.id;
  setStatus('播放失败，跳过', 'error');
  try {
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
  } catch {
    // ignore
  }
  await nextSong();
  state.handlingPlaybackFailure = false;
  syncMiniClasses();
}

function pausePlayback() {
  state.player.pause();
  stopCrossfadeTail();
}

function stopPlayback() {
  state.handoffInProgress = false;
  pausePlayback();
  state.player.removeAttribute('src');
  delete state.player.dataset.songId;
  state.player.load();
}

function resetTransport() {
  if (!state.seeking) els.progress.value = '0';
  els.elapsed.textContent = '0:00';
  els.duration.textContent = '0:00';
}

function updateTransport() {
  if (state.seeking) return;
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  const current = Number.isFinite(state.player.currentTime) ? state.player.currentTime : 0;
  els.elapsed.textContent = formatTime(current);
  els.duration.textContent = formatTime(duration);
  els.progress.value = duration ? String(Math.round((current / duration) * 1000)) : '0';
  updateLyricLine(current);
}

function seekToProgress(value) {
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  if (!duration) return;
  state.player.currentTime = (Number(value) / 1000) * duration;
  updateTransport();
}

function speak(text) {
  if (!text) return;
  text = sanitizeDjCopy(text);
  if (!text) return;
  if (state.ttsStatus?.provider === 'fish') {
    speakWithFish(text).catch(() => speakWithBrowser(text));
  } else {
    speakWithBrowser(text);
  }
}

async function speakWithFish(text) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, style: 'calm' })
  });
  if (!response.ok) throw new Error(`朗读失败 ${response.status}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.addEventListener('ended', () => URL.revokeObjectURL(url), { once: true });
  await audio.play();
}

function speakWithBrowser(text) {
  if (!('speechSynthesis' in window) || !text) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/^(?:Claudio|此刻):\s*/i, ''));
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
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

// --- Event bindings ---

els.send.addEventListener('click', sendMessage);
els.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendMessage();
});

els.play.addEventListener('click', () => {
  if (els.play.disabled) return;
  const next = !state.playing;
  setPlaying(next);
  setButtonBusy(els.play, true);
  api('/api/transport', { method: 'POST', body: JSON.stringify({ action: next ? 'play' : 'pause' }) })
    .catch(() => {})
    .finally(() => setButtonBusy(els.play, false));
});
els.next.addEventListener('click', () => {
  withButtonBusy(els.next, nextSong).catch((error) => {
    setStatus('切歌失败', 'error');
    els.dispatch.textContent = error.message;
  });
});
els.prev.addEventListener('click', () => {
  withButtonBusy(els.prev, prevSong).catch((error) => {
    setStatus('切歌失败', 'error');
    els.dispatch.textContent = error.message;
  });
});

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
  if (state.crossfadeInterval) {
    clearInterval(state.crossfadeInterval);
    state.crossfadeInterval = null;
  }
  state.player.volume = volume;
  localStorage.setItem('claudio.volume', String(volume));
});

els.feedback.forEach((button) => {
  button.addEventListener('click', () => {
    sendFeedback(button.dataset.feedback).catch((error) => {
      setStatus('出错了', 'error');
      els.dispatch.textContent = error.message;
    });
  });
});

els.openFull.addEventListener('click', () => {
  const url = `${window.location.origin}/`;
  if (bridge?.openExternal) {
    bridge.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
});

els.sleepTimer?.addEventListener('click', () => {
  if (state.sleepTimer) {
    withButtonBusy(els.sleepTimer, clearSleepTimer).catch((error) => {
      setStatus('睡眠定时失败', 'error');
      els.dispatch.textContent = error.message;
    });
    return;
  }
  setSleepMenuOpen(els.sleepMenu?.hidden !== false);
});

els.sleepMenu?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-mini-sleep]');
  if (!button) return;
  const minutes = Number(button.dataset.miniSleep);
  if (!Number.isFinite(minutes) || minutes <= 0) return;
  setSleepMenuOpen(false);
  withButtonBusy(button, () => setSleepTimerMinutes(minutes)).catch((error) => {
    setStatus('睡眠定时失败', 'error');
    els.dispatch.textContent = error.message;
  });
});

document.addEventListener('click', (event) => {
  if (!els.sleepMenu || els.sleepMenu.hidden) return;
  if (els.sleepMenu.contains(event.target) || els.sleepTimer?.contains(event.target)) return;
  setSleepMenuOpen(false);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') setSleepMenuOpen(false);
});

els.quit.addEventListener('click', () => {
  if (bridge?.quit) {
    bridge.quit();
  } else {
    window.close();
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
  state.handoffInProgress = false;
  crossfadeScheduledForId = null;
});
state.player.addEventListener('play', () => {
  state.playing = true;
  els.play.textContent = 'Ⅱ';
  els.cover.classList.add('playing');
  syncMiniClasses();
  updateMediaSessionPlaybackState();
});
state.player.addEventListener('pause', () => {
  if (state.handoffInProgress) return;
  state.playing = false;
  els.play.textContent = '▶';
  els.cover.classList.remove('playing');
  syncMiniClasses();
  updateMediaSessionPlaybackState();
});
state.player.addEventListener('ended', () => {
  if (crossfadeScheduledForId === state.current?.id) return;
  nextSong();
});

if ('mediaSession' in navigator) {
  const trySet = (action, handler) => {
    try { navigator.mediaSession.setActionHandler(action, handler); } catch {}
  };
  trySet('play', () => setPlaying(true));
  trySet('pause', () => setPlaying(false));
  trySet('nexttrack', nextSong);
  trySet('previoustrack', prevSong);
}

// Bridge-driven media keys (from Electron globalShortcut)
if (bridge?.on) {
  bridge.on('media', (action) => {
    if (action === 'playpause') setPlaying(!state.playing);
    if (action === 'next') nextSong();
    if (action === 'prev') prevSong();
  });
}

// Keyboard shortcuts inside the mini window
function isTypingTargetMini(target) {
  if (!target) return false;
  const tag = (target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea';
}

window.addEventListener('keydown', (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTargetMini(event.target)) return;
  const key = event.key;

  if (key === ' ' || key === 'Spacebar') {
    event.preventDefault();
    setPlaying(!state.playing);
  } else if (key === 'ArrowRight') {
    event.preventDefault();
    nextSong();
  } else if (key === 'ArrowLeft') {
    event.preventDefault();
    prevSong();
  } else if (key === 'l' || key === 'L') {
    event.preventDefault();
    sendFeedback('like').catch(() => {});
  } else if (key === 's' || key === 'S') {
    event.preventDefault();
    sendFeedback('skip').catch(() => {});
  } else if (key === 'b' || key === 'B') {
    event.preventDefault();
    sendFeedback('bad-fit').catch(() => {});
  } else if (key === '/') {
    event.preventDefault();
    els.message?.focus();
  }
});

boot().catch((error) => {
  setStatus('出错了', 'error');
  els.dispatch.textContent = error.message;
  syncMiniClasses();
});
