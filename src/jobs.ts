import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  buildFfmpegCompressArgs,
  compressedFileName,
  DEFAULT_COMPRESS_OPTIONS,
  MAX_UPLOAD_BYTES,
  parseFfmpegProgressLine,
  probeMedia,
  uploadFileName,
  type CompressOptions,
} from './compress';
import { DETACH_CHILD_PROCESS, signalProcessTree } from './process';
import { fitFileName } from './filename';
import { createProgressTracker, type ProgressEvent } from './progress';
import { isSoundCloudUrl, isTwitterUrl, isYouTubeUrl, type JobRequest } from './validate';
import { youtubeExtractorArgs } from './ytdlp';

export const TEMP_PREFIX = 'dominator-';

// How long a finished job's file is kept on disk waiting to be collected
// before the reaper deletes it. Generous: the browser fetches within seconds
// of the 'done' event, so this only ever reclaims downloads the user
// abandoned (e.g. closed the tab). Matters for long-running deployments where
// the startup sweep never fires.
export const JOB_TTL_MS = 60 * 60 * 1000;
export const MAX_RUNNING_JOBS = 7;
// Wall-clock limit for one download plus clipping. Without it a hung yt-dlp or
// ffmpeg holds a job slot until the user cancels or the server restarts.
export const DEFAULT_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
export const JOB_TIMEOUT_MS = parseJobTimeoutMs(process.env.DOMINATOR_JOB_TIMEOUT_MS);
// yt-dlp can print several progress lines per second per job. Clients only
// need a few updates a second, so intermediate lines are coalesced.
export const PROGRESS_INTERVAL_MS = 120;
const TITLE_PRINT_PREFIX = 'DOMINATOR_TITLE:';

// When ffmpeg can open network URLs, clips download only the selected section.
// Otherwise the whole video is downloaded and trimmed locally. Set at startup
// from probeFfmpegNetwork().
let sectionDownloads = false;
let startupSweep: Promise<void> = Promise.resolve();

export function setSectionDownloads(enabled: boolean): void {
  sectionDownloads = enabled;
}

// Holds new temp directory creation until the post-bind startup sweep finishes,
// preventing a race between startup cleanup and early requests.
export function setStartupSweep(promise: Promise<void>): void {
  startupSweep = promise.catch(() => {});
}

export function waitForStartupSweep(): Promise<void> {
  return startupSweep;
}

export class JobLimitError extends Error {
  constructor(limit = MAX_RUNNING_JOBS) {
    super(`too many active jobs; limit is ${limit}`);
    this.name = 'JobLimitError';
  }
}

export type UploadFailure = 'too_large' | 'empty' | 'aborted';

export class UploadError extends Error {
  constructor(readonly reason: UploadFailure) {
    super({
      too_large: 'file is too large',
      empty: 'file is empty',
      aborted: 'upload did not finish',
    }[reason]);
    this.name = 'UploadError';
  }
}

export interface Job {
  id: string;
  dir: string;
  status: 'running' | 'done' | 'error' | 'canceled';
  // How a clip is produced: only the section is downloaded, or the full video
  // is downloaded and trimmed locally.
  clipMode?: 'section' | 'full';
  filePath?: string;
  title?: string;
  error?: string;
  events: EventEmitter;
  lastProgress: ProgressEvent | null;
  completedAt?: number;
  child?: ChildProcessByStdio<null, Readable, Readable>;
  deadline?: NodeJS.Timeout;
}

const jobs = new Map<string, Job>();
let startingJobs = 0;

const FORMAT_ARGS: Record<JobRequest['format'], string[]> = {
  mp4: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b'],
  // Highest resolution, frame rate, and bitrate the site offers (4K and up),
  // in whatever codec it serves. yt-dlp picks the merge container (often
  // WebM or MKV for VP9/AV1), so nothing is re-encoded.
  original: ['-f', 'bv*+ba/b'],
  mp3: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
  audio: ['-f', 'bestaudio/best'],
};

// Twitter/X throttles its progressive http MP4s to roughly 50 KB/s, while the
// HLS renditions of the same video download at full speed. Prefer HLS there.
const TWITTER_MP4_FORMAT_ARGS = [
  '-f',
  'bv*[ext=mp4][protocol^=m3u8]+ba[protocol^=m3u8]/b[ext=mp4][protocol^=m3u8]/bv*[ext=mp4]+ba/b[ext=mp4]/b',
];

