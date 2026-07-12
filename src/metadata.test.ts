import { describe, expect, it } from 'vitest';
import { extractYtDlpError, firstNonEmptyLine, parseVideoMetadataOutput } from './metadata';

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
    expect(parseVideoMetadataOutput('Example Video\n180.25\n30\n45.5\nhttps://i.example/thumb.jpg\n')).toEqual({
      title: 'Example Video',
      duration: 180.25,
      thumbnail: 'https://i.example/thumb.jpg',
      clip: { start: 30, end: 45.5 },
    });
  });

  it('ignores missing optional duration, section, and thumbnail fields', () => {
    expect(parseVideoMetadataOutput('Example Video\nNA\nNA\nNA\nNA\n')).toEqual({
      title: 'Example Video',
    });
  });

  it('ignores non-http thumbnail URLs', () => {
    expect(parseVideoMetadataOutput('Example Video\nNA\nNA\nNA\nfile:///tmp/thumb.jpg\n')).toEqual({
      title: 'Example Video',
    });
  });
});

describe('extractYtDlpError', () => {
  it('returns the last yt-dlp error without the prefix', () => {
    const stderr = 'WARNING: retrying\nERROR: first\nERROR: final message';
    expect(extractYtDlpError(stderr)).toBe('final message');
  });
});
