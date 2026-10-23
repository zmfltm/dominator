# UI and performance review

Ship. Code checks passed; physical-device behavior and a real X upload still need a manual check.

## A. Accessibility

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Should fix | Icon-only zoom controls relied on titles | Explicit accessible labels at `public/index.html:928` | Names remain available to assistive technology | Fixed |
| Should fix | Clip disclosure state was implicit | `aria-expanded` and panel associations at `public/index.html:419` | Screen readers can identify the open panel | Fixed |
| Should fix | Queue updates replaced focused fields | Stable rows and focus restoration at `public/index.html:1479` | Editing continues during progress and metadata updates | Fixed |

## B. Performance

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Blocker | Every progress event rebuilt every queue row | One render per frame, cached rows, text/transform updates at `public/index.html:1474` | Removes DOM churn during downloads | Fixed |
| Should fix | Input timeline rebuilt whenever controls updated | Reuses the track until its source changes at `public/index.html:1192` | Keeps drag and keyboard interaction stable | Fixed |
| Should fix | Offscreen playlist rows fully rendered | Native content visibility with remembered height at `public/index.html:143` | Skips offscreen layout and paint without losing keyboard access | Fixed |
| Should fix | Reopening clip controls repeated completed metadata extraction | Five-minute cache capped at 256 entries at `src/metadata.ts:93` | Avoids repeated yt-dlp calls; failures remain retryable | Fixed |
| Should fix | Preview generation extracted media information twice | Duration printed after the download at `src/previews.ts:84` | Removes one extractor process per preview | Fixed |
| Should fix | Font discovered through CSS | WOFF2 preload at `public/index.html:12` | Starts the font request earlier | Fixed |
| Polish | A discarded preview could keep playing | Explicit media release at `public/index.html:1091` | Stops detached video playback and resource use | Fixed |

Desktop Chromium check with 500 staged SoundCloud rows: initial DOM construction 38 ms; 20 progress renders updating seven active rows averaged 1.35 ms. This measures JavaScript and DOM updates on this machine, not mobile frame rate or network download speed.

## C. Mobile

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Blocker | Fixed clip panels could extend below the viewport | Page flow on small or short screens at `public/index.html:222` | Clip fields, preview, and queue remain reachable by scrolling | Fixed |
| Should fix | Desktop autofocus also ran on phones | Focus gated by hover and fine pointer capability | Avoids opening the software keyboard on load | Fixed |
| Should fix | Several hover rules applied to touch | All hover feedback behind a capability query at `public/index.html:207` | Avoids persistent hover states after taps | Fixed |
| Should fix | Clip actions wrapped unevenly | Two labeled fields, then three equal action cells at `public/index.html:235` | Keeps the controls aligned at narrow widths | Fixed |

Browser viewports checked at 320, 390, and 1280 pixels wide. No horizontal overflow in the exercised states. Touch targets use the coarse-pointer rule; the preview's device presets change viewport dimensions without emulating a touch device.

## D. Forms

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Should fix | Reset stayed disabled after entering the first clip time | Reset enablement follows field edits at `public/index.html:1256` | A new selection can be cleared immediately | Fixed |
| Should fix | Enter handler could run during composition | Composition guard in URL key handler | Preserves IME text entry | Fixed |
| Polish | URL input used generic keyboard defaults | URL input mode, no capitalization/autocomplete, Enter hint at `public/index.html:250` | Makes pasted links easier to enter on phones | Fixed |

## E. Stability and states

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Blocker | An old POST response or event could overwrite a retried download | Per-attempt identity and stale-event guards at `public/index.html:1996` | Cancellation and retry keep the correct server job | Fixed |
| Blocker | Clear waited for cancellation, then erased rows added in the meantime | Immediate clear at `public/index.html:2199` | Newly added rows survive a delayed server response | Fixed |
| Should fix | Failed rows could only be removed | Single and group retry include failed rows | Users can recover from extraction/network failures | Fixed |
| Should fix | SoundCloud expansion could resume after cancellation | Resolution identity checked before continuing | Canceled work does not repopulate the queue | Fixed |
| Blocker | An MP4 extension could contain AV1, HEVC, VP9, or unsupported audio | Local inspection and conditional H.264/yuv420p plus AAC-LC conversion at `src/jobs.ts:387` | Addresses the reported incompatible-codec upload error | Fixed |

Compatible streams avoid re-encoding. Conversions preserve the title and end in `.mp4`. ffprobe is checked at startup and documented as part of the FFmpeg installation. File size, duration, dimensions, and account upload limits are not enforced by this change. The original rejected video was not attached, so its exact codec has not been identified.

