import { spawn } from 'node:child_process';

export const METADATA_TIMEOUT_MS = 15_000;

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
  const [title, durationText, clipStartText, clipEndText, thumbnailText] = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (!title || title === 'NA') return undefined;

  const duration = parseOptionalSeconds(durationText);
  const clipStart = parseOptionalSeconds(clipStartText);
  const clipEnd = parseOptionalSeconds(clipEndText);
  const thumbnail = parseOptionalHttpUrl(thumbnailText);
  const metadata: VideoMetadata = { title };
  if (duration !== undefined) metadata.duration = duration;
  if (thumbnail !== undefined) metadata.thumbnail = thumbnail;
  if (clipStart !== undefined && clipEnd !== undefined && clipEnd > clipStart) {
    metadata.clip = { start: clipStart, end: clipEnd };
  }
  return metadata;
}

function parseOptionalSeconds(value: string | undefined): number | undefined {
  if (!value || value === 'NA') return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) return undefined;
  return Math.round(seconds * 1000) / 1000;
}

function parseOptionalHttpUrl(value: string | undefined): string | undefined {
  if (!value || value === 'NA') return undefined;
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
  return new Promise((resolve, reject) => {
    const child = spawn(
      'yt-dlp',
      [
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--print',
        'title',
        '--print',
        'duration',
        '--print',
        'section_start',
        '--print',
        'section_end',
        '--print',
        'thumbnail',
        '--',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new MetadataError('could not fetch title before timeout')));
    }, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-100_000);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      settle(() => reject(new MetadataError(`failed to start yt-dlp: ${err.message}`)));
    });

    child.on('close', (code) => {
      if (settled) return;
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
