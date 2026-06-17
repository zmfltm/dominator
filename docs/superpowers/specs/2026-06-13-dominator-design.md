# dominator design

A personal, local-only video downloader for YouTube, Twitter/X, Instagram, and
TikTok with a minimal black UI. Paste one or more URLs, queue MP4 downloads,
and save the finished files from the browser.

> Amended 2026-06-13: extended from YouTube-only to four sites (YouTube,
> Twitter/X, Instagram, TikTok), public posts only.

## Goals

- Paste video URLs from supported sites and queue MP4 downloads.
- Super minimal black single page with one input, queue rows, progress bars,
  and plain status copy.
- Runs locally with `pnpm start` on `http://localhost:3000`. No hosting, no
  accounts, no database.

## Non-goals

- No public deployment. Server binds to `127.0.0.1` only.
- No quality picker table, no thumbnails, and no persistent history.
- No login or cookie support: public posts only. Login-gated content (common
  on Instagram, some tweets) fails with yt-dlp's error shown in the UI.
- No support for sites beyond the four; the host allowlist stays closed.

## Prerequisites

- Node >= 20 and pnpm.
- `yt-dlp` and `ffmpeg` on PATH (one brew/apt install each). The server checks
  for both at startup and exits with a clear message if missing.

## Architecture

```
dominator/
├── public/index.html      # the whole UI: black page, queue, progress
├── public/logo.png        # tiny centered logo
├── public/fonts/          # vendored Ioskeley Mono web font
├── src/server.ts          # Hono server entry
├── src/app.ts             # routes
├── src/jobs.ts            # yt-dlp jobs
├── package.json
└── README.md
```

One Hono server in TypeScript. It serves the static page and spawns the
yt-dlp binary as a subprocess. No frontend framework, no build step for the
UI: vanilla HTML/CSS/JS in a single file.

## Endpoints

- `POST /api/metadata`, body `{ url }`. Validates the host allowlist, then
  runs yt-dlp with `--skip-download --print title -- <url>` and returns
  `{ title }` so queued rows can show video names before download starts.
- `POST /api/jobs`, body `{ url, format: 'mp4' | 'mp3' }`.
  Validates that the URL parses and its host is on the allowlist:
  - YouTube: `youtube.com`, `www.youtube.com`, `m.youtube.com`,
    `music.youtube.com`, `youtu.be`
  - Twitter/X: `twitter.com`, `www.twitter.com`, `mobile.twitter.com`,
    `x.com`, `www.x.com`
  - Instagram: `instagram.com`, `www.instagram.com`, `m.instagram.com`
  - TikTok: `tiktok.com`, `www.tiktok.com`, `m.tiktok.com`,
    `vm.tiktok.com`, `vt.tiktok.com`
  Spawns yt-dlp writing into a per-job temp dir. Returns `{ jobId }`.
  Rejects with 429 once 7 jobs are already running or starting. Rejects
  with 400 and the message
  `only YouTube, Twitter/X, Instagram, and TikTok URLs are supported`
  for unknown hosts.
- `GET /api/jobs/:id/events`. SSE stream of progress events
  `{ percent, stage, downloadedBytes?, totalBytes? }` parsed from yt-dlp
  `--progress` output, terminated by
  a `done`, `failed`, or `canceled` event. (`failed`, not `error`:
  EventSource reserves `error` for connection drops, and an unhandled `error`
  on a Node EventEmitter throws.)
- `DELETE /api/jobs/:id`. Cancels a running job, asks yt-dlp to terminate,
  and deletes the job temp dir.
- `GET /api/jobs/:id/file`. Streams the finished file with
  `Content-Disposition: attachment` so the browser saves it under the video's
  real title, then deletes the job's temp dir.

Jobs live in an in-memory map. No persistence.

## yt-dlp invocation

Always `spawn` with an args array, never a shell string, so the URL can never
be interpreted by a shell.

- MP4: `-f "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b"` (best video plus audio,
  merged by ffmpeg; the final `/b` matches sites that serve one combined file,
  typical for Twitter/Instagram/TikTok. Worst case the file is a non-mp4
  container, named honestly by its real extension).
- MP3: `-x --audio-format mp3 --audio-quality 0`.
- Common flags: `--no-playlist`, `--progress`, `--newline`,
  `-o <tempdir>/%(title)s.%(ext)s`.

## UI

Pure black page, centered column:

- Tiny centered logo.
- Ioskeley Mono web font vendored under `public/fonts/` with its OFL license.
- Blank URL input that accepts one or more whitespace-separated URLs.
- Slightly larger global font, compact buttons, a thinner input bar, and the
  user-provided logo slightly larger and higher above the input.
- The input area stays centered and fixed in place, so adding queue rows below
  it does not move the search box.
- `download` is visible by default and enabled when the input has a URL or
  queued rows exist. It queues any current input and starts the queue. The
  button has a fixed width so its active color does not resize it. `add` and
  an outside-left borderless text clear icon appear only while the URL input
  has text. Holding Backspace or double-tapping Backspace clears all input
  text. Add uses a neutral color distinct from download and queues without
  starting. Pressing Enter queues without starting. Each row has compact boxed
  controls: an x button to remove that single row before it starts and a
  down-arrow button to start just that row. Active rows reuse the x button to
  cancel only that row without canceling other active downloads. Row download
  arrows are disabled during group downloads or when max active jobs are
  already running, but multiple single-row downloads can run in parallel up to
  the max. Single-row downloads do not auto-start the rest of the queue when
  they finish. A cancel button appears below the list while downloads are active
  and cancels active plus queued downloads. A clear button appears below the
  list once rows exist; clearing also cancels active jobs.
- Compact queue rows with a tiny monochrome source icon matched to YouTube,
  X, TikTok, or Instagram, and the fetched video title when available. Long
  titles wrap and use the full row width instead of truncating. The UI does not
  show a global queued-count status; the rows themselves are the queue.
  Progress and status text appear once a row starts running, including percent
  plus downloaded and total size when yt-dlp reports a total. Completed rows
  stay short, fade and italicize the title, and hide progress/status.
- Errors render in red.

## Error handling

- yt-dlp stderr is captured per job; failures emit a human-readable SSE
  `failed` event (bad URL, private or age-gated video, network failure).
- Temp dirs are deleted after file delivery, on job error, by a periodic
  stale-job reaper for abandoned finished jobs, and swept on server startup
  for leftovers from crashed runs.
- Startup validates yt-dlp and ffmpeg exist before listening.
- At most 7 jobs can run concurrently.

## Security

- Listens on `127.0.0.1` only; unreachable from the network.
- URL host allowlist on input; subprocess spawn with args array.
- Job IDs are random (crypto UUID); the file endpoint serves only files from
  that job's own temp dir.

## Testing

Vitest unit tests for the pure parts:

- URL validation (accepts at least one URL per supported site, rejects
  garbage, unknown hosts, and lookalike hosts).
- Progress-line parser for yt-dlp output.
- Job endpoint rejects invalid bodies with 400.

The happy path (a real download) is a manual smoke test; mocking YouTube end
to end is not worth the weight for a personal tool.
