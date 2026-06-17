import { describe, expect, it } from 'vitest';
import { extractYtDlpError, firstNonEmptyLine } from './metadata';

describe('firstNonEmptyLine', () => {
  it('returns the first title-looking line', () => {
    expect(firstNonEmptyLine('\n  Example Video  \nother')).toBe('Example Video');
  });

  it('returns undefined for blank output', () => {
    expect(firstNonEmptyLine('\n  \n')).toBeUndefined();
  });
});

describe('extractYtDlpError', () => {
  it('returns the last yt-dlp error without the prefix', () => {
    const stderr = 'WARNING: retrying\nERROR: first\nERROR: final message';
    expect(extractYtDlpError(stderr)).toBe('final message');
  });
});
