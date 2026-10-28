import { spawn } from 'node:child_process';

const PROBE_TIMEOUT_MS = 5000;

// Fully static ffmpeg builds (for example johnvansickle.com) segfault when
// they resolve a hostname, so they cannot read the remote streams yt-dlp hands
// them for section downloads. Resolving localhost reproduces the crash without
// touching the network: a working build just fails to connect.
export function probeFfmpegNetwork(): Promise<boolean> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'quiet', '-i', 'http://localhost:9/', '-f', 'null', '-'],
        { stdio: 'ignore' },
      );
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(true);
    }, PROBE_TIMEOUT_MS);
    timer.unref();
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(isCleanExit(code, signal));
    });
  });
}

export function isCleanExit(code: number | null, signal: NodeJS.Signals | null): boolean {
  if (signal) return false;
  return code !== null && code < 128;
}
