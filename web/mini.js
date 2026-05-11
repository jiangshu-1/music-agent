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
  player: new Audio()
};

const els = {
  status: document.querySelector('#status'),
  cover: document.querySelector('#cover'),
  title: document.querySelector('#title'),
  artist: document.querySelector('#artist'),
  dispatch: document.querySelector('#dispatch'),
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
  quit: document.querySelector('#quit'),
  feedback: document.querySelectorAll('[data-feedback]')
};

state.player.volume = Number(localStorage.getItem('claudio.volume') ?? '0.82');
els.volume.value = String(Math.round(state.player.volume * 100));

const bridge = window.claudio ?? null;

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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return `${minutes}:${rest}`;
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
  if (state.playing) startPlayback();
}

function setDispatch(text) {
  if (!text) return;
  els.dispatch.textContent = text.replace(/^Claudio:\s*/i, '');
}

async function boot() {
  try {
    const data = await api('/api/now');
    state.queue = data.queue ?? [];
    if (data.current) renderSong(data.current);
    els.status.textContent = '就绪';
  } catch (error) {
    els.status.textContent = '未连接';
    els.dispatch.textContent = '连接不到服务器，请检查 npm run dev 是否运行。';
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
}

function updateSleepBadge() {
  if (!els.sleepTimer) return;
  if (state.sleepTimer) {
    const mins = Math.max(1, Math.ceil(Number(state.sleepTimer.remainingMs ?? 0) / 60000));
    els.sleepTimer.textContent = `☾ ${mins}`;
    els.sleepTimer.classList.add('active');
    els.sleepTimer.title = `睡眠定时：${mins} 分钟后淡出`;
  } else {
    els.sleepTimer.textContent = '☾';
    els.sleepTimer.classList.remove('active');
    els.sleepTimer.title = '设置睡眠定时';
  }
}

async function toggleSleepTimer() {
  if (state.sleepTimer) {
    await api('/api/sleep-timer', {
      method: 'POST',
      body: JSON.stringify({ action: 'clear' })
    });
    state.sleepTimer = null;
    els.status.textContent = '已取消睡眠定时';
  } else {
    const input = window.prompt('几分钟后自动停？', '30');
    const minutes = Number(input);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const data = await api('/api/sleep-timer', {
      method: 'POST',
      body: JSON.stringify({ minutes, fadeSec: 20 })
    });
    state.sleepTimer = data.timer;
    els.status.textContent = `睡眠定时 ${minutes} 分钟`;
  }
  updateSleepBadge();
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
          els.status.textContent = '睡眠到了，淡出中';
          return;
        }
        if (msg.type === 'now-playing' && msg.sourceClientId !== getClientId()) {
          if (Array.isArray(msg.queue)) state.queue = msg.queue;
          if (msg.current && msg.current.id !== state.current?.id) {
            state.playing = false;
            pausePlayback();
            renderSong(msg.current);
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
        if (msg.type === 'plan' && msg.queue?.length) {
          state.queue = msg.queue;
          renderSong(msg.queue[0]);
          setDispatch(msg.say);
          state.lastMood = msg.mood ?? 'unknown';
          els.status.textContent = '定时推荐';
          speak(msg.say);
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
    state.queue = plan.queue ?? [];
    if (plan.queue?.[0]) renderSong(plan.queue[0]);
    setDispatch(plan.say);
    els.message.value = '';
    state.lastMood = plan.mood ?? 'unknown';
    els.status.textContent = '已推荐';
    speak(plan.say);
    setPlaying(true);
  } catch (error) {
    els.status.textContent = '出错了';
    els.dispatch.textContent = error.message;
  } finally {
    els.send.disabled = false;
    els.send.textContent = sendLabel;
  }
}

async function sendFeedback(action) {
  if (!state.current) return;
  const note = action === 'like'
    ? 'Mini 里点了喜欢'
    : action === 'skip' ? 'Mini 里点了跳过' : 'Mini 里标记为不合适';
  els.status.textContent = action === 'like' ? '已喜欢' : action === 'skip' ? '已跳过' : '已标记';
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
    els.status.textContent = '反馈失败';
    els.dispatch.textContent = error.message;
  }
}

async function playSong(id) {
  const data = await api('/api/play', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  renderSong(data.current);
  setPlaying(true);
}

async function nextSong() {
  if (state.repeatOne && state.current) {
    state.player.currentTime = 0;
    setPlaying(true);
    return;
  }
  const data = await api('/api/next', { method: 'POST', body: '{}' });
  renderSong(data.current);
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

  if (state.player.dataset.songId !== song.id) {
    stopPlayback();
    state.player.src = song.url;
    state.player.dataset.songId = song.id;
  }
  state.player.loop = state.repeatOne;
  state.player.play().catch(() => handlePlaybackFailure());
}

async function handlePlaybackFailure() {
  if (!state.current) return;
  if (state.playbackFailureSongId === state.current.id) return;
  state.handlingPlaybackFailure = true;
  state.playbackFailureSongId = state.current.id;
  els.status.textContent = '播放失败，跳过';
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
}

function pausePlayback() {
  state.player.pause();
}

function stopPlayback() {
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
}

function seekToProgress(value) {
  const duration = Number.isFinite(state.player.duration) ? state.player.duration : 0;
  if (!duration) return;
  state.player.currentTime = (Number(value) / 1000) * duration;
  updateTransport();
}

function speak(text) {
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
  const utterance = new SpeechSynthesisUtterance(text.replace(/^Claudio:\s*/, ''));
  utterance.lang = 'zh-CN';
  utterance.rate = 0.95;
  speechSynthesis.speak(utterance);
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: state.current.title,
    artist: state.current.artist,
    album: state.current.playlistName || state.current.album || 'Claudio'
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
  const next = !state.playing;
  setPlaying(next);
  api('/api/transport', { method: 'POST', body: JSON.stringify({ action: next ? 'play' : 'pause' }) }).catch(() => {});
});
els.next.addEventListener('click', nextSong);
els.prev.addEventListener('click', prevSong);

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

els.feedback.forEach((button) => {
  button.addEventListener('click', () => {
    sendFeedback(button.dataset.feedback).catch((error) => {
      els.status.textContent = '出错了';
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
  toggleSleepTimer().catch((error) => {
    els.status.textContent = '睡眠定时失败';
    els.dispatch.textContent = error.message;
  });
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
state.player.addEventListener('error', handlePlaybackFailure);
state.player.addEventListener('playing', () => {
  state.playbackFailureSongId = '';
  state.handlingPlaybackFailure = false;
});
state.player.addEventListener('play', () => {
  state.playing = true;
  els.play.textContent = 'Ⅱ';
  els.cover.classList.add('playing');
  updateMediaSessionPlaybackState();
});
state.player.addEventListener('pause', () => {
  state.playing = false;
  els.play.textContent = '▶';
  els.cover.classList.remove('playing');
  updateMediaSessionPlaybackState();
});
state.player.addEventListener('ended', nextSong);

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
  els.status.textContent = '出错了';
  els.dispatch.textContent = error.message;
});
