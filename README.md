# dominator

A simple, local media downloader. Paste a link, click download.

Supports YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachments. Public links only, no login required.

## Run

Install Node.js 22+, pnpm, yt-dlp, and ffmpeg, then:

```sh
pnpm install
pnpm start
```

Open http://127.0.0.1:3000. On Windows with WSL, use `pnpm start:wsl` instead.

Or, with Docker:

```sh
docker compose up -d --build
```

## Use

- Paste links and press Enter to queue them. Click download to start.
- Use clip to select part of a video.
- SoundCloud playlists save as individual tracks in their original audio format.
- For Discord, paste the attachment link, not the message link. Audio saves as MP3. Copy a fresh link if it expires.

Keep yt-dlp updated if downloads fail. Run locally; do not expose port 3000 publicly.

Clips download only the selected section when ffmpeg can open network URLs. Fully static ffmpeg builds (such as the johnvansickle.com ones) crash on that, so the app falls back to downloading the whole video and trimming it, and logs a warning at startup. Your distro's ffmpeg package avoids this.

A single download is stopped after 2 hours. Set `DOMINATOR_JOB_TIMEOUT_MS` to change that limit.

## Tailscale

With the app running and Tailscale connected:

```sh
tailscale serve --https=3000 --bg http://127.0.0.1:3000
```

Open the HTTPS address it prints from a device on your tailnet.

## Develop

```sh
pnpm dev
pnpm test
pnpm typecheck
```
