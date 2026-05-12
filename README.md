# 此刻

此刻 is a local-first personal AI radio MVP. It runs a Node.js server, serves a mobile PWA player, stores listening state in SQLite, and uses mock music data while the real music provider is still unconnected.

## Run

```bash
npm run dev
```

To start 此刻 and the local NetEase-compatible provider together:

```bash
npm run dev:all
```

To start the desktop menubar mini player (boots the server if it is not running):

```bash
npm run desktop:dev
```

To run a read-only smoke check against a running 此刻 server:

```bash
npm run smoke
```

To run syntax checks plus smoke checks:

```bash
npm run check
```

To run the Node test suite directly:

```bash
npm test
```

Open:

```txt
http://127.0.0.1:8080
```

On your phone, use the LAN address printed by `npm run dev`, for example:

```txt
http://192.168.1.14:8080
```

## What Works Now

- Mobile-first PWA player UI
- Natural-language DJ input
- 9router, DeepSeek, or OpenAI LLM planner when API keys are configured
- Local rule fallback when no API key is configured or the LLM request fails
- Local music library scanning from `library/` and `~/Music`
- Real audio streaming for local mp3/m4a/wav/flac/aac/ogg files
- Like / skip / bad-fit feedback that is included in future LLM planning
- Editable local song mood and energy tags
- NetEase Cloud Music API compatible search and import when `NETEASE_API_BASE` is configured
- Browser speech synthesis for DJ announcements
- Optional cached Fish Audio TTS when `FISH_API_KEY` is configured
- Browser DJ voice selection saved per device
- Web Audio preview tone when no real local audio exists
- UPnP MediaRenderer discovery and selectable speaker casting
- SQLite-backed play history and current state
- Editable personal context files in `user/`
- Desktop menubar mini player with global media-key shortcuts (Electron)
- Sleep timer that fades out playback when it expires
- Automatic DJ intros between tracks, with frequency control
- Queue auto-refill so the station keeps running when the queue thins out
- 7-day listening insights: top artists, moods, hourly distribution, feedback counts
- Crossfade between tracks for a smoother station feel (configurable 1–8s)
- Nightly incremental sync of imported NetEase playlists (pulls only new tracks)

## Add Music

Put audio files here:

```txt
/Users/zhuanz/music-agent/library
```

Supported extensions:

```txt
mp3, m4a, wav, flac, aac, ogg
```

此刻 also scans:

```txt
/Users/zhuanz/Music
```

After adding files, restart the server or call:

```bash
curl -s -X POST http://127.0.0.1:8080/api/library/scan
```

## Add A Real LLM

Create a local `.env` file:

```bash
cp .env.example .env
```

Edit `.env`:

```txt
LLM_PROVIDER=9router
LLM_FALLBACK_PROVIDER=deepseek
NINEROUTER_BASE_URL=http://127.0.0.1:20128/v1
NINEROUTER_API_KEY=your_9router_api_key_here
NINEROUTER_MODEL=kr/claude-sonnet-4.5

DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-v4-flash

OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini

FISH_API_KEY=your_fish_api_key_here
FISH_MODEL=s2-pro
FISH_USER_ID=self
FISH_REFERENCE_ID=optional_voice_model_id
FISH_SPEED=1
FISH_LATENCY=balanced
```

Use `LLM_PROVIDER=9router`, `LLM_PROVIDER=deepseek`, `LLM_PROVIDER=openai`, or leave API keys empty to use local rules. Set `LLM_FALLBACK_PROVIDER=deepseek` to try DeepSeek before falling back to local recommendation rules.

Restart the server:

```bash
npm run dev
```

When `LLM_PROVIDER=9router`, `/api/chat` uses the configured 9router OpenAI-compatible Chat Completions endpoint. When `LLM_PROVIDER=deepseek`, it uses DeepSeek's OpenAI-compatible Chat Completions API. When `LLM_PROVIDER=openai`, it uses the OpenAI Responses API with Structured Outputs. If the primary API call fails and `LLM_FALLBACK_PROVIDER` is set, 此刻 tries that fallback provider before local recommendation rules.

For a more natural DJ voice, configure Fish Audio. `FISH_REFERENCE_ID` pins the DJ to one reusable Fish voice model; leave it empty to use Fish's default voice. 此刻 checks Fish API credit through `wallet/{FISH_USER_ID}/api-credit` and caches generated DJ lines in `data/tts-cache/`.

## Main API

