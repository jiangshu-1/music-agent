const state = {
  current: null,
  queue: [],
  speaking: false,
  playing: false,
  audio: null,
  lastMood: 'unknown',
  lastInput: '',
  preferenceSummary: null,
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
  feedback: document.querySelector('.feedback'),
  play: document.querySelector('#play'),
  next: document.querySelector('#next'),
  prev: document.querySelector('#prev'),
  voice: document.querySelector('#voice'),
  cast: document.querySelector('#cast'),
  tabs: document.querySelectorAll('.tabs button'),
  views: {
    queue: document.querySelector('#queueView'),
    lyrics: document.querySelector('#lyricsView'),
    library: document.querySelector('#libraryView'),
    netease: document.querySelector('#neteaseView'),
    profile: document.querySelector('#profileView')
  }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function renderSong(song) {
  if (!song) return;
  state.current = song;
  els.title.textContent = song.title;
  els.artist.textContent = `${song.artist} · ${song.album}`;
  els.cover.style.background = song.cover;
  if (state.playing) startPlayback();
}

function renderQueue() {
  if (!state.queue.length) {
    els.views.queue.innerHTML = '<p class="empty-note">暂无待播放歌曲</p>';
    return;
  }
  els.views.queue.innerHTML = state.queue.map((song) => `
    <article class="song-row">
      <div class="swatch" style="background:${song.cover}"></div>
      <div>
        <h3>${song.title}</h3>
        <p>${song.artist} · energy ${song.energy}</p>
      </div>
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
        <p>${song.artist} · energy ${song.energy}</p>
        ${editable ? `
          <div class="tag-editor">
            <input type="text" value="${song.mood.join(', ')}" data-mood="${song.id}" aria-label="mood tags">
            <input type="number" min="0" max="100" value="${song.energy}" data-energy="${song.id}" aria-label="energy">
            <button type="button" data-save-tags="${song.id}">save</button>
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
    els.views.lyrics.innerHTML = (data.lyric || []).map((line) => `<p>${line}</p>`).join('');
  } catch (err) {
    els.views.lyrics.innerHTML = '<p>暂无歌词</p>';
  }
}

async function renderProfile() {
  const data = await api('/api/taste');
  const network = await api('/api/network');
  const tts = await api('/api/tts/status');
  const summary = state.preferenceSummary;
  els.views.profile.innerHTML = `
    <div class="profile-section">
      <p class="label">Taste & Routines</p>
      <pre>${data.taste}</pre>
      <pre>${data.routines}</pre>
      <pre>${data.moodRules}</pre>
    </div>
    <div class="preference-summary">
      <p class="label">AI Memory (DJ 偏好记忆)</p>
      <pre>${summary ? summary.summaryText : '还没有足够反馈，DJ 正在观察你的听歌习惯。'}</pre>
    </div>
    <div class="phone-access">
      <p class="label">Phone Access (手机访问)</p>
      ${network.addresses.length ? network.addresses.map((item) => `
        <div class="phone-row">
          <code>${item.url}</code>
          <button type="button" data-copy-url="${item.url}">copy</button>
        </div>
      `).join('') : '<p>No LAN address found</p>'}
    </div>
    <p class="tts-info">TTS provider: ${tts.provider}${tts.model ? ` (${tts.model})` : ''}</p>
  `;
}

async function renderLibrary() {
  const data = await api('/api/library');
  const songs = data.songs.slice(0, 48);
  const note = data.count
    ? `已扫描到 ${data.count} 首本地音乐。`
    : '库里还是空的。请往 library/ 文件夹放歌。';

  els.views.library.innerHTML = `
    <p class="library-note">${note}<span class="library-path">${data.writableImportDir}</span></p>
    ${renderSongRows(songs, { editable: true })}
  `;
}

async function renderNetease() {
  const status = await api('/api/netease/status');
  els.views.netease.innerHTML = `
    <div class="netease-search">
      <input id="neteaseQuery" type="text" placeholder="搜索网易云歌曲">
      <button id="neteaseSearch" type="button">search</button>
    </div>
    <p class="library-note">${status.configured ? `NetEase API: ${status.base}` : 'NetEase API 未配置。'}</p>
    <div id="neteaseResults"></div>
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
      <button type="button" data-import-netease="${song.id}">import</button>
    </article>
  `).join('');
  target.dataset.results = JSON.stringify(songs);
}

