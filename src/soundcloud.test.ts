import { describe, expect, it } from 'vitest';
import {
  buildSoundCloudYtDlpArgs,
  MAX_SOUNDCLOUD_TRACKS,
  parseSoundCloudOutput,
} from './soundcloud';

describe('parseSoundCloudOutput', () => {
  it('preserves playlist order and public track URLs', () => {
    const output = JSON.stringify({
      title: 'Example set',
      entries: [
        { url: 'https://soundcloud.com/artist/first-track', title: 'First track' },
        { url: 'https://soundcloud.com/artist/second-track' },
      ],
    });

    expect(parseSoundCloudOutput(output, 'https://soundcloud.com/artist/sets/example')).toEqual({
      title: 'Example set',
      tracks: [
        { url: 'https://soundcloud.com/artist/first-track', title: 'First track' },
        { url: 'https://soundcloud.com/artist/second-track' },
      ],
    });
  });

  it('returns a single direct track', () => {
    const url = 'https://soundcloud.com/artist/one-track';
    const output = JSON.stringify({ title: 'One track', webpage_url: url });

    expect(parseSoundCloudOutput(output, url)).toEqual({
      title: 'One track',
      tracks: [{ url, title: 'One track' }],
    });
  });

  it('rejects non-object extractor output', () => {
    expect(() => parseSoundCloudOutput(
      'null',
      'https://soundcloud.com/artist/track',
    )).toThrow('yt-dlp returned invalid SoundCloud data');
  });

  it('rejects extractor output containing non-SoundCloud track URLs', () => {
    const output = JSON.stringify({
      entries: [{ url: 'https://attacker.example/track' }],
    });

    expect(() => parseSoundCloudOutput(output, 'https://soundcloud.com/artist/sets/example'))
      .toThrow('SoundCloud returned an invalid track URL');
  });

  it('rejects playlists over the track limit', () => {
    const entries = Array.from({ length: MAX_SOUNDCLOUD_TRACKS + 1 }, (_, index) => ({
      url: `https://soundcloud.com/artist/track-${index}`,
    }));

    expect(() => parseSoundCloudOutput(
      JSON.stringify({ entries }),
      'https://soundcloud.com/artist/sets/large',
    )).toThrow(`SoundCloud playlists are limited to ${MAX_SOUNDCLOUD_TRACKS} tracks`);
  });
});

describe('buildSoundCloudYtDlpArgs', () => {
  it('extracts a bounded flat playlist and keeps the URL behind --', () => {
    const url = 'https://soundcloud.com/artist/sets/example';
    const args = buildSoundCloudYtDlpArgs(url);

    expect(args).toContain('--ignore-config');
    expect(args).toContain('--flat-playlist');
    expect(args).toContain('--dump-single-json');
    expect(args).toContain(String(MAX_SOUNDCLOUD_TRACKS + 1));
    expect(args.at(-2)).toBe('--');
    expect(args.at(-1)).toBe(url);
  });
});
