import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { parse } from 'node:path';
import type { Readable } from 'node:stream';
import { DETACH_CHILD_PROCESS } from './process';

export type MediaKind = 'video' | 'audio';
export type CompressQuality = 'same' | 'balanced' | 'small';
export type CompressResolution = 'original' | '1080p' | '720p';
export type CompressCodec = 'h264' | 'h265';

export interface CompressOptions {
  quality: CompressQuality;
  resolution: CompressResolution;
  codec: CompressCodec;
}

export const DEFAULT_COMPRESS_OPTIONS: CompressOptions = {
  quality: 'same',
  resolution: 'original',
  codec: 'h264',
};

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

export type ParseCompressOptionsResult =
  | { ok: true; value: CompressOptions }
  | { ok: false; error: string };

const VALID_QUALITIES = new Set<CompressQuality>(['same', 'balanced', 'small']);
const VALID_RESOLUTIONS = new Set<CompressResolution>(['original', '1080p', '720p']);
const VALID_CODECS = new Set<CompressCodec>(['h264', 'h265']);

export function parseCompressOptions(params: {
  quality?: string;
  resolution?: string;
  codec?: string;
}): ParseCompressOptionsResult {
  const quality = (params.quality?.trim() || DEFAULT_COMPRESS_OPTIONS.quality) as CompressQuality;
  if (!VALID_QUALITIES.has(quality)) {
    return { ok: false, error: "quality must be 'same', 'balanced', or 'small'" };
  }
  const resolution = (params.resolution?.trim() || DEFAULT_COMPRESS_OPTIONS.resolution) as CompressResolution;
  if (!VALID_RESOLUTIONS.has(resolution)) {
    return { ok: false, error: "resolution must be 'original', '1080p', or '720p'" };
  }
  const codec = (params.codec?.trim() || DEFAULT_COMPRESS_OPTIONS.codec) as CompressCodec;
  if (!VALID_CODECS.has(codec)) {
    return { ok: false, error: "codec must be 'h264' or 'h265'" };
  }
  return { ok: true, value: { quality, resolution, codec } };
}

function videoScaleFilter(resolution: CompressResolution): string {
  if (resolution === 'original') {
    // Keep original resolution while ensuring even dimensions for yuv420p.
    return "scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'";
  }
  const cap = resolution === '720p' ? 720 : 1080;
  // Shorter side capped, never upscaled, both dimensions kept even for yuv420p.
  return `scale=w='if(gt(iw,ih),-2,trunc(min(${cap},iw)/2)*2)':h='if(gt(iw,ih),trunc(min(${cap},ih)/2)*2,-2)'`;
}

const H264_CRF: Record<CompressQuality, string> = {
  same: '20',
  balanced: '24',
  small: '28',
};

const H265_CRF: Record<CompressQuality, string> = {
  same: '23',
  balanced: '26',
  small: '30',
};

const VIDEO_AUDIO_BITRATE: Record<CompressQuality, string> = {
  same: '192k',
  balanced: '160k',
  small: '128k',
};

const AUDIO_MP3_QUALITY: Record<CompressQuality, string> = {
  same: '2',
  balanced: '4',
  small: '5',
};

const EXTENSION_BY_KIND: Record<MediaKind, string> = {
  video: 'mp4',
  audio: 'mp3',
};

function compressOutputArgs(kind: MediaKind, options: CompressOptions): string[] {
  if (kind === 'audio') {
    return ['-vn', '-map', '0:a:0', '-c:a', 'libmp3lame', '-q:a', AUDIO_MP3_QUALITY[options.quality]];
  }
  const videoCodecArgs = options.codec === 'h265'
    ? [
        '-c:v', 'libx265',
        '-preset', 'fast',
        '-crf', H265_CRF[options.quality],
        '-tag:v', 'hvc1',
      ]
    : [
        '-c:v', 'libx264',
        '-preset', options.quality === 'same' ? 'fast' : 'veryfast',
        '-crf', H264_CRF[options.quality],
      ];
  return [
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-sn',
    '-dn',
    '-vf', videoScaleFilter(options.resolution),
    ...videoCodecArgs,
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', VIDEO_AUDIO_BITRATE[options.quality],
    '-movflags', '+faststart',
  ];
}

export function buildFfmpegCompressArgs(
  inputPath: string,
  outputPath: string,
  kind: MediaKind,
  options: CompressOptions = DEFAULT_COMPRESS_OPTIONS,
): string[] {
  return [
    '-hide_banner',
    '-loglevel', 'warning',
    '-nostats',
    '-progress', 'pipe:1',
    '-y',
    '-i', inputPath,
    ...compressOutputArgs(kind, options),
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
  return `${baseName(originalName)}.compressed.${EXTENSION_BY_KIND[kind]}`;
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
