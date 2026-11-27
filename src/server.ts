import { serve } from '@hono/node-server';
import { spawnSync } from 'node:child_process';
import { app } from './app';
import { setHevcSupported } from './compress';
import { probeFfmpegHevc, probeFfmpegNetwork } from './ffmpeg';
import {
  reapStaleJobs,
  setSectionDownloads,
  setStartupSweep,
  stopAllJobs,
  sweepLeftoverDirs,
} from './jobs';
import { stopAllMetadata } from './metadata';
import { reapStalePreviews, stopAllPreviews } from './previews';
import { stopAllSoundCloud } from './soundcloud';

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
checkBinary('ffprobe', ['-version']);

void probeFfmpegNetwork().then((works) => {
  setSectionDownloads(works);
  if (!works) {
    console.warn(
      'ffmpeg on PATH crashes when opening network URLs (common with fully static builds), ' +
        'so clips will download the whole video before trimming. ' +
        "Install a distro ffmpeg (e.g. 'sudo apt install ffmpeg') for faster clips.",
    );
  }
});

void probeFfmpegHevc().then((supported) => {
  setHevcSupported(supported);
});

const hostname = process.env.DOMINATOR_HOST ?? '127.0.0.1';
if (hostname !== '127.0.0.1' && hostname !== '0.0.0.0') {
  console.error("DOMINATOR_HOST must be '127.0.0.1' or '0.0.0.0'.");
  process.exit(1);
}

// Reclaim disk from downloads the user never collected; without this a
// long-running server (the startup sweep never fires) accumulates one full
// video file per abandoned job.
const REAP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  reapStaleJobs().catch((err) => console.error('stale job reap failed:', err));
  reapStalePreviews().catch((err) => console.error('stale preview reap failed:', err));
}, REAP_INTERVAL_MS).unref();

// Gate temp dir creation until the post-bind sweep finishes, while binding
// first so a second instance cannot erase the running instance's temp files.
let resolveStartupSweep!: () => void;
setStartupSweep(new Promise<void>((resolve) => {
  resolveStartupSweep = resolve;
}));

const server = serve({ fetch: app.fetch, hostname, port: 3000 }, async (info) => {
  try {
    await sweepLeftoverDirs();
  } catch (err) {
    console.error('startup temp sweep failed:', err);
  } finally {
    resolveStartupSweep();
  }
  console.log(
    `dominator ready: http://127.0.0.1:${info.port} (listening on ${hostname})`,
  );
});

// Children are spawned detached, so the terminal's signal does not reach them.
// Kill them before exiting; a second signal exits immediately.
let shuttingDown = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  console.log(`${signal} received, stopping downloads`);
  server.close();
  void Promise.allSettled([
    stopAllJobs(),
    stopAllPreviews(),
    stopAllMetadata(),
    stopAllSoundCloud(),
  ]).then(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
