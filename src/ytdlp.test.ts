import { describe, expect, it } from 'vitest';
import { youtubeExtractorArgs } from './ytdlp';

describe('youtubeExtractorArgs', () => {
  it('enables the current Node runtime and fast player clients for YouTube extraction', () => {
    expect(youtubeExtractorArgs('https://youtu.be/dQw4w9WgXcQ')).toEqual([
      '--js-runtimes',
      `node:${process.execPath}`,
      '--extractor-args',
      'youtube:player_client=visionos,web',
    ]);
  });

  it('supports falling back to upstream YouTube player clients', () => {
    expect(youtubeExtractorArgs('https://youtu.be/dQw4w9WgXcQ', { fast: false })).toEqual([
      '--js-runtimes',
      `node:${process.execPath}`,
    ]);
  });

  it('does not add YouTube options to other sites', () => {
    expect(youtubeExtractorArgs('https://soundcloud.com/artist/track')).toEqual([]);
  });
});