// Fetch Twitter/X HLS fragments in parallel. Not used for other hosts:
// YouTube answers parallel HLS fragment requests with 401.
const TWITTER_CONCURRENT_FRAGMENT_ARGS = ['--concurrent-fragments', '4'];

// YouTube sometimes serves a stream URL capped near 100 KB/s for the whole
// download. Chunked requests and a throttled-rate fallback keep throughput high.
const YOUTUBE_DOWNLOAD_ARGS = ['--throttled-rate', '100K', '--http-chunk-size', '10M'];

// Prefer H.264 video and AAC audio so saved MP4s upload directly to sites like
// Twitter/X, which reject AV1 and VP9. Keep resolution ahead of acodec so bv*
// does not pick a combined 360p H.264+AAC stream over a higher-res video stream.
const H264_SORT_ARGS = ['-S', 'vcodec:h264,res,acodec:aac'];

function formatArgs(request: JobRequest): string[] {
  if (request.format === 'original') {
    // Resolution first, then HLS over the throttled progressive MP4s.
    return isTwitterUrl(request.url)
      ? [...FORMAT_ARGS.original, '-S', 'res,fps,proto:m3u8_native']
      : FORMAT_ARGS.original;
  }
  if (request.format !== 'mp4') return FORMAT_ARGS[request.format];
  const selector = isTwitterUrl(request.url) ? TWITTER_MP4_FORMAT_ARGS : FORMAT_ARGS.mp4;
  return [...selector, ...H264_SORT_ARGS];
}

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

// Original-quality clips keep the downloaded container when stream-copied.
// A re-encoded fallback is H.264/AAC, so it goes to MP4.
export function clipOutputPath(
  inputPath: string,
  format: JobRequest['format'],
  options: { reencode?: boolean } = {},
): string {
  const parsed = parse(inputPath);
  const extension = format !== 'original'
    ? format
    : options.reencode ? 'mp4' : parsed.ext.slice(1) || 'mkv';
  return join(parsed.dir, fitFileName(parsed.name, `.clip.${extension}`));
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

export function parseJobTimeoutMs(value: string | undefined): number {
  if (!value) return DEFAULT_JOB_TIMEOUT_MS;
  const ms = Number(value);
  return Number.isSafeInteger(ms) && ms > 0 ? ms : DEFAULT_JOB_TIMEOUT_MS;
}

export function shouldEmitProgress(
  last: ProgressEvent | null,
  lastAt: number,
  next: ProgressEvent,
  now: number,
): boolean {
  if (!last || last.stage !== next.stage) return true;
  if (next.stage === 'downloading' && next.percent >= 100) return true;
  return now - lastAt >= PROGRESS_INTERVAL_MS;
}

export function parseJobTitleLine(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(TITLE_PRINT_PREFIX)) return undefined;
  const raw = trimmed.slice(TITLE_PRINT_PREFIX.length).trim();
  if (!raw || raw === 'NA') return undefined;
  let value = raw;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'string') return undefined;
    value = parsed;
  } catch {
    return undefined;
  }
  const title = value.trim();
  return title && title !== 'NA' ? title : undefined;
}

// yt-dlp's --force-keyframes-at-cuts omits `-c copy`, which makes ffmpeg fall
// back to its container default encoder (very slow libvpx-vp9 on WebM). Force
// fast H.264/AAC encoding matching the local trim profiles instead.
function sectionClipArgs(request: JobRequest): string[] {
  const base = [
    '--download-sections',
    `*${request.clip!.start}-${request.clip!.end}`,
    // Cut on the requested frames instead of the nearest keyframes.
    '--force-keyframes-at-cuts',
  ];
  if (request.format === 'original') {
    return [
      ...base,
      '--merge-output-format',
      'mkv',
      '--downloader-args',
      'ffmpeg_o:-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 18 -c:a aac -b:a 256k',
    ];
  }
  if (request.format === 'mp4') {
    return [
      ...base,
      '--downloader-args',
      'ffmpeg_o:-c:v libx264 -pix_fmt yuv420p -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart',
    ];
  }
  return base;
}

