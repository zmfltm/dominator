const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'x.com',
  'www.x.com',
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);

export type Format = 'mp4' | 'mp3';

export interface JobRequest {
  url: string;
  format: Format;
}

export type ParseResult =
  | { ok: true; value: JobRequest }
  | { ok: false; error: string };

export function parseJobRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const { url, format } = body as Record<string, unknown>;
  if (format !== 'mp4' && format !== 'mp3') {
    return { ok: false, error: "format must be 'mp4' or 'mp3'" };
  }
  if (typeof url !== 'string') {
    return { ok: false, error: 'url must be a string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'url must be http or https' };
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: 'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported' };
  }
  return { ok: true, value: { url, format } };
}
