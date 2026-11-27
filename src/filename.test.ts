import { describe, expect, it } from 'vitest';
import { fitFileName, truncateUtf8 } from './filename';

describe('truncateUtf8', () => {
  it('leaves short values alone', () => {
    expect(truncateUtf8('abc', 10)).toBe('abc');
  });

  it('never splits a code point', () => {
    expect(truncateUtf8('한한한', 7)).toBe('한한');
    expect(truncateUtf8('a😀b', 4)).toBe('a');
  });
});

describe('fitFileName', () => {
  it('keeps the whole name within 255 bytes including the suffix', () => {
    const name = fitFileName('한'.repeat(81), '.compressed.mp4');
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(255);
    expect(name.endsWith('.compressed.mp4')).toBe(true);
  });

  it('does not change names that already fit', () => {
    expect(fitFileName('song', '.clip.mp3')).toBe('song.clip.mp3');
  });
});