export function buildYtDlpArgs(
  request: JobRequest,
  dir: string,
  options: { sections?: boolean; fast?: boolean } = {},
): string[] {
  const section = options.sections && request.clip ? sectionClipArgs(request) : [];
  return [
    '--ignore-config',
    ...youtubeExtractorArgs(request.url, { fast: options.fast }),
    ...formatArgs(request),
    ...section,
    ...(isTwitterUrl(request.url) ? TWITTER_CONCURRENT_FRAGMENT_ARGS : []),
    ...(isYouTubeUrl(request.url) ? YOUTUBE_DOWNLOAD_ARGS : []),
    ...(isSoundCloudUrl(request.url) ? ['--embed-thumbnail'] : []),
    '--no-playlist',
    '--no-simulate',
    '--print',
    `before_dl:${TITLE_PRINT_PREFIX}%(title)j`,
    '--no-quiet',
    '--progress',
    '--newline',
    '-o',
    join(dir, `${playlistFilenamePrefix(request)}%(title)s.%(ext)s`),
    '--',
    request.url,
  ];
}

function playlistFilenamePrefix(request: JobRequest): string {
  if (!request.playlist) return '';
  const width = Math.max(2, String(request.playlist.count).length);
  return `${String(request.playlist.index).padStart(width, '0')} - `;
}

// A stream copy can only start on a keyframe. Reads ffprobe's
// `pts_time,flags` CSV for packets around the clip start.
export const KEYFRAME_TOLERANCE_SECONDS = 0.05;

export function buildKeyframeProbeArgs(inputPath: string, start: number): string[] {
  return [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'packet=pts_time,flags',
    '-of',
    'csv=p=0',
    '-read_intervals',
    `${start}%+0.5`,
    '--',
    inputPath,
  ];
}

// ffmpeg `-ss <start> -c copy` always seeks backward to a keyframe at or before
// `start`, so only keyframes at/before `start` (within tolerance) can copy cleanly.
export function hasKeyframeNearStart(
  probeOutput: string,
  start: number,
  tolerance = KEYFRAME_TOLERANCE_SECONDS,
): boolean {
  return probeOutput.split('\n').some((line) => {
    const [pts, flags] = line.trim().split(',');
    if (!flags?.startsWith('K')) return false;
    const time = Number(pts);
    return Number.isFinite(time) && time <= start + 0.001 && start - time <= tolerance;
  });
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
    '-pix_fmt',
    'yuv420p',
    '-preset',
    'veryfast',
    '-crf',
    format === 'original' ? '18' : '23',
    '-c:a',
    'aac',
    '-b:a',
    format === 'original' ? '256k' : '160k',
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
  stopJob(job, 'canceled', 'job canceled');
  return 'canceled';
}

function stopJob(job: Job, status: 'canceled' | 'error', message: string): void {
  job.status = status;
  job.error = message;
  job.completedAt = Date.now();
  clearTimeout(job.deadline);
  if (status === 'canceled') job.events.emit('canceled');
  else job.events.emit('failed', message);

  const child = job.child;
  if (!isChildAlive(child)) {
    removeJobDir(job);
    return;
  }

  let forceKill: NodeJS.Timeout | undefined;
  child.once('close', () => {
    if (forceKill) clearTimeout(forceKill);
    removeJobDir(job);
  });
  if (!signalProcessTree(child, 'SIGTERM')) {
    removeJobDir(job);
    return;
  }
  forceKill = setTimeout(() => {
    if (isChildAlive(child)) signalProcessTree(child, 'SIGKILL');
  }, 5000);
  forceKill.unref();
}

