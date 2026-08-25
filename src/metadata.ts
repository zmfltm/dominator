import { spawn } from 'node:child_process';
import { DETACH_CHILD_PROCESS, signalProcessTree } from './process';
import { youtubeJsRuntimeArgs } from './ytdlp';

export const METADATA_TIMEOUT_MS = 15_000;
export const MAX_RUNNING_METADATA = 7;

let runningMetadata = 0;
const metadataWaiters: Array<() => void> = [];
const metadataByUrl = new Map<string, Promise<VideoMetadata>>();

export class MetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataError';
  }
}

export interface VideoMetadata {
  title: string;
  duration?: number;
  thumbnail?: string;
  clip?: {
    start: number;
    end: number;
  };
}

export function firstNonEmptyLine(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export function parseVideoMetadataOutput(output: string): VideoMetadata | undefined {
  const line = firstNonEmptyLine(output);
  if (!line) return undefined;

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (typeof data.title !== 'string' || data.title.trim().length === 0) return undefined;

  const duration = parseOptionalSeconds(data.duration);
  const clipStart = parseOptionalSeconds(data.section_start);
  const clipEnd = parseOptionalSeconds(data.section_end);
  const thumbnail = parseOptionalHttpUrl(data.thumbnail);
  const metadata: VideoMetadata = { title: data.title };
  if (duration !== undefined) metadata.duration = duration;
  if (thumbnail !== undefined) metadata.thumbnail = thumbnail;
  if (clipStart !== undefined && clipEnd !== undefined && clipEnd > clipStart) {
    metadata.clip = { start: clipStart, end: clipEnd };
  }
  return metadata;
}

function parseOptionalSeconds(value: unknown): number | undefined {
  if (value === null || value === undefined || value === 'NA') return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000) / 1000;
}

function parseOptionalHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value === 'NA') return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function extractYtDlpError(stderr: string): string | undefined {
  const errorLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));
  return errorLines.at(-1)?.replace(/^ERROR:\s*/, '');
}

export async function fetchVideoTitle(url: string, timeoutMs = METADATA_TIMEOUT_MS): Promise<string> {
  return (await fetchVideoMetadata(url, timeoutMs)).title;
}

export function fetchVideoMetadata(url: string, timeoutMs = METADATA_TIMEOUT_MS): Promise<VideoMetadata> {
  const existing = metadataByUrl.get(url);
  if (existing) return existing;

  const lookup = runLimitedMetadataLookup(url, timeoutMs);
  metadataByUrl.set(url, lookup);
  void lookup.finally(() => {
    if (metadataByUrl.get(url) === lookup) metadataByUrl.delete(url);
  }).catch(() => {});
  return lookup;
}

async function runLimitedMetadataLookup(url: string, timeoutMs: number): Promise<VideoMetadata> {
  await acquireMetadataSlot();
  try {
    return await runVideoMetadata(url, timeoutMs);
  } finally {
    releaseMetadataSlot();
  }
}

function acquireMetadataSlot(): Promise<void> {
  if (runningMetadata < MAX_RUNNING_METADATA) {
    runningMetadata += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => metadataWaiters.push(resolve));
}

function releaseMetadataSlot(): void {
  const next = metadataWaiters.shift();
  if (next) {
    next();
    return;
  }
  runningMetadata -= 1;
}

export function buildMetadataYtDlpArgs(url: string): string[] {
  return [
    '--ignore-config',
    ...youtubeJsRuntimeArgs(url),
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--print',
    '%(.{title,duration,section_start,section_end,thumbnail})j',
    '--',
    url,
  ];
}

function runVideoMetadata(url: string, timeoutMs: number): Promise<VideoMetadata> {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', buildMetadataYtDlpArgs(url), {
      detached: DETACH_CHILD_PROCESS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      if (signalProcessTree(child, 'SIGTERM')) {
        forceKillTimer = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 3000);
        forceKillTimer.unref();
      }
    }, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-100_000);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      const message = timedOut
        ? 'could not fetch title before timeout'
        : `failed to start yt-dlp: ${err.message}`;
      settle(() => reject(new MetadataError(message)));
    });

    child.on('close', (code) => {
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settled) return;
      if (timedOut) {
        settle(() => reject(new MetadataError('could not fetch title before timeout')));
        return;
      }
      if (code !== 0) {
        const message = extractYtDlpError(stderr) ?? `yt-dlp exited with code ${code}`;
        settle(() => reject(new MetadataError(message)));
        return;
      }
      const metadata = parseVideoMetadataOutput(stdout);
      if (!metadata) {
        settle(() => reject(new MetadataError('yt-dlp returned no title')));
        return;
      }
      settle(() => resolve(metadata));
    });
  });
}
