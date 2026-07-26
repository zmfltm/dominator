import { describe, expect, it } from 'vitest';
import {
  buildMetadataYtDlpArgs,
  extractYtDlpError,
  firstNonEmptyLine,
  parseVideoMetadataOutput,
} from './metadata';

describe('firstNonEmptyLine', () => {
  it('returns the first title-looking line', () => {
    expect(firstNonEmptyLine('\n  Example Video  \nother')).toBe('Example Video');
  });

  it('returns undefined for blank output', () => {
    expect(firstNonEmptyLine('\n  \n')).toBeUndefined();
  });
});

describe('parseVideoMetadataOutput', () => {
  it('parses title, duration, clip section times, and thumbnail', () => {
    const output = JSON.stringify({
      title: 'Example Video',
      duration: 180.25,
      section_start: 30,
      section_end: 45.5,
      thumbnail: 'https://i.example/thumb.jpg',
    });
    expect(parseVideoMetadataOutput(output)).toEqual({
      title: 'Example Video',
      duration: 180.25,
      thumbnail: 'https://i.example/thumb.jpg',
      clip: { start: 30, end: 45.5 },
    });
  });

  it('keeps multiline titles framed inside JSON', () => {
    const output = JSON.stringify({
      title: 'First line\nSecond line',
      duration: null,
      section_start: 30,
      section_end: 45,
      thumbnail: null,
    });
    expect(parseVideoMetadataOutput(output)).toEqual({
      title: 'First line\nSecond line',
      clip: { start: 30, end: 45 },
    });
  });

  it('ignores missing optional duration, section, and thumbnail fields', () => {
    expect(parseVideoMetadataOutput('{"title":"Example Video"}')).toEqual({
      title: 'Example Video',
    });
  });

  it('ignores non-http thumbnail URLs', () => {
    const output = JSON.stringify({ title: 'Example Video', thumbnail: 'file:///tmp/thumb.jpg' });
    expect(parseVideoMetadataOutput(output)).toEqual({
      title: 'Example Video',
    });
  });

  it('rejects malformed output instead of shifting optional fields', () => {
    expect(parseVideoMetadataOutput('Example Video\n\n30\n45')).toBeUndefined();
  });
});

describe('buildMetadataYtDlpArgs', () => {
  it('ignores user config and keeps the URL behind --', () => {
    const url = 'https://youtu.be/dQw4w9WgXcQ';
    const args = buildMetadataYtDlpArgs(url);

    expect(args).toContain('--ignore-config');
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });
});

describe('extractYtDlpError', () => {
  it('returns the last yt-dlp error without the prefix', () => {
    const stderr = 'WARNING: retrying\nERROR: first\nERROR: final message';
    expect(extractYtDlpError(stderr)).toBe('final message');
  });
});
