<img width="1144" height="282" alt="dom" src="https://github.com/user-attachments/assets/dc6de67c-4faa-4895-8dd8-22cb39b09f39" />

Personal, local-only downloader for public videos from YouTube, Twitter/X,
Instagram, TikTok, and Reddit, plus tracks and playlists from SoundCloud. There
is no login or cookie support, so gated content may fail with the extractor's
error message.

## Requirements

- Node >= 22 and pnpm
- `yt-dlp` and `ffmpeg` on PATH

```bash
# macOS
brew install yt-dlp ffmpeg

# Debian/Ubuntu
sudo apt install yt-dlp ffmpeg
```

If downloads start failing with extraction errors, update yt-dlp first
(`yt-dlp -U` or your package manager). Supported sites change their media
delivery regularly, so keeping yt-dlp current is the first troubleshooting
step.

YouTube extraction also needs a JavaScript runtime. The app passes its current
Node executable to yt-dlp, so use Node 22 or newer. If YouTube returns HTTP 403,
check both versions before retrying:

```bash
node --version
yt-dlp --version
```

## SoundCloud playlists

Paste a SoundCloud track or playlist URL and use `add` or `download`. Playlist
links expand into one queue row per track. `download` runs up to seven tracks at
a time and saves each track separately with its playlist position in the
filename.

SoundCloud tracks use yt-dlp's `bestaudio/best` selection and keep the selected
source container instead of converting it to MP3. The resulting extension may
be MP3, M4A, Opus, or another format exposed by SoundCloud. Original artist
downloads are selected when SoundCloud makes them available. Account-only
quality is unavailable because the app does not load browser cookies.

Browsers may ask for permission before allowing several automatic downloads
from `127.0.0.1`. Allow multiple downloads for the site if only the first track
is saved. Playlist expansion is capped at 500 tracks.

## Run

```bash
pnpm install
pnpm start
```

Open http://127.0.0.1:3000 in your browser. Run the commands from the repo
root because the static page is served from `./public`. The server binds to
127.0.0.1 only by default.

When Pi runs inside WSL and the browser runs on Windows, use:

```bash
pnpm start:wsl
```

This listens on the WSL network interfaces so Windows localhost forwarding can
reach the app. Do not use this mode on a host that exposes WSL ports to an
untrusted network.

On macOS and Linux, there is also an optional helper script. It selects the WSL
mode automatically when needed and opens the app in your browser:

```bash
./scripts/start-local.sh
```

## Windows

WSL is the recommended setup.

In PowerShell:

```powershell
wsl --install -d Ubuntu
```

Restart if Windows asks you to, open Ubuntu, then run:

```bash
sudo apt update
sudo apt install -y git curl ffmpeg yt-dlp

# Install Node. Node 22 LTS is fine.
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable

git clone https://github.com/zmfltm/dominator.git
cd dominator
pnpm install
pnpm start:wsl
```

Open http://127.0.0.1:3000 in your Windows browser.

Native Windows can also work if `node`, `pnpm`, `yt-dlp`, and `ffmpeg` are all
on PATH. One PowerShell setup path is:

```powershell
winget install -e --id OpenJS.NodeJS.LTS
winget install -e --id yt-dlp.yt-dlp
winget install -e --id Gyan.FFmpeg
corepack enable

git clone https://github.com/zmfltm/dominator.git
cd dominator
pnpm install
pnpm start
```

If PowerShell cannot find `yt-dlp` or `ffmpeg` after installing them, close and
reopen PowerShell before trying again.
