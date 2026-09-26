# AGENTS.md

Project guidance for coding agents working on `dominator`.

## Source of truth

Read these first when changing behavior:

1. `README.md` for user-facing setup and hosting notes.
2. `docs/superpowers/specs/2026-06-13-dominator-design.md` for product and endpoint behavior.
3. `docs/superpowers/plans/2026-06-13-dominator.md` for historical decisions and accepted review follow-ups.

## Commands

```bash
pnpm test
pnpm typecheck
pnpm start
```

Manual UI smoke test: open `http://127.0.0.1:3000` after `pnpm start`.

## Project shape

- `public/index.html`: entire frontend. No build step, no frontend framework.
- `public/logo.png`: original logo and favicon, cropped from the user-provided screenshot.
- `public/logo-hd.png`: cleaned high-resolution logo used in the page header.
- `public/fonts/`: vendored Ioskeley Mono web font and license.
- `src/validate.ts`: request and supported-host validation, including Reddit.
- `src/progress.ts`: yt-dlp progress parser.
- `src/metadata.ts`: title, duration, clip, and thumbnail lookup via yt-dlp `--skip-download --print ...`.
- `src/previews.ts`: low-resolution preview download and ffmpeg filmstrip sprite generation, max 2 active previews.
- `src/soundcloud.ts`: bounded SoundCloud track and playlist expansion via yt-dlp, max 500 tracks.
- `src/jobs.ts`: in-memory job map, yt-dlp subprocess lifecycle, local ffmpeg clipping, cancellation, stale reaping, max 7 active jobs.
- `src/app.ts`: Hono routes for creating jobs, SSE events, cancellation, and file delivery.
- `src/server.ts`: binary checks, temp sweep, stale reaper interval, local bind.

## Current UI behavior

- Initial queued video downloads are MP4. SoundCloud tracks use best audio in the source container without conversion.
- SoundCloud playlist links expand into one queue row per track and preserve playlist order in saved filenames.
- Keep the UI flat with square corners. The idle page has no visible copy, helper text, or footer. Actions use angular SVG icons with accessible labels, including download. Use a restrained amber-on-black terminal palette.
- The URL input is intentionally blank, with no placeholder text.
- The search/input area should stay centered in the page and fixed in place as queue rows are added; rows grow downward underneath it.
- Queued rows should be compact and show the fetched video title when available, falling back to the URL. Titles should wrap and use the full row width instead of truncating.
- Do not show a global queued-count status like `1 queued`; the rows themselves are the queue.
- Running rows should show percent plus downloaded and total size when yt-dlp reports a total.
- The download button is visible by default, turns active-colored when usable, and is enabled when the input has a URL or queued rows exist.
- Pressing Enter in the input queues URLs only; clicking download starts the queue.
- The add button, clip button, and an outside-left borderless text clear icon are visible only while the URL input has text. Add uses a neutral color so it is distinct from download. The input-level clip button opens start/end fields, a taller draggable zoomable timeline, preview/reset/clip buttons, and a preview player for URLs queued from the current input. Links with `t`, `start`, `end`, or media fragment times should prefill clip fields when possible. Timelines should build sampled filmstrip previews when available, use fetched thumbnails as the fallback background, and gray out unselected regions.
- Holding Backspace in the URL input or double-tapping Backspace clears all input text.
- Each row has a wide enough x button to remove that row before it starts. Started rows disable the x button and it must not turn red on hover.
- A cancel button appears below the list while downloads are active and cancels active plus queued downloads.
- After cancellation, the download button should reactivate and retry canceled rows when clicked.
- Each queued, canceled, or invalid row has compact boxed controls: a clip button to reveal optional start/end clip fields plus a taller draggable zoomable timeline, preview/reset/clip buttons, a down-arrow button to start just that row, and an x button to remove it. Timelines should build sampled filmstrip previews when available, use fetched thumbnails as the fallback background, and gray out unselected regions. The preview button plays the selected range from the low-resolution preview source, and adjusting times while preview is open reloads and plays the updated range. Active rows reuse the x button to cancel only that row without canceling other active downloads. Disable row download arrows during group downloads or when max active jobs are already running, but allow multiple single-row downloads up to the max.
- Starting one row must not auto-start the rest of the queue when that row finishes.
- A clear button appears below the list when rows exist. Clearing also cancels active jobs.
- The download button has a fixed width so it does not resize when it turns active-colored.
- Completed rows should stay short, fade and italicize the title, hide progress/status and row-control borders, and should not show `convert to mp3`.

## Conventions

- TypeScript uses single quotes, semicolons, 2-space indentation.
- Keep the app local/private first. It binds to `127.0.0.1` by default. The explicit `start:wsl` path may bind to `0.0.0.0` only for Windows localhost forwarding.
- Do not add a frontend framework or build pipeline unless explicitly asked.
- Avoid em dashes in code, comments, UI copy, and commits.
- Keep UI copy plain and non-cringey. No Psycho-Pass flavor text in statuses.
- Use `textContent` and DOM APIs for UI updates. Do not introduce `innerHTML` for user-controlled data.

## Security and hosting

- URLs are untrusted input. Keep host allowlisting in `src/validate.ts` closed.
- Keep subprocess execution as `spawn` with an args array and `--` before the URL, including metadata lookups.
- Do not expose port 3000 directly. The WSL bind exception is for Windows localhost forwarding and can widen network reachability depending on WSL and Windows Firewall settings. For remote personal use, recommend Cloudflare Tunnel plus Cloudflare Access.
- If increasing public exposure, add stronger app-level auth, rate limiting, and timeouts first.

## External tools

The app requires `yt-dlp` and `ffmpeg` on PATH. The server checks both at startup.

## Font attribution

Ioskeley Mono is vendored from `https://github.com/ahatem/IoskeleyMono`, licensed under SIL Open Font License 1.1. Keep `public/fonts/IoskeleyMono-LICENSE.txt` with the font file.
