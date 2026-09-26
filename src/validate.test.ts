import { describe, expect, it } from 'vitest';
import { parseJobRequest } from './validate';

describe('parseJobRequest', () => {
  it('accepts a standard watch URL with mp4', () => {
    const result = parseJobRequest({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      format: 'mp4',
    });
    expect(result).toEqual({
      ok: true,
      value: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', format: 'mp4' },
    });
  });

  it('accepts youtu.be short links with mp3', () => {
    const result = parseJobRequest({
      url: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
      format: 'mp3',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts music.youtube.com and m.youtube.com', () => {
    expect(
      parseJobRequest({ url: 'https://music.youtube.com/watch?v=x', format: 'mp3' }).ok,
    ).toBe(true);
    expect(
      parseJobRequest({ url: 'https://m.youtube.com/watch?v=x', format: 'mp4' }).ok,
    ).toBe(true);
  });

  it('accepts Twitter/X URLs', () => {
    const result1 = parseJobRequest({
      url: 'https://twitter.com/user/status/123',
      format: 'mp4',
    });
    expect(result1).toEqual({
      ok: true,
      value: { url: 'https://twitter.com/user/status/123', format: 'mp4' },
    });

    const result2 = parseJobRequest({
      url: 'https://x.com/user/status/123',
      format: 'mp4',
    });
    expect(result2.ok).toBe(true);
  });

  it('accepts Instagram URLs', () => {
    const result = parseJobRequest({
      url: 'https://www.instagram.com/reel/abc123/',
      format: 'mp4',
    });
    expect(result).toEqual({
      ok: true,
      value: { url: 'https://www.instagram.com/reel/abc123/', format: 'mp4' },
    });
  });

  it('accepts TikTok URLs', () => {
    const result1 = parseJobRequest({
      url: 'https://www.tiktok.com/@user/video/123',
      format: 'mp4',
    });
    expect(result1.ok).toBe(true);

    const result2 = parseJobRequest({
      url: 'https://vm.tiktok.com/ZMabcdef/',
      format: 'mp3',
    });
    expect(result2.ok).toBe(true);
  });

  it('accepts Reddit URLs', () => {
    const result1 = parseJobRequest({
      url: 'https://www.reddit.com/r/videos/comments/abc123/example/',
      format: 'mp4',
    });
    expect(result1.ok).toBe(true);

    const result2 = parseJobRequest({
      url: 'https://redd.it/abc123',
      format: 'mp3',
    });
    expect(result2.ok).toBe(true);

    const result3 = parseJobRequest({
      url: 'https://v.redd.it/abc123/DASH_720.mp4',
      format: 'mp4',
    });
    expect(result3.ok).toBe(true);
  });

  it('accepts SoundCloud tracks and playlist positions with best audio', () => {
    expect(parseJobRequest({
      url: 'https://soundcloud.com/artist/track',
      format: 'audio',
    })).toEqual({
      ok: true,
      value: { url: 'https://soundcloud.com/artist/track', format: 'audio' },
    });

    expect(parseJobRequest({
      url: 'https://www.soundcloud.com/artist/track',
      format: 'audio',
      playlist: { index: 3, count: 12 },
    })).toEqual({
      ok: true,
      value: {
        url: 'https://www.soundcloud.com/artist/track',
        format: 'audio',
        playlist: { index: 3, count: 12 },
      },
    });

    expect(parseJobRequest({
      url: 'https://on.soundcloud.com/short-link',
      format: 'audio',
    }).ok).toBe(true);

    expect(parseJobRequest({
      url: 'https://api-v2.soundcloud.com/tracks/123',
      format: 'audio',
    }).ok).toBe(true);
  });

  it.each(['cdn.discordapp.com', 'media.discordapp.net'])('accepts signed Discord audio from %s without changing the URL', (host) => {
    const url = `https://${host}/attachments/123/456/voice-message.ogg?ex=abcdef&is=123456&hm=signed`;
    expect(parseJobRequest({ url, format: 'mp3' })).toEqual({
      ok: true, value: { url, format: 'mp3' },
    });
  });

  it.each([
    'https://cdn.discordapp.com.evil.example/attachments/123/456/voice.ogg',
    'https://cdn.discordapp.com/avatars/123/voice.ogg',
    'https://cdn.discordapp.com/attachments/123/456/page.html',
    'http://cdn.discordapp.com/attachments/123/456/voice.ogg',
    'https://cdn.discordapp.com:8443/attachments/123/456/voice.ogg',
    'https://user:pass@cdn.discordapp.com/attachments/123/456/voice.ogg',
  ])('rejects unsafe or non-media Discord URL %s', (url) => {
    expect(parseJobRequest({ url, format: 'mp3' }).ok).toBe(false);
  });

  it('explains how to replace a Discord message link', () => {
    expect(parseJobRequest({
      url: 'https://discord.com/channels/352908185511788554/835522047874433074/1552815306844536882',
      format: 'mp3',
    })).toEqual({
      ok: false,
      error: 'Discord message links are not downloadable; copy the audio attachment link instead',
    });
  });

  it('accepts a valid clip range', () => {
    const result = parseJobRequest({
      url: 'https://youtu.be/dQw4w9WgXcQ',
      format: 'mp4',
      clip: { start: 80, end: 105.5 },
    });
    expect(result).toEqual({
      ok: true,
      value: {
        url: 'https://youtu.be/dQw4w9WgXcQ',
        format: 'mp4',
        clip: { start: 80, end: 105.5 },
      },
    });
  });

  it('rejects invalid clip ranges', () => {
    expect(
      parseJobRequest({ url: 'https://youtu.be/x', format: 'mp4', clip: { start: 10 } }).ok,
    ).toBe(false);
    expect(
      parseJobRequest({ url: 'https://youtu.be/x', format: 'mp4', clip: { start: 10, end: 10 } }),
    ).toEqual({ ok: false, error: 'clip end must be after start' });
    expect(
      parseJobRequest({ url: 'https://youtu.be/x', format: 'mp4', clip: { start: -1, end: 10 } }),
    ).toEqual({ ok: false, error: 'clip times must be between 0 and 24 hours' });
  });

  it('rejects unsupported hosts', () => {
    const result = parseJobRequest({ url: 'https://vimeo.com/12345', format: 'mp4' });
    expect(result).toEqual({
      ok: false,
      error: 'only YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachment URLs are supported',
    });
  });

  it('rejects lookalike hosts', () => {
    const result1 = parseJobRequest({
      url: 'https://youtube.com.evil.example/watch?v=x',
      format: 'mp4',
    });
    expect(result1.ok).toBe(false);

    const result2 = parseJobRequest({
      url: 'https://tiktok.com.evil.example/v',
      format: 'mp4',
    });
    expect(result2.ok).toBe(false);

    const result3 = parseJobRequest({
      url: 'https://reddit.com.evil.example/r/videos',
      format: 'mp4',
    });
    expect(result3.ok).toBe(false);

    const result4 = parseJobRequest({
      url: 'https://soundcloud.com.evil.example/artist/track',
      format: 'audio',
    });
    expect(result4.ok).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    const result = parseJobRequest({ url: 'file:///etc/passwd', format: 'mp4' });
    expect(result.ok).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    const result = parseJobRequest({ url: 'not a url', format: 'mp4' });
    expect(result).toEqual({ ok: false, error: 'not a valid URL' });
  });

  it('rejects best audio for non-SoundCloud URLs and invalid playlist positions', () => {
    expect(parseJobRequest({ url: 'https://youtu.be/x', format: 'audio' })).toEqual({
      ok: false,
      error: 'best audio is only supported for SoundCloud URLs',
    });
    expect(parseJobRequest({
      url: 'https://soundcloud.com/artist/track',
      format: 'audio',
      playlist: { index: 13, count: 12 },
    })).toEqual({
      ok: false,
      error: 'playlist index and count must be valid integers up to 500',
    });
  });

  it('rejects clips for best-quality SoundCloud audio', () => {
    expect(parseJobRequest({
      url: 'https://soundcloud.com/artist/track',
      format: 'audio',
      clip: { start: 1, end: 2 },
    })).toEqual({
      ok: false,
      error: 'best-quality SoundCloud audio does not support clips',
    });
  });

  it('rejects unknown formats', () => {
    const result = parseJobRequest({ url: 'https://youtu.be/x', format: 'wav' });
    expect(result).toEqual({ ok: false, error: "format must be 'mp4', 'mp3', or 'audio'" });
  });

  it('rejects non-object bodies', () => {
    expect(parseJobRequest(null).ok).toBe(false);
    expect(parseJobRequest('hi').ok).toBe(false);
    expect(parseJobRequest(undefined).ok).toBe(false);
  });
});
