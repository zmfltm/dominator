import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { parse } from 'node:path';
import type { Readable } from 'node:stream';
import { DETACH_CHILD_PROCESS } from './process';

export type MediaKind = 'video' | 'audio';

export interface MediaInfo {
  kind: MediaKind;
  durationSeconds: number | null;
}

export type CompressChild = ChildProcessByStdio<null, Readable, Readable>;

export const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;

const MAX_NAME_LENGTH = 120;

export class UnsupportedMediaError extends Error {
  constructor() {
    super('unsupported file; choose a video or audio file');
    this.name = 'UnsupportedMediaError';
  }
}

// Shorter side capped at 1080, never upscaled, both dimensions kept even for yuv420p.
const VIDEO_SCALE_FILTER =
  "scale=w='if(gt(iw,ih),-2,trunc(min(1080,iw)/2)*2)':h='if(gt(iw,ih),trunc(min(1080,ih)/2)*2,-2)'";

const COMPRESS_PROFILES: Record<MediaKind, { extension: string; outputArgs: string[] }> = {
  video: {
    extension: 'mp4',
    outputArgs: [
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-sn',
      '-dn',
      '-vf', VIDEO_SCALE_FILTER,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '28',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
    ],
  },
  audio: {
    extension: 'mp3',
    outputArgs: ['-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', '5'],
  },
};

export function buildFfmpegCompressArgs(
  inputPath: string,
  outputPath: string,
  kind: MediaKind,
): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostats',
    '-progress', 'pipe:1',
    '-y',
    '-i', inputPath,
    ...COMPRESS_PROFILES[kind].outputArgs,
    outputPath,
  ];
}

export function parseFfmpegProgressLine(
  line: string,
  durationSeconds: number | null,
): number | null {
  const match = /^out_time_us=(\d+)$/.exec(line.trim());
  if (!match || !durationSeconds || durationSeconds <= 0) return null;
  const percent = (Number(match[1]) / 1e6 / durationSeconds) * 100;
  return Math.min(100, Math.max(0, percent));
}

function baseName(originalName: string): string {
  const leaf = originalName.split(/[\\/]/).pop() ?? '';
  const cleaned = leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return parse(cleaned).name.replace(/^\.+/, '').slice(0, MAX_NAME_LENGTH).trim() || 'file';
}

export function compressedFileName(originalName: string, kind: MediaKind): string {
  return `${baseName(originalName)}.compressed.${COMPRESS_PROFILES[kind].extension}`;
}

export function uploadFileName(originalName: string): string {
  const extension = parse(originalName.split(/[\\/]/).pop() ?? '').ext.toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(extension) ? `input${extension}` : 'input';
}

interface ProbeOutput {
  streams?: { codec_type?: unknown; disposition?: { attached_pic?: unknown } }[];
  format?: { duration?: unknown };
}

export function classifyProbe(output: unknown): MediaInfo {
  const { streams = [], format } = (output ?? {}) as ProbeOutput;
  const hasVideo = streams.some(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  const hasAudio = streams.some((stream) => stream.codec_type === 'audio');
  if (!hasVideo && !hasAudio) throw new UnsupportedMediaError();

  const duration = Number(format?.duration);
  return {
    kind: hasVideo ? 'video' : 'audio',
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}

export function probeMedia(
  path: string,
  onSpawn?: (child: CompressChild) => void,
): Promise<MediaInfo> {
  return new Promise((resolve, reject) => {
    const child: CompressChild = spawn(
      'ffprobe',
      [
        '-v', 'error',
        '-show_entries',
        'stream=codec_type:stream_disposition=attached_pic:format=duration',
        '-of', 'json',
        path,
      ],
      { detached: DETACH_CHILD_PROCESS, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    onSpawn?.(child);

    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.resume();
    child.on('error', (err) => reject(new Error(`failed to start ffprobe: ${err.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new UnsupportedMediaError());
        return;
      }
      try {
        resolve(classifyProbe(JSON.parse(stdout)));
      } catch (err) {
        reject(err instanceof UnsupportedMediaError ? err : new UnsupportedMediaError());
      }
    });
  });
}
