import { spawn } from 'node:child_process';
import { extractYtDlpError } from './metadata';
import { DETACH_CHILD_PROCESS, signalProcessTree } from './process';
import { isSoundCloudUrl, MAX_PLAYLIST_TRACKS } from './validate';

export const MAX_SOUNDCLOUD_TRACKS = MAX_PLAYLIST_TRACKS;
export const SOUNDCLOUD_TIMEOUT_MS = 30_000;
export const MAX_RUNNING_SOUNDCLOUD_LOOKUPS = 2;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

let runningLookups = 0;
const lookupsByUrl = new Map<string, Promise<SoundCloudResult>>();

export class SoundCloudError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SoundCloudError';
  }
}

export class SoundCloudLimitError extends Error {
  constructor(limit = MAX_RUNNING_SOUNDCLOUD_LOOKUPS) {
    super(`too many SoundCloud playlist lookups; limit is ${limit}`);
    this.name = 'SoundCloudLimitError';
  }
}

export interface SoundCloudTrack {
  url: string;
  title?: string;
}

export interface SoundCloudResult {
  title?: string;
  tracks: SoundCloudTrack[];
}

export function buildSoundCloudYtDlpArgs(url: string): string[] {
  return [
    '--ignore-config',
    '--flat-playlist',
    '--playlist-end',
    String(MAX_SOUNDCLOUD_TRACKS + 1),
    '--dump-single-json',
    '--no-warnings',
    '--',
    url,
  ];
}

export function parseSoundCloudOutput(output: string, sourceUrl: string): SoundCloudResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.trim()) as unknown;
  } catch {
    throw new SoundCloudError('yt-dlp returned invalid SoundCloud data');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SoundCloudError('yt-dlp returned invalid SoundCloud data');
  }
  const data = parsed as Record<string, unknown>;

  const playlistTitle = optionalTitle(data.title);
  if (Array.isArray(data.entries)) {
    if (data.entries.length > MAX_SOUNDCLOUD_TRACKS) {
      throw new SoundCloudError(
        `SoundCloud playlists are limited to ${MAX_SOUNDCLOUD_TRACKS} tracks`,
      );
    }
    const tracks = data.entries.map((entry) => parseTrack(entry));
    if (tracks.length === 0) {
      throw new SoundCloudError('SoundCloud playlist contains no downloadable tracks');
    }
    return playlistTitle ? { title: playlistTitle, tracks } : { tracks };
  }

  if (!isSoundCloudUrl(sourceUrl)) {
    throw new SoundCloudError('SoundCloud returned an invalid track URL');
  }
  const trackUrl = firstSoundCloudUrl(data.webpage_url, data.original_url, sourceUrl);
  const title = optionalTitle(data.title);
  return {
    ...(title ? { title } : {}),
    tracks: [{ url: trackUrl, ...(title ? { title } : {}) }],
  };
}

function parseTrack(value: unknown): SoundCloudTrack {
  if (typeof value !== 'object' || value === null) {
    throw new SoundCloudError('SoundCloud returned an invalid playlist entry');
  }
  const entry = value as Record<string, unknown>;
  const url = firstSoundCloudUrl(entry.webpage_url, entry.original_url, entry.url);
  const title = optionalTitle(entry.title);
  return title ? { url, title } : { url };
}

function firstSoundCloudUrl(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && isSoundCloudUrl(value)) return value;
  }
  throw new SoundCloudError('SoundCloud returned an invalid track URL');
}

function optionalTitle(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function resolveSoundCloudUrl(
  url: string,
  timeoutMs = SOUNDCLOUD_TIMEOUT_MS,
): Promise<SoundCloudResult> {
  const existing = lookupsByUrl.get(url);
  if (existing) return existing;
  if (runningLookups >= MAX_RUNNING_SOUNDCLOUD_LOOKUPS) {
    throw new SoundCloudLimitError();
  }

  runningLookups += 1;
  const lookup = runSoundCloudLookup(url, timeoutMs);
  lookupsByUrl.set(url, lookup);
  void lookup.finally(() => {
    runningLookups -= 1;
    if (lookupsByUrl.get(url) === lookup) lookupsByUrl.delete(url);
  }).catch(() => {});
  return lookup;
}

function runSoundCloudLookup(url: string, timeoutMs: number): Promise<SoundCloudResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', buildSoundCloudYtDlpArgs(url), {
      detached: DETACH_CHILD_PROCESS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let outputTooLarge = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const stopChild = () => {
      if (signalProcessTree(child, 'SIGTERM')) {
        forceKillTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 3000);
        forceKillTimer.unref();
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutMs);
    timeout.unref();

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (outputTooLarge) return;
      stdout += chunk;
      if (Buffer.byteLength(stdout) > MAX_OUTPUT_BYTES) {
        outputTooLarge = true;
        stopChild();
      }
    });

    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    child.on('error', (err) => {
      const message = timedOut
        ? 'SoundCloud playlist lookup timed out'
        : `failed to start yt-dlp: ${err.message}`;
      settle(() => reject(new SoundCloudError(message)));
    });

    child.on('close', (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settled) return;
      if (timedOut) {
        settle(() => reject(new SoundCloudError('SoundCloud playlist lookup timed out')));
        return;
      }
      if (outputTooLarge) {
        settle(() => reject(new SoundCloudError('SoundCloud playlist data is too large')));
        return;
      }
      if (code !== 0) {
        const message = extractYtDlpError(stderr) ?? `yt-dlp exited with code ${code}`;
        settle(() => reject(new SoundCloudError(message)));
        return;
      }
      try {
        const result = parseSoundCloudOutput(stdout, url);
        settle(() => resolve(result));
      } catch (err) {
        const error = err instanceof SoundCloudError
          ? err
          : new SoundCloudError((err as Error).message);
        settle(() => reject(error));
      }
    });
  });
}
