# Claudio

Claudio is a local-first personal AI radio MVP. It runs a Node.js server, serves a mobile PWA player, stores listening state in SQLite, and uses mock music data while the real music provider is still unconnected.

## Run

```bash
npm run dev
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
- DeepSeek or OpenAI LLM planner when API keys are configured
- Local rule fallback when no API key is configured or the LLM request fails
- Local music library scanning from `library/` and `~/Music`
- Real audio streaming for local mp3/m4a/wav/flac/aac/ogg files
- Like / skip / bad-fit feedback that is included in future LLM planning
- Editable local song mood and energy tags
- NetEase Cloud Music API compatible search and import when `NETEASE_API_BASE` is configured
- Browser speech synthesis for DJ announcements
- Optional cached Fish Audio TTS when `FISH_API_KEY` is configured
- Web Audio preview tone when no real local audio exists
- SQLite-backed play history and current state
- Editable personal context files in `user/`

## Add Music

Put audio files here:

```txt
/Users/zhuanz/music-agent/library
```

Supported extensions:

```txt
mp3, m4a, wav, flac, aac, ogg
```

Claudio also scans:

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
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_MODEL=deepseek-v4-flash

OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4o-mini
```

Use `LLM_PROVIDER=deepseek`, `LLM_PROVIDER=openai`, or leave API keys empty to use local rules.

Restart the server:

```bash
npm run dev
```

When `LLM_PROVIDER=deepseek`, `/api/chat` uses DeepSeek's OpenAI-compatible Chat Completions API. When `LLM_PROVIDER=openai`, it uses the OpenAI Responses API with Structured Outputs. If the API call fails, Claudio falls back to local recommendation rules.

## Main API

- `GET /api/now`
- `POST /api/chat`
- `POST /api/play`
- `POST /api/next`
- `POST /api/feedback`
- `POST /api/song/tags`
- `GET /api/search?q=focus`
- `GET /api/lyric?id=mock-002`
- `GET /api/taste`
- `GET /api/library`
- `POST /api/library/scan`
- `GET /api/network`
- `GET /api/netease/status`
- `GET /api/netease/search?q=...`
- `POST /api/netease/import`
- `GET /api/tts/status`
- `POST /api/tts`
- `GET /api/audio?id=local-...`

## NetEase Provider

Claudio expects a `NeteaseCloudMusicApi` compatible service.

```txt
NETEASE_API_BASE=http://127.0.0.1:3000
NETEASE_LEVEL=exhigh
```

Required compatible endpoints:

- `/search?keywords=...&type=1&limit=...`
- `/song/url/v1?id=...&level=...`
- `/lyric?id=...`

## Next Integrations

- Add QR code display for phone access.
- Add DJ voice selection.
- Add UPnP/AirPlay target output after real audio streams are available.
