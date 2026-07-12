<img width="1144" height="282" alt="dom" src="https://github.com/user-attachments/assets/dc6de67c-4faa-4895-8dd8-22cb39b09f39" />

Personal, local-only downloader for public videos from YouTube, Twitter/X,
Instagram, TikTok, and Reddit. There is no login or cookie support, so gated
content may fail with the extractor's error message.

## Requirements

- Node >= 20 and pnpm
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

## Run

```bash
pnpm install
pnpm start
```

Open http://127.0.0.1:3000 in your browser. Run the commands from the repo
root because the static page is served from `./public`. The server binds to
127.0.0.1 only.

On macOS and Linux, there is also an optional helper script:

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
pnpm start
```

Open http://127.0.0.1:3000 in your browser.

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
