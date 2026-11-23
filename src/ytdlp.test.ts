import { describe, expect, it } from 'vitest';
import { youtubeJsRuntimeArgs } from './ytdlp';

describe('youtubeJsRuntimeArgs', () => {
  it('enables the current Node runtime and fast player clients for YouTube extraction', () => {
    expect(youtubeJsRuntimeArgs('https://youtu.be/dQw4w9WgXcQ')).toEqual([
      '--js-runtimes',
      `node:${process.execPath}`,
      '--extractor-args',
      'youtube:player_client=visionos,web',
    ]);
  });

  it('does not add YouTube options to other sites', () => {
    expect(youtubeJsRuntimeArgs('https://soundcloud.com/artist/track')).toEqual([]);
  });
});
