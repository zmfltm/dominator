import { serve } from '@hono/node-server';
import { spawnSync } from 'node:child_process';
import { app } from './app';
import { reapStaleJobs, sweepLeftoverDirs } from './jobs';

function checkBinary(name: string, versionArgs: string[]): void {
  const result = spawnSync(name, versionArgs, { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.error(
      `dominator needs '${name}' on PATH and could not run it.\n` +
        `Install it (e.g. 'brew install ${name}' or your distro's package) and retry.`,
    );
    process.exit(1);
  }
}

checkBinary('yt-dlp', ['--version']);
checkBinary('ffmpeg', ['-version']);

await sweepLeftoverDirs();

// Reclaim disk from downloads the user never collected; without this a
// long-running server (the startup sweep never fires) accumulates one full
// video file per abandoned job.
const REAP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  reapStaleJobs().catch((err) => console.error('stale job reap failed:', err));
}, REAP_INTERVAL_MS).unref();

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3000 }, (info) => {
  console.log(`dominator ready: http://127.0.0.1:${info.port}`);
});
