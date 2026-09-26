# dominator design

A personal, local-only downloader for YouTube, Twitter/X, Instagram, TikTok,
Reddit, and SoundCloud with a minimal black UI. Paste one or more URLs, queue
MP4 downloads, optionally clip queued videos by start/end time, or expand a
SoundCloud playlist into best-quality audio tracks.

> Amended 2026-06-13: extended from YouTube-only to four sites (YouTube,
> Twitter/X, Instagram, TikTok), public posts only.
>
> Amended 2026-07-13: added Reddit, including Reddit post, short-link, and
> hosted-video URLs.
>
> Amended 2026-07-28: added an explicit WSL launch mode that binds to
> `0.0.0.0` so a Windows-hosted browser can use WSL localhost forwarding. The
> default launch remains bound to `127.0.0.1`.
>
> Amended 2026-08-01: added SoundCloud track and playlist expansion with
> source-format best audio downloads.

> Amended 2026-09-25: Discord audio attachment links from `cdn.discordapp.com`
> and `media.discordapp.net` queue as MP3. Only HTTPS attachment paths with
> numeric channel/attachment IDs and supported audio/media extensions are
> accepted. Signed query parameters are preserved. Discord message links return
> instructions to copy the attachment link. Discord rows hide video clip controls.

## Goals

- Paste video URLs from supported sites and queue MP4 downloads.
- Paste a SoundCloud track or playlist and queue every track as best audio.
- Set optional start/end times per video row to download only a clip.
- Super minimal black single page with one input, queue rows, progress bars,
  and plain status copy.
- Runs locally with `pnpm start` on `http://localhost:3000`. WSL users can use
  `pnpm start:wsl` when the browser runs on Windows. No hosting, no accounts,
  no database.

## Non-goals

- No public deployment. The server binds to `127.0.0.1` by default. The
  explicit WSL launch mode binds to `0.0.0.0` only for Windows localhost
  forwarding and must not be treated as a public hosting mode.
- No quality picker table or persistent history.
- No login or cookie support: public posts and tracks only. Login-gated content
  and account-only SoundCloud quality fail or remain unavailable.
- No support for sites beyond the listed services; the host allowlist stays
  closed.

## Prerequisites

