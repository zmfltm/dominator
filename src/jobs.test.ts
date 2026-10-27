import { describe, expect, it } from 'vitest';
import {
  buildFfmpegCopyClipArgs,
  buildFfmpegReencodeClipArgs,
  buildYtDlpArgs,
  clipOutputPath,
  CONCURRENT_FRAGMENTS,
  DEFAULT_JOB_TIMEOUT_MS,
  formatClipTimestamp,
  isAtJobLimit,
  isOwnedTempDirName,
  isStale,
  MAX_RUNNING_JOBS,
  parseJobTimeoutMs,
  PROGRESS_INTERVAL_MS,
  shouldEmitProgress,
} from './jobs';

describe('parseJobTimeoutMs', () => {
  it('defaults when unset or invalid', () => {
    expect(parseJobTimeoutMs(undefined)).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(parseJobTimeoutMs('')).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(parseJobTimeoutMs('soon')).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(parseJobTimeoutMs('0')).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(parseJobTimeoutMs('-5')).toBe(DEFAULT_JOB_TIMEOUT_MS);
  });

  it('accepts a positive millisecond count', () => {
    expect(parseJobTimeoutMs('600000')).toBe(600_000);
  });
});

describe('shouldEmitProgress', () => {
  const downloading = (percent: number) => ({ stage: 'downloading' as const, percent });

  it('always emits the first update and stage changes', () => {
    expect(shouldEmitProgress(null, 0, downloading(1), 0)).toBe(true);
    expect(shouldEmitProgress(downloading(50), 100, { stage: 'processing' }, 101)).toBe(true);
  });

  it('coalesces updates inside the interval', () => {
    expect(shouldEmitProgress(downloading(10), 1000, downloading(11), 1000 + PROGRESS_INTERVAL_MS - 1)).toBe(false);
    expect(shouldEmitProgress(downloading(10), 1000, downloading(11), 1000 + PROGRESS_INTERVAL_MS)).toBe(true);
  });

  it('never drops a finished download', () => {
    expect(shouldEmitProgress(downloading(99), 1000, downloading(100), 1001)).toBe(true);
  });
});

describe('isStale', () => {
  const now = 1_000_000;
  const ttl = 1000;

  it('never reaps a running job, however old', () => {
    expect(isStale({ status: 'running', completedAt: undefined }, ttl, now)).toBe(false);
  });

  it('never reaps a terminal job that has no completion time', () => {
    expect(isStale({ status: 'done', completedAt: undefined }, ttl, now)).toBe(false);
  });

  it('keeps a freshly completed job within its ttl so the file stays downloadable', () => {
    expect(isStale({ status: 'done', completedAt: now - 500 }, ttl, now)).toBe(false);
  });

  it('reaps a completed-but-uncollected job once past its ttl', () => {
    expect(isStale({ status: 'done', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });

  it('reaps an errored job past its ttl so its map entry is freed', () => {
    expect(isStale({ status: 'error', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });

  it('reaps a canceled job past its ttl so its map entry is freed', () => {
    expect(isStale({ status: 'canceled', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });
});

describe('isOwnedTempDirName', () => {
  it('only matches app-created download and preview directory names', () => {
    expect(isOwnedTempDirName('dominator-aB123z')).toBe(true);
    expect(isOwnedTempDirName('dominator-preview-aB123z')).toBe(true);
    expect(isOwnedTempDirName('dominator-notes')).toBe(false);
    expect(isOwnedTempDirName('dominator-aB123z-extra')).toBe(false);
  });
});

describe('isAtJobLimit', () => {
  it('allows work below the running job limit', () => {
    expect(isAtJobLimit(MAX_RUNNING_JOBS - 1)).toBe(false);
  });

  it('blocks work at the running job limit', () => {
    expect(isAtJobLimit(MAX_RUNNING_JOBS)).toBe(true);
  });
});

describe('clip args', () => {
  it('formats timestamps for ffmpeg clip arguments', () => {
    expect(formatClipTimestamp(80)).toBe('00:01:20');
    expect(formatClipTimestamp(3661.25)).toBe('01:01:01.25');
  });

  it('downloads the full file before local clipping', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const args = buildYtDlpArgs(
      { url, format: 'mp4', clip: { start: 80, end: 105 } },
      '/tmp/dominator-test',
    );

    expect(args).toContain('--ignore-config');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain(`node:${process.execPath}`);
    expect(args).not.toContain('--download-sections');
    expect(args[args.indexOf('--concurrent-fragments') + 1]).toBe(String(CONCURRENT_FRAGMENTS));
    expect(args).toContain('/tmp/dominator-test/%(title)s.%(ext)s');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });

  it('converts signed Discord attachments to MP3 and preserves the signature', () => {
    const url = 'https://cdn.discordapp.com/attachments/123/456/voice-message.ogg?ex=abc&is=def&hm=signature';
    const args = buildYtDlpArgs({ url, format: 'mp3' }, '/tmp/dominator-test');
    expect(args).toContain('-x');
    expect(args[args.indexOf('--audio-format') + 1]).toBe('mp3');
    expect(args[args.indexOf('--audio-quality') + 1]).toBe('0');
    expect(args.slice(-2)).toEqual(['--', url]);
  });

  it('keeps SoundCloud audio in the best source format and prefixes playlist order', () => {
    const url = 'https://soundcloud.com/artist/track';
    const args = buildYtDlpArgs(
      { url, format: 'audio', playlist: { index: 3, count: 12 } },
      '/tmp/dominator-test',
    );

    expect(args).toContain('bestaudio/best');
    expect(args).not.toContain('--extract-audio');
    expect(args).toContain('--embed-thumbnail');
    expect(args).toContain('/tmp/dominator-test/03 - %(title)s.%(ext)s');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });

  it('does not embed thumbnails for non-SoundCloud downloads', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const args = buildYtDlpArgs({ url, format: 'mp4' }, '/tmp/dominator-test');

    expect(args).not.toContain('--embed-thumbnail');
  });

  it('builds stream-copy ffmpeg args for clipped MP4 output', () => {
    expect(
      buildFfmpegCopyClipArgs(
        '/tmp/dominator-test/source.mp4',
        '/tmp/dominator-test/source.clip.mp4',
        { start: 80, end: 105.5 },
        'mp4',
      ),
    ).toEqual([
      '-hide_banner',
      '-loglevel',
      'warning',
      '-y',
      '-ss',
      '00:01:20',
      '-i',
      '/tmp/dominator-test/source.mp4',
      '-t',
      '00:00:25.5',
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
      '/tmp/dominator-test/source.clip.mp4',
    ]);
  });

  it('builds re-encode ffmpeg args as a clipping fallback', () => {
    const args = buildFfmpegReencodeClipArgs(
      '/tmp/dominator-test/source.webm',
      '/tmp/dominator-test/source.clip.mp4',
      { start: 1, end: 3 },
      'mp4',
    );

    expect(args).toContain('libx264');
    expect(args).toContain('aac');
    expect(args.at(-1)).toBe('/tmp/dominator-test/source.clip.mp4');
  });

  it('uses the requested final extension for local clips', () => {
    expect(clipOutputPath('/tmp/dominator-test/source.webm', 'mp4')).toBe(
      '/tmp/dominator-test/source.clip.mp4',
    );
    expect(clipOutputPath('/tmp/dominator-test/source.webm', 'mp3')).toBe(
      '/tmp/dominator-test/source.clip.mp3',
    );
  });
});
