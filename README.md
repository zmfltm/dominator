# dominator

A simple, local media downloader. Paste a link, click download.

Supports YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachments. Public links only, no login required.

## Run

Install Node.js 22+, pnpm, yt-dlp, and ffmpeg (with ffprobe), then:

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
- Click compress to pick local video or audio files. They upload, shrink with ffmpeg (video to MP4, audio to MP3), and download back. Needs ffprobe, which ships with ffmpeg.
- SoundCloud playlists save as individual tracks in their original audio format.
- For Discord, paste the attachment link, not the message link. Audio saves as MP3. Copy a fresh link if it expires.

Keep yt-dlp updated if downloads fail. Run locally; do not expose port 3000 publicly.

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
