# 此刻

此刻 is a local-first personal AI radio MVP. It runs a Node.js server, serves a mobile PWA player, stores listening state in SQLite, and uses mock music data while the real music provider is still unconnected.

## 怎么把这个项目跑起来

如果你只是想先试一下，不用想太多，按下面几步来就行。这个项目是本地运行的，代码拉到你自己电脑上以后，启动一个 Node 服务，然后用浏览器打开播放器。

### 1. 先确认电脑能跑 Node

你电脑上需要有这几个东西：

- Git，用来从 GitLab 把代码拉下来。
- Node.js 22 或更高版本。
- npm，一般装 Node.js 的时候会一起装好。

打开终端，先看一下有没有装好：

```bash
git --version
node -v
npm -v
```

看到版本号就说明有。这里重点看 `node -v`，最好是 `v22.x.x` 或更高。如果 Node 版本低于 22，先升级，不然后面可能会启动失败。

### 2. 把代码拉到你电脑上

在 GitLab 项目页面点 `Code` / `Clone`，复制 HTTPS 地址，大概长这样：

```txt
https://gitlab.com/你的用户名/music-agent.git
```

然后在终端里执行：

```bash
git clone https://gitlab.com/你的用户名/music-agent.git
cd music-agent
```

拉下来以后可以看一眼目录：

```bash
ls
```

如果能看到 `package.json`、`README.md`、`server`、`web`，就说明代码已经在你电脑上了。

如果这个仓库是私有的，我需要先把你加到 GitLab 项目里。不要用我的账号、密码、Token 去跑，也不要把自己的密钥发给别人。

### 3. 安装依赖

进到项目目录以后，跑这个：

```bash
npm install
```

这一步就是把项目要用的包都装上。装完以后，项目目录里会多一个 `node_modules` 文件夹。只要中间没有一堆红色报错，就可以继续往下走。

### 4. 复制一份本地配置

项目里有一个 `.env.example`，它是配置模板。真正跑的时候要复制成你自己的 `.env`：

```bash
cp .env.example .env
```

可以用这个命令确认一下：

```bash
ls -a
```

看到 `.env` 就行。

一开始你可以先不填 API Key，这个项目会先用本地规则跑起来。等你要接入 LLM、Fish Audio、网易云这些能力的时候，再打开 `.env` 改配置。

注意一下：`.env` 里面以后可能会放 API Key、Cookie 这些敏感信息，不要提交到 GitLab，也不要发给别人。这个项目已经在 `.gitignore` 里忽略了 `.env`，正常不会误传。

### 5. 启动网页播放器

直接跑：

```bash
npm run dev
```

如果没报错，打开浏览器访问：

```txt
http://127.0.0.1:8080
```

看到播放器页面，就说明已经跑起来了。

如果你想用手机打开，也可以。手机和电脑连同一个 Wi-Fi，然后看终端里打印出来的局域网地址，一般像这样：

```txt
http://192.168.1.14:8080
```

用手机浏览器打开这个地址就行。

### 6. 放一点自己的音乐进去

把音乐文件放到这个目录：

```txt
music-agent/library
```

支持这些格式：

```txt
mp3, m4a, wav, flac, aac, ogg
```

放完以后，重启一下服务，或者直接让它重新扫一遍：

```bash
curl -s -X POST http://127.0.0.1:8080/api/library/scan
```

然后刷新网页。能看到或播放本地音乐，就说明音乐库已经读到了。就算你暂时没放音乐，页面也会用预览音先跑起来。

### 7. 如果你要用网易云相关功能

普通体验可以先跳过这一步。

如果你要用网易云搜索、歌单导入这些能力，可以直接跑：

```bash
npm run dev:all
```

也可以分两个终端跑：

```bash
npm run netease
```

另一个终端跑：

```bash
npm run dev
```

然后按需改 `.env`：

```txt
NETEASE_API_BASE=http://127.0.0.1:3000
NETEASE_USER_ID=你的网易云用户ID
NETEASE_COOKIE=你的网易云Cookie
```

这里要注意，`NETEASE_COOKIE` 是账号相关的敏感信息，不要提交，不要外传。Cookie 也可能过期，过期了就重新配一次。

### 8. 如果你想跑桌面小窗

这个项目也有一个桌面菜单栏版本。想试的话跑：

```bash
npm run desktop:dev
```

正常的话，电脑菜单栏会出现一个迷你播放器。如果后端服务还没启动，它会尝试自己把服务拉起来。

### 9. 想确认项目有没有问题

可以跑测试：

```bash
npm test
```

也可以跑基础检查：

```bash
npm run check
```

命令跑完没有失败提示，就说明基本没问题。

### 遇到问题先看这里

#### Node 版本太低

先看版本：

```bash
node -v
```

如果低于 22，升级 Node.js，然后重新来一遍：

```bash
npm install
npm run dev
```

#### 8080 端口被占用

一般是之前已经启动过一次，或者别的软件占了 `8080`。把占用 `8080` 的程序关掉，再重新跑：

```bash
npm run dev
```

#### 页面打开了，但没有音乐

先确认音乐文件确实放进了 `library`，然后重新扫一下：

```bash
curl -s -X POST http://127.0.0.1:8080/api/library/scan
```

再刷新浏览器。

#### LLM、TTS、网易云功能不能用

这不一定是坏了。很多能力需要你在 `.env` 里填 API Key、Cookie 或本地服务地址。没配置的时候，项目还是可以先用本地规则跑基础功能。

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
