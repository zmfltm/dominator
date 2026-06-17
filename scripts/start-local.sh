#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://127.0.0.1:${PORT}"
LOG_FILE="${APP_DIR}/.local-start.log"
PID_FILE="${APP_DIR}/.local-start.pid"

export PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:${PATH}"

cd "$APP_DIR"

if command -v curl >/dev/null 2>&1 && curl -fsS "$URL" >/dev/null 2>&1; then
  echo "Dominator is already running at ${URL}"
  exit 0
fi

for cmd in node pnpm yt-dlp ffmpeg; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" | tee -a "$LOG_FILE" >&2
    exit 1
  fi
done

if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  pnpm install --frozen-lockfile
fi

: > "$LOG_FILE"
setsid -f bash -c 'cd "$1" && echo $$ > "$3" && exec pnpm start >> "$2" 2>&1' _ "$APP_DIR" "$LOG_FILE" "$PID_FILE"

for _ in {1..30}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "Dominator started at ${URL}"
    exit 0
  fi
  sleep 0.5
done

echo "Dominator did not become ready. See ${LOG_FILE}" >&2
exit 1
