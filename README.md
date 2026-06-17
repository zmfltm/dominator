# dominator

## Prerequisites

- Node >= 20 and pnpm
- `yt-dlp` and `ffmpeg` on PATH

```bash
# macOS
brew install yt-dlp ffmpeg
# Debian/Ubuntu
sudo apt install yt-dlp ffmpeg
```

If downloads start failing with extraction errors, update yt-dlp first
(`yt-dlp -U` or your package manager)

## Run

```bash
pnpm install
pnpm start
```

Open http://127.0.0.1:3000. Run from the repo root (the static page is
served from `./public`). The server binds to 127.0.0.1 only.

On macOS/Linux, there is also an optional helper script:

```bash
./scripts/start-local.sh
```

The helper checks for required commands, installs Node dependencies if
`node_modules` is missing, starts the app in the background, and writes local
logs/pids to ignored files

## Windows

WSL is the recommended setup

```powershell
wsl --install -d Ubuntu
```

Restart if Windows asks you to open Ubuntu then run

```bash
sudo apt update
sudo apt install -y git curl ffmpeg yt-dlp

# Install Node. Node 22 LTS is fine
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
corepack enable

git clone https://github.com/zmfltm/dominator.git
cd dominator
pnpm install
pnpm start
```

Open http://127.0.0.1:3000 in your browser

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

If PowerShell cannot find `yt-dlp` or `ffmpeg` after installing them close try again
