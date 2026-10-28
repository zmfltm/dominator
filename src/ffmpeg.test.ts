import { describe, expect, it } from 'vitest';
import { isCleanExit } from './ffmpeg';

describe('isCleanExit', () => {
  it('treats ordinary ffmpeg errors as a working network stack', () => {
    expect(isCleanExit(0, null)).toBe(true);
    expect(isCleanExit(1, null)).toBe(true);
  });

  it('treats crashes as unusable', () => {
    expect(isCleanExit(null, 'SIGSEGV')).toBe(false);
    expect(isCleanExit(139, null)).toBe(false);
  });
});
