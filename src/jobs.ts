import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import type { Readable } from 'node:stream';
import { DETACH_CHILD_PROCESS, signalProcessTree } from './process';
import { parseProgressLine, type ProgressEvent } from './progress';
import type { JobRequest } from './validate';

export const TEMP_PREFIX = 'dominator-';

// How long a finished job's file is kept on disk waiting to be collected
// before the reaper deletes it. Generous: the browser fetches within seconds
// of the 'done' event, so this only ever reclaims downloads the user
// abandoned (e.g. closed the tab). Matters for long-running deployments where
// the startup sweep never fires.
export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_RUNNING_JOBS = 7;

export class JobLimitError extends Error {
  constructor(limit = MAX_RUNNING_JOBS) {
    super(`too many active jobs; limit is ${limit}`);
    this.name = 'JobLimitError';
  }
}

export interface Job {
  id: string;
  dir: string;
  status: 'running' | 'done' | 'error' | 'canceled';
  filePath?: string;
  error?: string;
  events: EventEmitter;
  lastProgress: ProgressEvent | null;
  completedAt?: number;
  child?: ChildProcessByStdio<null, Readable, Readable>;
}

const jobs = new Map<string, Job>();
let startingJobs = 0;

const FORMAT_ARGS: Record<JobRequest['format'], string[]> = {
  mp4: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b'],
  mp3: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
};

type Clip = NonNullable<JobRequest['clip']>;

export function formatClipTimestamp(seconds: number): string {
  let wholeSeconds = Math.floor(seconds);
  let milliseconds = Math.round((seconds - wholeSeconds) * 1000);
  if (milliseconds === 1000) {
    wholeSeconds += 1;
    milliseconds = 0;
  }

  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;
  const base = [hours, minutes, secs]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');

  if (milliseconds === 0) return base;
  const fraction = String(milliseconds).padStart(3, '0').replace(/0+$/, '');
  return `${base}.${fraction}`;
}

export function clipOutputPath(inputPath: string, format: JobRequest['format']): string {
  const parsed = parse(inputPath);
  return join(parsed.dir, `${parsed.name}.clip.${format}`);
}

export function buildFfmpegCopyClipArgs(
  inputPath: string,
  outputPath: string,
  clip: Clip,
  format: JobRequest['format'],
): string[] {
  return [
    ...ffmpegBaseClipArgs(inputPath, clip),
    ...ffmpegCopyOutputArgs(format),
    outputPath,
  ];
}

export function buildFfmpegReencodeClipArgs(
  inputPath: string,
  outputPath: string,
  clip: Clip,
  format: JobRequest['format'],
): string[] {
  return [
    ...ffmpegBaseClipArgs(inputPath, clip),
    ...ffmpegReencodeOutputArgs(format),
    outputPath,
  ];
}

export function buildYtDlpArgs(request: JobRequest, dir: string): string[] {
  return [
    '--ignore-config',
    ...FORMAT_ARGS[request.format],
    '--no-playlist',
    '--progress',
    '--newline',
    '-o',
    join(dir, '%(title)s.%(ext)s'),
    '--',
    request.url,
  ];
}

function ffmpegBaseClipArgs(inputPath: string, clip: Clip): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'warning',
    '-y',
    '-ss',
    formatClipTimestamp(clip.start),
    '-i',
    inputPath,
    '-t',
    formatClipTimestamp(clip.end - clip.start),
  ];
}

function ffmpegCopyOutputArgs(format: JobRequest['format']): string[] {
  if (format === 'mp3') {
    return ['-vn', '-map', '0:a:0?', '-c', 'copy'];
  }
  return [
    '-map',
    '0:v:0?',
    '-map',
    '0:a?',
    '-sn',
    '-dn',
    '-c',
    'copy',
    '-avoid_negative_ts',
    'make_zero',
    '-movflags',
    '+faststart',
  ];
}

