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

  it('rejects unsupported hosts', () => {
    const result = parseJobRequest({ url: 'https://vimeo.com/12345', format: 'mp4' });
    expect(result).toEqual({
      ok: false,
      error: 'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported',
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
  });

  it('rejects non-http(s) schemes', () => {
    const result = parseJobRequest({ url: 'file:///etc/passwd', format: 'mp4' });
    expect(result.ok).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    const result = parseJobRequest({ url: 'not a url', format: 'mp4' });
    expect(result).toEqual({ ok: false, error: 'not a valid URL' });
  });

  it('rejects unknown formats', () => {
    const result = parseJobRequest({ url: 'https://youtu.be/x', format: 'wav' });
    expect(result).toEqual({ ok: false, error: "format must be 'mp4' or 'mp3'" });
  });

  it('rejects non-object bodies', () => {
    expect(parseJobRequest(null).ok).toBe(false);
    expect(parseJobRequest('hi').ok).toBe(false);
    expect(parseJobRequest(undefined).ok).toBe(false);
  });
});