async function searchNetease() {
  const query = document.querySelector('#neteaseQuery')?.value.trim();
  if (!query) return;
  els.status.textContent = 'searching';
  const data = await api(`/api/netease/search?q=${encodeURIComponent(query)}`);
  renderNeteaseResults(data.results);
  els.status.textContent = `${data.results.length} found`;
}

async function importNetease(songId) {
  const results = JSON.parse(document.querySelector('#neteaseResults')?.dataset.results ?? '[]');
  const song = results.find((item) => item.id === songId);
  if (!song) return;
  els.status.textContent = 'importing';
  const data = await api('/api/netease/import', {
    method: 'POST',
    body: JSON.stringify({ song })
  });
  state.queue = data.queue;
  renderSong(data.current);
  renderQueue();
  await renderLyrics();
  els.status.textContent = 'imported';
}

async function saveTags(songId) {
  const mood = els.views.library.querySelector(`[data-mood="${songId}"]`)?.value ?? '';
  const energy = els.views.library.querySelector(`[data-energy="${songId}"]`)?.value ?? '';
  els.status.textContent = 'saving';
  await api('/api/song/tags', {
    method: 'POST',
    body: JSON.stringify({ songId, mood, energy })
  });
  await renderLibrary();
  els.status.textContent = 'tags saved';
}

async function boot() {
  try {
    const data = await api('/api/now');
    state.queue = data.queue || [];
    state.preferenceSummary = data.preferenceSummary ?? null;
    
    if (data.current) {
      renderSong(data.current);
    }
    renderQueue();
    
    await renderLyrics().catch(() => {});
    await renderProfile().catch(() => {});
    await renderLibrary().catch(() => {});
    await renderNetease().catch(() => {});
    
    els.status.textContent = 'ready';
  } catch (err) {
    console.error('Boot failed:', err);
    els.status.textContent = 'server offline';
    els.dispatch.textContent = '无法连接服务器，请确认 npm start 正在运行。';
  }

  // WebSocket
  try {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'plan') {
          state.queue = msg.queue;
          state.preferenceSummary = msg.context?.preferenceSummary ?? state.preferenceSummary;
          renderSong(msg.queue[0]);
          renderQueue();
          els.dispatch.textContent = msg.say;
          state.lastMood = msg.mood ?? 'unknown';
          els.status.textContent = `scheduled:${msg.mood}`;
          speak(msg.say);
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
  const message = els.message.value.trim();
  if (!message) return;
  els.status.textContent = 'thinking';
  els.send.disabled = true;
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
    els.dispatch.textContent = plan.say;
    els.message.value = '';
    state.lastMood = plan.mood ?? 'unknown';
    els.status.textContent = plan.planner ? `${plan.planner}:${plan.mood}` : plan.mood;
    speak(plan.say);
  } catch (err) {
    els.status.textContent = 'error';
    els.dispatch.textContent = err.message;
  } finally {
    els.send.disabled = false;
  }
}

async function sendFeedback(action) {
  if (!state.current) return;
  const note = action === 'like'
    ? 'liked from player'
    : action === 'skip'
      ? 'skipped from player'
      : 'marked as bad fit from player';

  els.status.textContent = action;
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
    els.status.textContent = `saved:${action}`;
  }
}

async function castToSpeaker() {
  if (!state.current) return;
  els.status.textContent = 'casting';
  try {
    const data = await api('/api/cast', {
      method: 'POST',
      body: JSON.stringify({ id: state.current.id })
    });
    if (data.error) throw new Error(data.error);
    els.status.textContent = 'casted';
  } catch (err) {
    els.status.textContent = 'cast failed';
    els.dispatch.textContent = err.message;
  }
}