// Stops every running job, waits for children to exit (or timeoutMs), and
// removes job temp directories so a shutting-down server leaves nothing behind.
export async function stopAllJobs(timeoutMs = 6000): Promise<void> {
  const exits: Promise<void>[] = [];
  const dirs: string[] = [];
  for (const job of jobs.values()) {
    dirs.push(job.dir);
    const child = job.child;
    if (job.status === 'running') {
      if (isChildAlive(child)) exits.push(waitForExit(child));
      stopJob(job, 'canceled', 'server shutting down');
    } else if (isChildAlive(child)) {
      exits.push(waitForExit(child));
      signalProcessTree(child, 'SIGKILL');
    }
  }
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  await Promise.race([Promise.all(exits), timeout]);
  clearTimeout(timer);
  await Promise.allSettled(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
}

function waitForExit(child: NonNullable<Job['child']>): Promise<void> {
  return new Promise((resolve) => {
    if (!isChildAlive(child)) {
      resolve();
      return;
    }
    child.once('close', () => resolve());
  });
}

function activeJobCount(): number {
  let count = startingJobs;
  for (const job of jobs.values()) {
    if (job.status === 'running' || isChildAlive(job.child)) count += 1;
  }
  return count;
}

function isChildAlive(child: Job['child']): child is NonNullable<Job['child']> {
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
    await waitForStartupSweep();
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
  job.deadline = setTimeout(() => {
    if (job.status !== 'running') return;
    const minutes = Math.round(JOB_TIMEOUT_MS / 60_000);
    stopJob(job, 'error', `download timed out after ${minutes} minutes`);
  }, JOB_TIMEOUT_MS);
  job.deadline.unref();

  const useSections = sectionDownloads && Boolean(request.clip);
  if (request.clip) job.clipMode = useSections ? 'section' : 'full';
  spawnDownload(job, request, dir, useSections, true);

  return job;
}

function spawnDownload(
  job: Job,
  request: JobRequest,
  dir: string,
  useSections: boolean,
  fastYouTube: boolean,
): void {
  const args = buildYtDlpArgs(request, dir, { sections: useSections, fast: fastYouTube });
  let child: ChildProcessByStdio<null, Readable, Readable>;
  try {
    child = spawn('yt-dlp', args, {
      detached: DETACH_CHILD_PROCESS,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    failJob(job, `failed to start yt-dlp: ${(err as Error).message}`);
    return;
  }
  job.child = child;

  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-4000);
  });

  let pending = '';
  let lastEmitted: ProgressEvent | null = null;
  let lastEmittedAt = 0;
  const trackProgress = createProgressTracker();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    if (job.status !== 'running') return;
    for (const line of lines) {
      if (!job.title) {
        const title = parseJobTitleLine(line);
        if (title) {
          job.title = title;
          job.events.emit('meta', { title });
          continue;
        }
      }
      const progress = trackProgress(line);
      if (!progress) continue;
      job.lastProgress = progress;
      const now = Date.now();
      if (shouldEmitProgress(lastEmitted, lastEmittedAt, progress, now)) {
        lastEmitted = progress;
        lastEmittedAt = now;
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
      if (fastYouTube && isYouTubeUrl(request.url)) {
        // Drop partial streams from the failed attempt so findDownloadedFile
        // cannot pick a leftover video-only .fNNN file.
        await emptyDir(dir).catch(() => {});
        if (job.status !== 'running') return;
        spawnDownload(job, request, dir, useSections, false);
        return;
      }
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
      job.filePath = request.clip && !useSections
        ? await trimDownloadedFile(job, filePath, request.clip, request.format)
        : filePath;
      if (job.status !== 'running') return;
      job.status = 'done';
      job.completedAt = Date.now();
      clearTimeout(job.deadline);
      job.events.emit('done');
    } catch (err) {
      if (job.status !== 'running') return;
      failJob(job, `could not prepare output: ${(err as Error).message}`);
    }
  });
}