## F. Motion

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Should fix | Progress animated width for 300 ms | A 120 ms transform transition at `public/index.html:201` | Avoids layout animation and responds sooner | Fixed |
| Should fix | Reduced motion disabled every transition | Only progress movement is removed at `public/index.html:239` | Color feedback remains available | Fixed |

## G. Theming

| Severity | Before | After | Why | Status |
| --- | --- | --- | --- | --- |
| Should fix | Dark UI did not declare its color scheme | Dark scheme and matching browser theme color in the head | Native controls and browser chrome follow the page | Fixed |
| Polish | Amber text, accents, and border tint | Grayscale tokens, halftone mark and dot field at `public/index.html:20` | Matches the supplied black-and-white references | Fixed |

Canvas-measured WCAG contrast on the row surface: foreground 17.36:1; secondary text 7.52:1. Errors retain explicit text and a leading `!` rather than depending on hue.

Palette declarations in `public/index.html`:

| Declaration | Before | After | Reason |
| --- | --- | --- | --- |
| `--fg` | `oklch(0.88 0.035 75)` | `oklch(0.95 0 0)` | Removes the warm tint and increases contrast |
| `--dim` | `oklch(0.65 0.025 75)` | `oklch(0.7 0 0)` | Neutral secondary text |
| `--line` | `oklch(0.29 0.018 75)` | `oklch(0.3 0 0)` | Neutral borders |
| `--surface` | `#0c0c0c` | `oklch(0.13 0 0)` | Near-black surfaces |
| `--muted-surface` | `#151515` | `oklch(0.22 0 0)` | Neutral press feedback |
| `--accent` | `oklch(0.8 0.15 75)` | `oklch(0.95 0 0)` | White primary action |
| `--error` | `#ff8585` | `oklch(0.95 0 0)` | Monochrome error treatment with explicit text |
| `--disabled` | Shared `--dim` | `oklch(0.44 0 0)` | Distinguishes disabled controls from secondary actions |

The dot field adds `oklch(0.42 0 0)`. Existing black overlays use equivalent neutral OKLCH alpha values. Shadows, corner ornaments, and amber focus mixes were removed; controls use the shared neutral tokens. The black page background stays unchanged.

## H. Content and leftovers

Removed duplicate CSS overrides while retaining the single-file frontend, blank URL field, minimal idle state, square corners, vendored font/license, source icons, and existing logo. No framework or build pipeline added. No AGENTS.md or CLAUDE.md files changed.

## I. Marketing and SEO

Skipped. This is a local product interface with no marketing routes.

## Needs a device or a human

- On an iPhone or Android phone, enter a URL and clip times. Check keyboard visibility, lack of input zoom, scrolling to the last control, and absence of sticky hover.
- On a phone with a display cutout, check the clear-text control and bottom queue actions in landscape.
- Re-download the rejected clip and try attaching the new MP4 to X. No X account or upload was accessed in this work.

No further design decisions are required for this change.

## Verification

`pnpm test` reached the shared validation queue's ten-minute timeout before running tests. The installed Node binary then ran the same Vitest suite serially:

```text
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
Test Files  11 passed (11)
     Tests  130 passed (130)
```

`pnpm typecheck` and the final direct `tsc --noEmit` exited 0. `git diff --check` exited 0. There is no build step.

Full local job-pipeline smoke tests generated incompatible video/audio, passed it through download preparation, and inspected output with ffprobe:

```text
Full file: done, Smoke clip.mp4, h264 / yuv420p / High, aac / LC / stereo, 0.400 s
Clip: done, Smoke clip.clip.mp4, h264 / yuv420p / High, aac / LC / mono, 0.200 s
```

Browser checks covered queueing with Enter, metadata titles, linked clip times, clip fields and zoom, stable focus during unrelated progress, 500 rows, and mobile overflow. A real YouTube thumbnail and filmstrip preview loaded successfully.

Documentation lookup used official sources after Context7 reported its monthly quota exhausted. References: [yt-dlp options](https://github.com/yt-dlp/yt-dlp), [FFmpeg codecs](https://ffmpeg.org/ffmpeg-codecs.html), [ffprobe](https://ffmpeg.org/ffprobe.html), [CSS content visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/content-visibility). X documents H.264 and AAC-LC in its [Media Studio guidance](https://help.x.com/en/using-x/media-studio-faqs); its [web upload help](https://help.x.com/en/using-x/x-videos) describes account-dependent upload limits. Media Studio's size and resolution limits were not applied to desktop uploads here.
