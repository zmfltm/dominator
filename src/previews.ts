import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { DETACH_CHILD_PROCESS, signalProcessTree } from './process';
import { youtubeJsRuntimeArgs } from './ytdlp';

export const PREVIEW_TEMP_PREFIX = 'dominator-preview-';
export const PREVIEW_TTL_MS = 60 * 60 * 1000;
export const PREVIEW_TIMEOUT_MS = 2 * 60 * 1000;
export const MAX_RUNNING_PREVIEWS = 2;
export const PREVIEW_FRAME_COUNT = 5;
export const PREVIEW_FRAME_WIDTH = 120;
export const PREVIEW_FRAME_HEIGHT = 68;

export class PreviewLimitError extends Error {
  constructor(limit = MAX_RUNNING_PREVIEWS) {
    super(`too many active previews; limit is ${limit}`);
    this.name = 'PreviewLimitError';
  }
}

export interface Preview {
  id: string;
  url: string;
  dir: string;
  status: 'running' | 'done' | 'error';
  spritePath?: string;
  sourcePath?: string;
  duration?: number;
  error?: string;
  completedAt?: number;
  child?: ChildProcessByStdio<null, Readable, Readable>;
}

interface ProcessOutput {
  stdout: string;
  stderr: string;
}

const previews = new Map<string, Preview>();
const previewByUrl = new Map<string, string>();
const startingPreviewByUrl = new Map<string, Promise<Preview>>();
let startingPreviews = 0;

export function getPreview(id: string): Preview | undefined {
  return previews.get(id);
}

export function previewSpriteUrl(preview: Pick<Preview, 'id'>): string {
  return `/api/previews/${preview.id}/sprite`;
}

export function previewSourceUrl(preview: Pick<Preview, 'id'>): string {
  return `/api/previews/${preview.id}/source`;
}

export function previewStatusBody(preview: Preview): Record<string, unknown> {
  return {
    previewId: preview.id,
    status: preview.status,
    ...(preview.duration !== undefined ? { duration: preview.duration } : {}),
    ...(preview.status === 'done' ? {
      spriteUrl: previewSpriteUrl(preview),
      sourceUrl: previewSourceUrl(preview),
    } : {}),
    ...(preview.status === 'error' ? { error: preview.error ?? 'preview failed' } : {}),
  };
}

export function buildPreviewYtDlpArgs(url: string, dir: string): string[] {
  return [
    '--ignore-config',
    ...youtubeJsRuntimeArgs(url),
    '-f',
    'worst[height<=360][ext=mp4]/worst[height<=360]/worstvideo*[height<=360][ext=mp4]+worstaudio[ext=m4a]/worstvideo*[height<=360]+worstaudio/worst',
    '--merge-output-format',
    'mp4',
    '--no-playlist',
    '--no-warnings',
    '--max-filesize',
    '80M',
    '-o',
    join(dir, 'source.%(ext)s'),
    '--',
    url,
  ];
}

export function buildPreviewDurationArgs(url: string): string[] {
  return [
    '--ignore-config',
    ...youtubeJsRuntimeArgs(url),
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--print',
    'duration',
    '--',
    url,
  ];
}

export function parsePreviewDuration(output: string): number | undefined {
  const line = output
    .split('\n')
    .map((value) => value.trim())
    .find((value) => value.length > 0 && value !== 'NA');
  if (!line) return undefined;
  const duration = Number(line);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60) return undefined;
  return Math.round(duration * 1000) / 1000;
}

export function buildFilmstripFfmpegArgs(
  inputPath: string,
  outputPath: string,
  duration?: number,
): string[] {
  const fps = duration ? clamp(PREVIEW_FRAME_COUNT / duration, 0.000001, 30) : 0.1;
  const filter = [
    `fps=${fps.toFixed(6)}`,
    `scale=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:force_original_aspect_ratio=decrease`,
    `pad=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2`,
    `tile=${PREVIEW_FRAME_COUNT}x1`,
  ].join(',');

  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-i',
    inputPath,
    '-vf',
    filter,
    '-frames:v',
    '1',
    '-update',
    '1',
    '-q:v',
    '5',
    outputPath,
  ];
}

export function isPreviewStale(
  preview: Pick<Preview, 'status' | 'completedAt'>,
  ttlMs: number,
  now: number,
): boolean {
  if (preview.status === 'running' || preview.completedAt === undefined) return false;
  return now - preview.completedAt > ttlMs;
}

export function startPreview(url: string): Promise<Preview> {
  const cached = getCachedPreview(url);
  if (cached) return Promise.resolve(cached);

  const existing = startingPreviewByUrl.get(url);
  if (existing) return existing;

  const preview = createPreview(url);
  startingPreviewByUrl.set(url, preview);
  void preview.finally(() => {
    if (startingPreviewByUrl.get(url) === preview) startingPreviewByUrl.delete(url);
  }).catch(() => {});
  return preview;
}