async function playSong(id) {
  const data = await api('/api/play', {
    method: 'POST',
    body: JSON.stringify({ id })
  });
  renderSong(data.current);
  await renderLyrics();
  setPlaying(true);
}

async function nextSong() {
  const data = await api('/api/next', { method: 'POST', body: '{}' });
  renderSong(data.current);
  await renderLyrics();
  setPlaying(true);
}

function setPlaying(value) {
  state.playing = value;
  els.play.textContent = value ? 'Ⅱ' : '▶';
  els.cover.classList.toggle('playing', value);
  if (value) {
    startPlayback();
  } else {
    stopPlayback();
  }
}

function speak(text) {
  if (!text) return;
  speakWithFish(text).catch(() => speakWithBrowser(text));
}

async function speakWithFish(text) {
  const response = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!response.ok) throw new Error(`TTS HTTP ${response.status}`);
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

function startPlayback() {
  stopPlayback();
  if (!state.current?.url) {
    startTone();
    return;
  }

  state.player.src = state.current.url;
  state.player.loop = false;
  state.player.play().catch(() => {
    startTone();
  });
}

function stopPlayback() {
  stopTone();
  state.player.pause();
  state.player.removeAttribute('src');
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

els.send.addEventListener('click', sendMessage);
els.message.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendMessage();
});

els.play.addEventListener('click', () => setPlaying(!state.playing));
els.next.addEventListener('click', nextSong);
els.prev.addEventListener('click', () => {
  const index = state.queue.findIndex((song) => song.id === state.current?.id);
  const previous = state.queue[(index - 1 + state.queue.length) % state.queue.length];
  if (previous) playSong(previous.id);
});

els.voice.addEventListener('click', () => speak(els.dispatch.textContent));
els.cast.addEventListener('click', castToSpeaker);

els.feedback.addEventListener('click', (event) => {
  const button = event.target.closest('[data-feedback]');
  if (button) sendFeedback(button.dataset.feedback).catch((error) => {
    els.status.textContent = 'error';
    els.dispatch.textContent = error.message;
  });
});

els.views.queue.addEventListener('click', (event) => {
  const button = event.target.closest('[data-play]');
  if (button) playSong(button.dataset.play);
});

els.views.library.addEventListener('click', (event) => {
  const save = event.target.closest('[data-save-tags]');
  if (save) {
    saveTags(save.dataset.saveTags).catch((error) => {
      els.status.textContent = 'error';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const button = event.target.closest('[data-play]');
  if (button) playSong(button.dataset.play);
});

els.views.profile.addEventListener('click', (event) => {
  const copy = event.target.closest('[data-copy-url]');
  if (!copy) return;
  navigator.clipboard?.writeText(copy.dataset.copyUrl).then(() => {
    els.status.textContent = 'copied';
  }).catch(() => {
    els.status.textContent = 'copy failed';
  });
});

els.views.netease.addEventListener('click', (event) => {
  const search = event.target.closest('#neteaseSearch');
  if (search) {
    searchNetease().catch((error) => {
      els.status.textContent = 'error';
      els.dispatch.textContent = error.message;
    });
    return;
  }
  const imported = event.target.closest('[data-import-netease]');
  if (imported) {
    importNetease(imported.dataset.importNetease).catch((error) => {
      els.status.textContent = 'error';
      els.dispatch.textContent = error.message;
    });
  }
});

els.views.netease.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'neteaseQuery') {
    searchNetease().catch((error) => {
      els.status.textContent = 'error';
      els.dispatch.textContent = error.message;
    });
  }
});

state.player.addEventListener('ended', nextSong);

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    els.tabs.forEach((item) => item.classList.toggle('active', item === tab));
    Object.entries(els.views).forEach(([key, view]) => {
      view.classList.toggle('active', key === tab.dataset.tab);
    });
  });
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then((registration) => {
    registration.update().catch(() => {});
  }).catch(() => {});
}

boot().catch((error) => {
  els.status.textContent = 'error';
  els.dispatch.textContent = error.message;
});