function ffmpegReencodeOutputArgs(format: JobRequest['format']): string[] {
  if (format === 'mp3') {
    return ['-vn', '-map', '0:a:0?', '-c:a', 'libmp3lame', '-q:a', '2'];
  }
  return [
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
  ];
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export type CancelJobResult = 'canceled' | 'not_found' | 'not_running';

export function cancelJob(id: string): CancelJobResult {
  const job = jobs.get(id);
  if (!job) return 'not_found';
  if (job.status !== 'running') return 'not_running';

  job.status = 'canceled';
  job.error = 'job canceled';
  job.completedAt = Date.now();
  job.events.emit('canceled');

  if (!job.child) {
    removeJobDir(job);
    return 'canceled';
  }

  let forceKill: NodeJS.Timeout | undefined;
  job.child.once('close', () => {
    if (forceKill) clearTimeout(forceKill);
    removeJobDir(job);
  });
  if (!signalProcessTree(job.child, 'SIGTERM')) {
    removeJobDir(job);
    return 'canceled';
  }
  forceKill = setTimeout(() => {
    if (job.status === 'canceled') {
      if (job.child) signalProcessTree(job.child, 'SIGKILL');
    }
  }, 5000);
  forceKill.unref();
  return 'canceled';
}

function activeJobCount(): number {
  return startingJobs + [...jobs.values()].filter((job) => (
    job.status === 'running' || (job.status === 'canceled' && isChildAlive(job.child))
  )).length;
}

function isChildAlive(child: Job['child']): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null);
}

export function isAtJobLimit(activeCount: number, limit = MAX_RUNNING_JOBS): boolean {
  return activeCount >= limit;
}

export async function startJob(request: JobRequest): Promise<Job> {
  if (isAtJobLimit(activeJobCount())) {
    throw new JobLimitError();
  }

  startingJobs += 1;
  let dir: string;
  try {
    dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  } catch (err) {
    startingJobs -= 1;
    throw err;
  }
  const job: Job = {
    id: randomUUID(),
    dir,
    status: 'running',
    events: new EventEmitter(),
    lastProgress: null,
  };
  jobs.set(job.id, job);
  startingJobs -= 1;

  const args = buildYtDlpArgs(request, dir);
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn('yt-dlp', args, {
      detached: DETACH_CHILD_PROCESS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    failJob(job, `failed to start yt-dlp: ${(err as Error).message}`);
    return job;
  }
  job.child = child;

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let pending = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    if (job.status !== 'running') return;
    for (const line of lines) {
      const progress = parseProgressLine(line);
      if (progress) {
        job.lastProgress = progress;
        job.events.emit('progress', progress);
      }
    }
  });

  child.on('error', (err) => {
    if (job.status !== 'running') return;
    failJob(job, `failed to start yt-dlp: ${err.message}`);
  });

  child.on('close', async (code) => {
    if (job.status !== 'running') return;
    if (code !== 0) {
      failJob(job, extractError(stderr) ?? `yt-dlp exited with code ${code}`);
      return;
    }
    try {
      const filePath = await findDownloadedFile(job.dir);
      if (job.status !== 'running') return;
      if (!filePath) {
        failJob(job, 'yt-dlp finished but produced no file');
        return;
      }
      job.filePath = request.clip
        ? await trimDownloadedFile(job, filePath, request.clip, request.format)
        : filePath;
      if (job.status !== 'running') return;
      job.status = 'done';
      job.completedAt = Date.now();
      job.events.emit('done');
    } catch (err) {
      if (job.status !== 'running') return;
      failJob(job, `could not prepare output: ${(err as Error).message}`);
    }
  });

  return job;
}

async function findDownloadedFile(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => (
      !name.endsWith('.part') && !name.endsWith('.ytdl') && !name.endsWith('.temp')
    ))
    .sort();
  return files[0] ? join(dir, files[0]) : undefined;
}