async function createPreview(url: string): Promise<Preview> {
  if (runningPreviewCount() >= MAX_RUNNING_PREVIEWS) {
    throw new PreviewLimitError();
  }

  startingPreviews += 1;
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), PREVIEW_TEMP_PREFIX));
  } catch (err) {
    startingPreviews -= 1;
    throw err;
  }

  const preview: Preview = {
    id: randomUUID(),
    url,
    dir,
    status: 'running',
  };
  previews.set(preview.id, preview);
  previewByUrl.set(url, preview.id);
  startingPreviews -= 1;

  void generatePreview(preview).catch((err) => {
    console.error(`preview generation cleanup failed for ${preview.id}:`, err);
  });
  return preview;
}

export async function deletePreview(id: string): Promise<void> {
  const preview = previews.get(id);
  if (!preview) return;
  await rm(preview.dir, { recursive: true, force: true });
  if (previews.get(id) === preview) previews.delete(id);
  if (previewByUrl.get(preview.url) === id) previewByUrl.delete(preview.url);
}

export async function reapStalePreviews(ttlMs = PREVIEW_TTL_MS, now = Date.now()): Promise<void> {
  const stale = [...previews.values()].filter((preview) => isPreviewStale(preview, ttlMs, now));
  await Promise.all(stale.map((preview) => deletePreview(preview.id)));
}

async function generatePreview(preview: Preview): Promise<void> {
  try {
    const duration = await fetchPreviewDuration(preview);
    preview.duration = duration;
    const inputPath = await downloadPreviewVideo(preview);
    preview.sourcePath = inputPath;
    const spritePath = join(preview.dir, 'sprite.jpg');
    await createFilmstrip(preview, inputPath, spritePath, duration);
    const { size } = await stat(spritePath);
    if (size === 0) throw new Error('ffmpeg produced an empty preview');
    preview.spritePath = spritePath;
    preview.status = 'done';
    preview.completedAt = Date.now();
    preview.child = undefined;
  } catch (err) {
    if (preview.status !== 'running') return;
    preview.status = 'error';
    preview.error = (err as Error).message;
    preview.completedAt = Date.now();
    preview.child = undefined;
    await rm(preview.dir, { recursive: true, force: true }).catch((cleanupError) => {
      console.error(`failed to clean preview ${preview.id}:`, cleanupError);
    });
  }
}

function getCachedPreview(url: string): Preview | undefined {
  const id = previewByUrl.get(url);
  if (!id) return undefined;
  const preview = previews.get(id);
  if (!preview || preview.status === 'error') {
    previewByUrl.delete(url);
    return undefined;
  }
  return preview;
}

function runningPreviewCount(): number {
  return startingPreviews + [...previews.values()].filter((preview) => preview.status === 'running').length;
}

async function fetchPreviewDuration(preview: Preview): Promise<number | undefined> {
  try {
    const { stdout } = await runProcess(
      preview,
      'yt-dlp',
      buildPreviewDurationArgs(preview.url),
      20_000,
    );
    return parsePreviewDuration(stdout);
  } catch {
    return undefined;
  }
}

async function downloadPreviewVideo(preview: Preview): Promise<string> {
  await runProcess(preview, 'yt-dlp', buildPreviewYtDlpArgs(preview.url, preview.dir), PREVIEW_TIMEOUT_MS);
  const filePath = await findPreviewInput(preview.dir);
  if (!filePath) throw new Error('yt-dlp produced no preview video');
  return filePath;
}

async function createFilmstrip(
  preview: Preview,
  inputPath: string,
  outputPath: string,
  duration?: number,
): Promise<void> {
  await runProcess(preview, 'ffmpeg', buildFilmstripFfmpegArgs(inputPath, outputPath, duration), 60_000);
}

async function findPreviewInput(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (
      name.startsWith('source.') &&
      !name.endsWith('.part') &&
      !name.endsWith('.ytdl') &&
      !name.endsWith('.temp')
    ))
    .sort();
  return files[0] ? join(dir, files[0]) : undefined;
}

function runProcess(
  preview: Preview,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, args, {
        detached: DETACH_CHILD_PROCESS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`failed to start ${command}: ${(err as Error).message}`));
      return;
    }

    preview.child = child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      if (signalProcessTree(child, 'SIGTERM')) {
        forceKill = setTimeout(() => signalProcessTree(child, 'SIGKILL'), 3000);
        forceKill.unref();
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
        ? `${command} timed out while building preview`
        : `failed to start ${command}: ${err.message}`;
      settle(() => reject(new Error(message)));
    });

    child.on('close', (code, signal) => {
      if (forceKill) clearTimeout(forceKill);
      if (timedOut) {
        settle(() => reject(new Error(`${command} timed out while building preview`)));
        return;
      }
      if (code === 0) {
        settle(() => resolve({ stdout, stderr }));
        return;
      }
      const message = extractProcessError(stderr) ?? exitMessage(command, code, signal);
      settle(() => reject(new Error(message)));
    });
  });
}

function extractProcessError(stderr: string): string | undefined {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const ytDlpError = lines.findLast((line) => line.startsWith('ERROR:'));
  if (ytDlpError) return ytDlpError.replace(/^ERROR:\s*/, '');
  return lines.findLast((line) => /\b(error|failed|invalid)\b/i.test(line));
}

function exitMessage(command: string, code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === 'number' && code < 0) {
    return `${command} crashed while building preview (signal ${Math.abs(code)})`;
  }
  if (signal) return `${command} stopped while building preview (${signal})`;
  return `${command} exited with code ${code}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
