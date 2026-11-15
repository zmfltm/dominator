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
- Look: a flat neutral near-black background (`#0B0B0C`) with at most one very soft radial highlight behind the input. No scanlines, glow, or HUD bracket corners. Colors live as custom properties on `:root`. The Sibyl blue is the only accent, used for the logo, the active Download button, focus rings, and progress fills. Everything else is neutral grey. Text contrast stays at or above 4.5:1, so meta text is at least about 60% white.
- Type: the system sans stack for UI and titles. The vendored Ioskeley Mono is only for timestamps, durations, percentages, and file sizes, with tabular numbers. No italics. Body text is 15-16px and meta text 13px.
- Layout: one centered column, max 640px wide, with the logo (`logo-hd.png`, a solid accent fill with no glow, shown at 48px) about 20vh from the top, then the input, then the list. Rows grow downward under the input. Phones get 16px side padding and no horizontal scroll.
- Corners are modestly rounded: 12px for the field, Download button, rows, and clip panel; 6-8px for thumbnails and small controls.
- The URL field is 56px tall with the placeholder "Paste a video link" and a visually hidden label. While it holds a URL, the detected site (inline SVG icon plus name, or the hostname for generic links) shows inside the field on the left. Never fetch external favicons.
- For a single link, a quiet preview line under the field shows a small 16:9 thumbnail and the fetched title. It reuses the input metadata loader, debounced about 300ms after typing.
- Do not show a global queued-count status like `1 queued`; the rows themselves are the queue.
- The Download button is on the right with visible text, fixed width so it does not resize, enabled when the input has a URL or queued or retryable rows exist, and accent-colored when usable. Below 400px it stacks full width under the field.
- Pressing Enter in the input queues URLs only; clicking Download starts the queue.
- The clear-text, add, and Clip controls are visible only while the URL input has text. Compress shows only while the input is empty. Clear-text, add, and compress are quiet ghost icon buttons with tooltips and accessible names. Clip is a small text toggle with `aria-expanded`.
- The input Clip toggle reveals the clip panel under the field with a short height ease: start/end fields, a taller draggable zoomable timeline, preview/reset/clip buttons, and a preview player for URLs queued from the current input. Links with `t`, `start`, `end`, or media fragment times prefill clip fields when possible (a start alone selects 30 seconds). Timelines build sampled filmstrip previews when available, use fetched thumbnails as the fallback background, and gray out unselected regions.
- Holding Backspace in the URL input or double-tapping Backspace clears all input text.
- When there are no rows, one quiet line under the input reads "Downloads show up here."
- Rows are about 64px tall: a 16:9 thumbnail (the source icon on a neutral box when there is none), a one-line title truncated with an ellipsis (full title in `title`), and a meta line such as `YouTube · Clip 26:03-26:33 · 0:30 · 12 MB` that shows only the known parts. Titles fall back to the URL.
- Running rows show a thin progress bar plus percent and downloaded/total size when yt-dlp reports a total. Speed is not shown.
- Done rows show a check and a "Save again" button that re-saves the finished file. They stay quiet but readable.
- Failed rows show the error in plain text and a "Retry" button. Canceled rows also get "Retry". Invalid clip rows show the error and keep the clip editor so the clip can be fixed.
- Row actions are real buttons with 44px hit targets, tooltips, and accessible names: a clip button for queued, canceled, or invalid rows that reveals the same clip editor as the input, a down-arrow to start just that row, and an x to remove it. On hover-capable pointers they appear on row hover or focus; on touch they are always visible. The preview button plays the selected range from the low-resolution preview source, and adjusting times while preview is open reloads and plays the updated range. Active rows reuse the x to cancel only that row. Started rows disable the x unless it cancels, and it never turns red on hover. Disable row arrows during group downloads or when max active jobs are already running, but allow multiple single-row downloads up to the max.
- Starting one row must not auto-start the rest of the queue when that row finishes.
- A list header above the rows holds small text buttons. "Cancel all" shows only while downloads are active and cancels active plus queued downloads. After cancellation, Download reactivates and retries canceled and failed rows.
- "Clear history" shows when rows exist and asks inline before clearing ("Clear N items?" with Confirm and Keep; it also says active downloads will be canceled). Clearing also cancels active jobs. Never use `window.confirm`.
- Motion: new rows fade in and slide up 4px with a 40ms stagger, only when first created, never on re-render or progress updates. Progress bars ease out. Under `prefers-reduced-motion: reduce`, rows only fade and transitions are off.

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