async function trimDownloadedFile(
  job: Job,
  inputPath: string,
  clip: Clip,
  format: JobRequest['format'],
): Promise<string> {
  emitProcessing(job);
  const outputPath = clipOutputPath(inputPath, format);

  const copyError = await runFfmpeg(
    job,
    buildFfmpegCopyClipArgs(inputPath, outputPath, clip, format),
  );
  if (job.status !== 'running') return outputPath;

  if (copyError) {
    const encodeError = await runFfmpeg(
      job,
      buildFfmpegReencodeClipArgs(inputPath, outputPath, clip, format),
    );
    if (job.status !== 'running') return outputPath;
    if (encodeError) {
      throw new Error(`ffmpeg could not clip file: ${encodeError}`);
    }
  }

  const { size } = await stat(outputPath);
  if (size === 0) {
    throw new Error('ffmpeg finished but produced an empty clip');
  }
  await rm(inputPath, { force: true });
  return outputPath;
}

function emitProcessing(job: Job): void {
  const progress: ProgressEvent = { stage: 'processing' };
  job.lastProgress = progress;
  job.events.emit('progress', progress);
}

function runFfmpeg(job: Job, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn('ffmpeg', args, {
        detached: DETACH_CHILD_PROCESS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve(`failed to start ffmpeg: ${(err as Error).message}`);
      return;
    }

    job.child = child;
    let stderr = '';
    let settled = false;
    const settle = (message: string | null) => {
      if (settled) return;
      settled = true;
      resolve(message);
    };

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      settle(`failed to start ffmpeg: ${err.message}`);
    });

    child.on('close', (code, signal) => {
      if (job.status !== 'running') {
        settle(null);
        return;
      }
      if (code === 0) {
        settle(null);
        return;
      }
      settle(extractFfmpegError(stderr) ?? ffmpegExitMessage(code, signal));
    });
  });
}

export async function deleteJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  await rm(job.dir, { recursive: true, force: true });
  if (jobs.get(id) === job) jobs.delete(id);
}

export function isOwnedTempDirName(name: string): boolean {
  return /^dominator-(?:preview-)?[A-Za-z0-9]{6}$/.test(name);
}

export async function sweepLeftoverDirs(): Promise<void> {
  const base = tmpdir();
  const entries = await readdir(base);
  await Promise.all(
    entries
      .filter(isOwnedTempDirName)
      .map((name) => rm(join(base, name), { recursive: true, force: true })),
  );
}

function removeJobDir(job: Pick<Job, 'dir'>): void {
  void rm(job.dir, { recursive: true, force: true }).catch((err) => {
    console.error(`failed to clean job directory ${job.dir}:`, err);
  });
}

function failJob(job: Job, message: string): void {
  job.status = 'error';
  job.error = message;
  job.completedAt = Date.now();
  job.events.emit('failed', message);
  removeJobDir(job);
}

export function isStale(
  job: Pick<Job, 'status' | 'completedAt'>,
  ttlMs: number,
  now: number,
): boolean {
  if (job.status === 'running' || job.completedAt === undefined) return false;
  return now - job.completedAt > ttlMs;
}

export async function reapStaleJobs(ttlMs = JOB_TTL_MS, now = Date.now()): Promise<void> {
  const stale = [...jobs.values()].filter((job) => isStale(job, ttlMs, now));
  await Promise.all(stale.map((job) => deleteJob(job.id)));
}

function extractFfmpegError(stderr: string): string | undefined {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .findLast((line) => /\b(error|failed|invalid)\b/i.test(line));
}

function ffmpegExitMessage(code: number | null, signal: NodeJS.Signals | null): string {
  if (typeof code === 'number' && code < 0) {
    return `ffmpeg crashed while clipping (signal ${Math.abs(code)})`;
  }
  if (signal) {
    return `ffmpeg crashed while clipping (${signal})`;
  }
  return `ffmpeg exited with code ${code}`;
}

function extractError(stderr: string): string | undefined {
  const errorLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));
  return errorLines.at(-1)?.replace(/^ERROR:\s*/, '');
}
