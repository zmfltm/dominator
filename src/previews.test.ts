import { describe, expect, it } from 'vitest';
import {
  buildFilmstripFfmpegArgs,
  buildPreviewDurationArgs,
  buildPreviewYtDlpArgs,
  isPreviewStale,
  parsePreviewDuration,
  PREVIEW_FRAME_COUNT,
  PREVIEW_FRAME_HEIGHT,
  PREVIEW_FRAME_WIDTH,
} from './previews';

describe('preview args', () => {
  it('keeps preview URLs behind -- for yt-dlp downloads', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const args = buildPreviewYtDlpArgs(url, '/tmp/dominator-preview-test');

    expect(args).toContain('--ignore-config');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain(`node:${process.execPath}`);
    expect(args).toContain('--max-filesize');
    expect(args).toContain('/tmp/dominator-preview-test/source.%(ext)s');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });

  it('keeps preview URLs behind -- for duration lookups', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const args = buildPreviewDurationArgs(url);

    expect(args).toContain('--ignore-config');
    expect(args).toContain('--js-runtimes');
    expect(args).toContain(`node:${process.execPath}`);
    expect(args).toContain('--skip-download');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });

  it('builds a one-row ffmpeg filmstrip filter', () => {
    const args = buildFilmstripFfmpegArgs('/tmp/source.mp4', '/tmp/sprite.jpg', 120);
    const filter = args[args.indexOf('-vf') + 1];

    expect(filter).toContain(`scale=${PREVIEW_FRAME_WIDTH}:${PREVIEW_FRAME_HEIGHT}`);
    expect(filter).toContain(`tile=${PREVIEW_FRAME_COUNT}x1`);
    expect(args.at(-1)).toBe('/tmp/sprite.jpg');
  });

  it('samples long videos across their full duration', () => {
    const args = buildFilmstripFfmpegArgs('/tmp/source.mp4', '/tmp/sprite.jpg', 3600);
    const filter = args[args.indexOf('-vf') + 1];

    expect(filter).toContain('fps=0.001389');
  });
});

describe('parsePreviewDuration', () => {
  it('parses finite duration seconds', () => {
    expect(parsePreviewDuration('\n180.25\n')).toBe(180.25);
  });

  it('ignores missing or invalid durations', () => {
    expect(parsePreviewDuration('NA\n')).toBeUndefined();
    expect(parsePreviewDuration('-1\n')).toBeUndefined();
    expect(parsePreviewDuration('999999\n')).toBeUndefined();
  });
});

describe('isPreviewStale', () => {
  const now = 1_000_000;
  const ttl = 1000;

  it('keeps running previews', () => {
    expect(isPreviewStale({ status: 'running', completedAt: now - 2000 }, ttl, now)).toBe(false);
  });

  it('reaps old completed previews', () => {
    expect(isPreviewStale({ status: 'done', completedAt: now - 2000 }, ttl, now)).toBe(true);
  });
});
