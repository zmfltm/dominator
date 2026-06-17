import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
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

  job.child.once('close', () => removeJobDir(job));
  if (!job.child.kill('SIGTERM')) {
    removeJobDir(job);
  }
  const forceKill = setTimeout(() => {
    if (job.status === 'canceled') {
      job.child?.kill('SIGKILL');
    }
  }, 5000);
  forceKill.unref();
  return 'canceled';
}

function activeJobCount(): number {
  return startingJobs + [...jobs.values()].filter((job) => job.status === 'running').length;
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

  const args = [
    ...FORMAT_ARGS[request.format],
    '--no-playlist',
    '--progress',
    '--newline',
    '-o',
    join(dir, '%(title)s.%(ext)s'),
    '--',
    request.url,
  ];
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      const files = await readdir(job.dir);
      if (job.status !== 'running') return;
      if (files.length === 0) {
        failJob(job, 'yt-dlp finished but produced no file');
        return;
      }
      job.filePath = join(job.dir, files[0]);
      job.status = 'done';
      job.completedAt = Date.now();
      job.events.emit('done');
    } catch (err) {
      if (job.status !== 'running') return;
      failJob(job, `could not read output: ${(err as Error).message}`);
    }
  });

  return job;
}

export async function deleteJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  await rm(job.dir, { recursive: true, force: true });
}

export async function sweepLeftoverDirs(): Promise<void> {
  const base = tmpdir();
  const entries = await readdir(base);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TEMP_PREFIX))
      .map((name) => rm(join(base, name), { recursive: true, force: true })),
  );
}

function removeJobDir(job: Pick<Job, 'dir'>): void {
  void rm(job.dir, { recursive: true, force: true });
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

function extractError(stderr: string): string | undefined {
  const errorLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));
  return errorLines.at(-1)?.replace(/^ERROR:\s*/, '');
}