- Node >= 22 and pnpm. The app passes its Node executable to yt-dlp as the
  JavaScript runtime for YouTube extraction.
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
├── src/previews.ts        # filmstrip preview jobs
├── src/soundcloud.ts      # SoundCloud track and playlist expansion
├── package.json
└── README.md
```

One Hono server in TypeScript. It serves the static page and spawns the
yt-dlp binary as a subprocess. No frontend framework, no build step for the
UI: vanilla HTML/CSS/JS in a single file.

## Endpoints

- `POST /api/metadata`, body `{ url }`. Validates the host allowlist, then
  runs yt-dlp with `--skip-download --print title --print duration --print
  section_start --print section_end --print thumbnail -- <url>` and returns
  `{ title, duration?, thumbnail?, clip? }` so queued rows can show video names
  before download starts and clip controls can size their timeline and show a
  thumbnail-backed track when metadata is known.
- `POST /api/soundcloud`, body `{ url }`. Accepts only allowlisted SoundCloud
  URLs and runs a bounded yt-dlp flat-playlist lookup. Returns `{ title?,
  tracks: [{ url, title? }] }`. Direct track URLs return one track. Playlists
  preserve source order and are capped at 500 tracks.
- `POST /api/previews`, body `{ url }`. Validates the host allowlist, starts a
  capped background preview job, and returns `{ previewId, status,
  spriteUrl?, sourceUrl? }`. Preview jobs download a low-resolution video with
  yt-dlp, then use ffmpeg to build a small horizontal filmstrip sprite. `GET
  /api/previews/:id` polls status, `GET /api/previews/:id/sprite` serves the
  finished JPEG sprite, and `GET /api/previews/:id/source` serves the preview
  video with byte-range support so the browser can play the selected clip range.
- `POST /api/jobs`, body `{ url, format: 'mp4' | 'mp3' | 'audio', clip?: {
  start, end }, playlist?: { index, count } }`. `audio` is limited to
  SoundCloud and cannot be clipped. `playlist` is limited to SoundCloud audio,
  validates positions up to 500, and prefixes filenames so saved tracks sort in
  playlist order. `clip.start` and `clip.end` are seconds, must be finite numbers between 0
  and 24 hours, and `end` must be after `start`.
  Validates that the URL parses and its host is on the allowlist:
  - YouTube: `youtube.com`, `www.youtube.com`, `m.youtube.com`,
    `music.youtube.com`, `youtu.be`
  - Twitter/X: `twitter.com`, `www.twitter.com`, `mobile.twitter.com`,
    `x.com`, `www.x.com`
  - Instagram: `instagram.com`, `www.instagram.com`, `m.instagram.com`
  - TikTok: `tiktok.com`, `www.tiktok.com`, `m.tiktok.com`,
    `vm.tiktok.com`, `vt.tiktok.com`
  - Reddit: `reddit.com`, `www.reddit.com`, `old.reddit.com`,
    `new.reddit.com`, `m.reddit.com`, `redd.it`, `v.redd.it`
  - SoundCloud: `soundcloud.com`, `www.soundcloud.com`, `m.soundcloud.com`,
    `on.soundcloud.com`, `api.soundcloud.com`, `api-v2.soundcloud.com`
  Spawns yt-dlp writing into a per-job temp dir. Returns `{ jobId }`.
  Rejects with 429 once 7 jobs are already running or starting. Rejects
  with 400 and the message
  `only YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachment URLs are supported`
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
  typical for Twitter/Instagram/TikTok/Reddit. Worst case the file is a non-mp4
  container, named honestly by its real extension).
- MP3: `-x --audio-format mp3 --audio-quality 0`.
- SoundCloud audio: `-f "bestaudio/best"`. The selected source container is
  preserved without lossy conversion. Playlist jobs remain one track per job
  and still pass `--no-playlist`; the UI expands the playlist first.
- Optional clipping: yt-dlp downloads the selected media normally, then the
  server trims the local output with ffmpeg into `<title>.clip.<format>`. The
  first trim attempt stream-copies for speed, then falls back to re-encoding if
  the container or codecs cannot be copied into the requested format. This
  avoids yt-dlp's fragile remote section downloader path.
- Common yt-dlp flags: `--no-playlist`, `--progress`, `--newline`,
  `-o <tempdir>/%(title)s.%(ext)s`. YouTube calls also pass `--js-runtimes`
  with the current Node executable so yt-dlp can solve player challenges.
- Preview generation uses a low-resolution yt-dlp format capped by
  `--max-filesize 80M`, then ffmpeg samples 5 frames into one JPEG sprite for
  the timeline background. At most 2 preview jobs run at once.

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
  button has a fixed width so its active color does not resize it. `add`,
  `clip`, and an outside-left borderless text clear icon appear only while the
  URL input has text. The input-level clip button opens start/end fields and
  applies those times to URLs queued from the current input. Holding Backspace
  or double-tapping Backspace clears all input
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
- SoundCloud URLs are resolved before queueing. A direct track creates one
  best-audio row. A playlist creates one row per track in source order, then
  group downloading uses the existing seven-job cap. SoundCloud rows do not
  show video clip controls.
- Compact queue rows with a tiny monochrome source icon matched to YouTube,
  X, TikTok, Instagram, Reddit, or SoundCloud, and the fetched title when available. Each
  queued, canceled, or invalid row has a clip button that reveals start/end
  inputs plus a draggable timeline track; inputs accept seconds, `m:ss`, or
  `h:mm:ss`, and leaving both blank downloads the full video. Opening clip
  controls starts a sampled filmstrip preview job; metadata thumbnails are used
  as a fallback while the filmstrip is unavailable. A `preview` button shows a
  browser video player for the selected start/end range using the same
  low-resolution preview source. Adjusting start/end while the preview is open
  reloads and plays the selected range. The timeline grays out unselected
  regions, is taller for easier targeting, and has `+`, `-`, and `1x` zoom
  controls. Clip panels use `reset` to clear times and include a local `clip`
  button to start that clipped download. URLs with `t`, `start`, `end`, or
  media fragment times prefill the clip fields when possible, and metadata can
  prefill section start/end for clip URLs when yt-dlp reports them. Long
  titles wrap and use the full row width instead of truncating. The UI does not
  show a global queued-count status; the rows themselves are the queue.
  Progress and status text appear once a row starts running, including percent
  plus downloaded and total size when yt-dlp reports a total. Completed rows
  stay short, fade and italicize the title, hide progress/status, and remove
  the borders from their row-control buttons.
- Errors render in red.

## Error handling

- yt-dlp stderr is captured per job; failures emit a human-readable SSE
  `failed` event (bad URL, private or age-gated video, network failure).
- Temp dirs are deleted after file delivery, on job or preview error, by
  periodic stale reapers for abandoned finished jobs and previews, and swept on
  server startup for leftovers from crashed runs.
- Startup validates yt-dlp and ffmpeg exist before listening.
- At most 7 jobs can run concurrently.

## Security

- Listens on `127.0.0.1` by default. WSL mode explicitly listens on
  `0.0.0.0`; its reachability depends on WSL networking and Windows Firewall,
  so use it only on a trusted local machine.
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
