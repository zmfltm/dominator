#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
URL="http://127.0.0.1:3000"
LOG_FILE="${APP_DIR}/.local-start.log"

export PATH="${HOME}/.local/bin:${HOME}/.bun/bin:${HOME}/.npm-global/bin:${PATH}"

cd "$APP_DIR"

START_SCRIPT="start"
IS_WSL=false
if [[ -r /proc/sys/kernel/osrelease ]] && grep -qi microsoft /proc/sys/kernel/osrelease; then
  START_SCRIPT="start:wsl"
  IS_WSL=true
fi

open_browser() {
  if [[ -r /proc/sys/kernel/osrelease ]] && grep -qi microsoft /proc/sys/kernel/osrelease; then
    if command -v cmd.exe >/dev/null 2>&1; then
      cmd.exe /c start "" "$URL" >/dev/null 2>&1 &
      return
    fi
  elif [[ "$(uname -s)" == "Darwin" ]] && command -v open >/dev/null 2>&1; then
    open "$URL" >/dev/null 2>&1 &
    return
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 &
    return
  fi

  echo "Open ${URL} in your browser."
}

if command -v curl >/dev/null 2>&1 && curl -fsS "$URL" >/dev/null 2>&1; then
  echo "Dominator is already running at ${URL}"
  open_browser
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
SERVER_PID=""

# WSL terminates a plain nohup child when the wsl.exe command that launched it
# exits. A user service keeps the server attached to WSL's service manager
# after the Documents shortcut returns.
if [[ "$IS_WSL" == true ]] && command -v systemd-run >/dev/null 2>&1 && \
  systemctl --user show-environment >/dev/null 2>&1; then
  PNPM_BIN="$(command -v pnpm)"
  systemctl --user stop dominator.service >/dev/null 2>&1 || true
  systemctl --user reset-failed dominator.service >/dev/null 2>&1 || true
  systemd-run --user --unit=dominator --collect \
    --description="Dominator local server" \
    --property="WorkingDirectory=${APP_DIR}" \
    --property="StandardOutput=append:${LOG_FILE}" \
    --property="StandardError=append:${LOG_FILE}" \
    --setenv="PATH=${PATH}" \
    "$PNPM_BIN" "$START_SCRIPT" >/dev/null
else
  nohup pnpm "$START_SCRIPT" >> "$LOG_FILE" 2>&1 </dev/null &
  SERVER_PID=$!
fi

for _ in {1..30}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    echo "Dominator started at ${URL}"
    open_browser

    # Without a user service, keep the launching WSL process alive. Otherwise
    # WSL kills the detached server as soon as this script returns.
    if [[ "$IS_WSL" == true && -n "$SERVER_PID" ]]; then
      wait "$SERVER_PID"
    fi
    exit 0
  fi
  sleep 0.5
done

echo "Dominator did not become ready. See ${LOG_FILE}" >&2
exit 1