async function emptyDir(dir: string): Promise<void> {
  const entries = await readdir(dir);
  await Promise.all(entries.map((name) => rm(join(dir, name), { recursive: true, force: true })));
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
  emitProgress(job, { stage: 'processing' });
  let outputPath = clipOutputPath(inputPath, format);

  const accurateCopy = await canCopyClipAccurately(job, inputPath, clip, format);
  if (job.status !== 'running') return outputPath;

  const copyError = accurateCopy
    ? await runFfmpeg(job, buildFfmpegCopyClipArgs(inputPath, outputPath, clip, format))
    : 'clip start is not on a keyframe';
  if (job.status !== 'running') return outputPath;

  if (copyError) {
    const reencodePath = clipOutputPath(inputPath, format, { reencode: true });
    if (reencodePath !== outputPath) {
      await rm(outputPath, { force: true });
      outputPath = reencodePath;
      if (job.status !== 'running') return outputPath;
    }
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

// Audio-only output copies packet by packet, so it is already accurate. For
// video, copy only when a keyframe sits at the clip start; otherwise ffmpeg
// would snap back to the previous keyframe and the clip would start early.
async function canCopyClipAccurately(
  job: Job,
  inputPath: string,
  clip: Clip,
  format: JobRequest['format'],
): Promise<boolean> {
  if (format === 'mp3' || format === 'audio' || clip.start === 0) return true;
  const lines: string[] = [];
  const error = await runJobProcess(
    job,
    'ffprobe',
    buildKeyframeProbeArgs(inputPath, clip.start),
    (line) => lines.push(line),
  );
  if (error) return false;
  return hasKeyframeNearStart(lines.join('\n'), clip.start);
}

function emitProgress(job: Job, progress: ProgressEvent): void {
  job.lastProgress = progress;
  job.events.emit('progress', progress);
}

function runFfmpeg(
  job: Job,
  args: string[],
  onStdoutLine?: (line: string) => void,
): Promise<string | null> {
  return runJobProcess(job, 'ffmpeg', args, onStdoutLine);
}

// Spawns a job-owned child (ffmpeg or ffprobe) as job.child so cancel and
// timeout can kill its process tree.
function runJobProcess(
  job: Job,
  command: 'ffmpeg' | 'ffprobe',
  args: string[],
  onStdoutLine?: (line: string) => void,
): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(command, args, {
        detached: DETACH_CHILD_PROCESS,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      resolve(`failed to start ${command}: ${(err as Error).message}`);
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

    let pending = '';
    child.stdout.on('data', (chunk: Buffer) => {
      if (!onStdoutLine) return;
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) onStdoutLine(line);
    });

    child.on('error', (err) => {
      settle(`failed to start ${command}: ${err.message}`);
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

export async function startCompressJob(
  body: ReadableStream<Uint8Array>,
  originalName: string,
  maxBytes = MAX_UPLOAD_BYTES,
  options: CompressOptions = DEFAULT_COMPRESS_OPTIONS,
): Promise<Job> {
  if (isAtJobLimit(activeJobCount())) {
    throw new JobLimitError();
  }

  startingJobs += 1;
  let dir: string;
  try {
    await waitForStartupSweep();
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

  const uploadAbort = new AbortController();
  const uploadTimer = setTimeout(() => uploadAbort.abort(), JOB_TIMEOUT_MS);
  uploadTimer.unref();

  const inputPath = join(dir, uploadFileName(originalName));
  try {
    await saveUpload(body, inputPath, maxBytes, uploadAbort.signal);
  } catch (err) {
    jobs.delete(job.id);
    await rm(dir, { recursive: true, force: true });
    throw err instanceof UploadError ? err : new UploadError('aborted');
  } finally {
    clearTimeout(uploadTimer);
  }

  job.deadline = setTimeout(() => {
    if (job.status !== 'running') return;
    const minutes = Math.round(JOB_TIMEOUT_MS / 60_000);
    stopJob(job, 'error', `compression timed out after ${minutes} minutes`);
  }, JOB_TIMEOUT_MS);
  job.deadline.unref();

  void runCompress(job, inputPath, originalName, options);
  return job;
}

async function saveUpload(
  body: ReadableStream<Uint8Array>,
  inputPath: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<void> {
  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) {
        callback(new UploadError('too_large'));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>),
    counter,
    createWriteStream(inputPath),
    signal ? { signal } : {},
  );
  if (received === 0) throw new UploadError('empty');
}

async function runCompress(
  job: Job,
  inputPath: string,
  originalName: string,
  options: CompressOptions,
): Promise<void> {
  try {
    const info = await probeMedia(inputPath, (child) => {
      job.child = child;
    });
    if (job.status !== 'running') return;

    emitProgress(job, { stage: 'compressing', percent: null });
    const outputPath = join(job.dir, compressedFileName(originalName, info.kind));
    const ffmpegError = await runFfmpeg(
      job,
      buildFfmpegCompressArgs(inputPath, outputPath, info.kind, options),
      (line) => {
        const percent = parseFfmpegProgressLine(line, info.durationSeconds);
        if (percent !== null && job.status === 'running') {
          emitProgress(job, { stage: 'compressing', percent });
        }
      },
    );
    if (job.status !== 'running') return;
    if (ffmpegError) throw new Error(ffmpegError);

    const [input, output] = await Promise.all([stat(inputPath), stat(outputPath)]);
    if (output.size >= input.size) {
      throw new Error('compressed file was not smaller; try balanced, smaller, or h.265');
    }
    await rm(inputPath, { force: true });
    if (job.status !== 'running') return;

    job.filePath = outputPath;
    job.status = 'done';
    job.completedAt = Date.now();
    clearTimeout(job.deadline);
    job.events.emit('done');
  } catch (err) {
    if (job.status !== 'running') return;
    failJob(job, err instanceof Error ? err.message : String(err));
  }
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
  clearTimeout(job.deadline);
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
    return `ffmpeg crashed (signal ${Math.abs(code)})`;
  }
  if (signal) {
    return `ffmpeg crashed (${signal})`;
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