- `GET /api/now`
- `POST /api/chat`
- `POST /api/play`
- `POST /api/next`
- `GET /api/queue`
- `POST /api/queue`
- `GET /api/stations`
- `POST /api/station/play`
- `POST /api/station/save`
- `POST /api/station/delete`
- `POST /api/feedback`
- `POST /api/feedback/cleanup`
- `POST /api/song/tags`
- `GET /api/search?q=focus`
- `GET /api/playlists`
- `GET /api/playlist/songs?id=...`
- `POST /api/playlist/play`
- `GET /api/lyric?id=mock-002`
- `GET /api/taste`
- `GET /api/library`
- `GET /api/library/stats`
- `POST /api/library/cleanup`
- `GET /api/library/duplicates`
- `POST /api/library/duplicates`
- `POST /api/library/scan`
- `GET /api/health`
- `GET /api/backup`
- `GET /api/network`
- `GET /api/netease/status`
- `GET /api/netease/search?q=...`
- `POST /api/netease/import`
- `GET /api/netease/playlist?id=...`
- `POST /api/netease/playlist/import`
- `GET /api/tts/status`
- `POST /api/tts`
- `POST /api/song/refresh-url`
- `GET /api/audio?id=local-...`
- `GET /api/insights?days=7`
- `GET /api/sleep-timer`
- `POST /api/sleep-timer`
- `POST /api/dj/intro`
- `POST /api/netease/sync`
- `GET /api/netease/sync/status`

## NetEase Provider

此刻 expects a `NeteaseCloudMusicApi` compatible service.

Start the local provider in another terminal:

```bash
npm run netease
```

```txt
NETEASE_API_BASE=http://127.0.0.1:3000
NETEASE_LEVEL=exhigh
NETEASE_USER_ID=your_netease_user_id
NETEASE_COOKIE=your_netease_cookie_here
```

Required compatible endpoints:

- `/search?keywords=...&type=1&limit=...`
- `/user/playlist?uid=...`
- `/song/url/v1?id=...&level=...`
- `/lyric?id=...`
- `/playlist/detail?id=...`
- `/playlist/track/all?id=...&limit=...`

## Product Roadmap

1. Library scale-up
   - [x] Batch import NetEase playlists from the user's account.
   - [x] Keep imported playlist provenance, health stats, duplicate review, and reversible cleanup.
   - [x] Add refresh/relink for expired NetEase playback URLs.

2. Playback reliability
   - [x] Auto-skip failed tracks, record bad-fit feedback, and keep the queue moving.
   - [x] Add queue reorder, save queue as station, and smarter shuffle by mood/energy.
   - [x] Add playback URL refresh before a NetEase track starts.

3. DJ intelligence
   - [x] Use listening history, likes/skips, routines, and imported playlist context in every plan.
   - [x] Add daily stations: focus, late night, discovery, commute, and sleep.
   - [x] Let the DJ explain why a track was chosen without breaking the music flow.

4. Voice and presence
   - [x] Keep Fish Audio as the preferred DJ voice and cache generated lines.
   - [x] Add voice style presets: calm host, radio DJ, whisper, and concise.
   - [x] Add automatic spoken intros only at useful transitions, not every click.

5. Output and device control
   - [x] Harden UPnP casting and expose connection state.
   - [x] Add AirPlay-compatible output when the browser exposes a reliable native picker.
   - [x] Keep phone PWA controls first-class for couch/desk listening.

6. Packaging and operations
   - [x] Add a one-command local start flow for 此刻 plus the NetEase provider.
   - [x] Add health checks for Fish credit, NetEase cookie, local audio paths, and speaker targets.
   - [x] Add a lightweight backup/export for preferences, history, and imported playlists.

7. Desktop presence
   - [x] macOS menubar mini player (Electron) that reuses all web APIs.
   - [x] Global shortcut (`⌘+Shift+M`) + system media keys wired to the mini player.
   - [x] Auto-starts the 此刻 server if it is not already running.

8. Night flow
   - [x] Server-side sleep timer with configurable fade-out.
   - [x] Sleep-expiry broadcast over WebSocket so every connected client fades together.

9. Listening insight
   - [x] 7/30-day aggregated view of plays, unique artists, top moods, hourly distribution.
   - [x] Feedback totals surfaced next to the insights for quick self-calibration.

10. Flow and freshness
    - [x] Crossfade between tracks for seamless radio-style transitions.
    - [x] Nightly incremental sync of imported NetEase playlists (`03:30` local), plus a manual "立即同步" button in the library view.

## Tests

The service refactor tests live in `tests/` and use Node's built-in `node:test` runner. `npm run check` runs syntax checks, then `npm test`, then the HTTP smoke checks.
