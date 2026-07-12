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
  'reddit.com',
  'www.reddit.com',
  'old.reddit.com',
  'new.reddit.com',
  'm.reddit.com',
  'redd.it',
  'v.redd.it',
]);

export type Format = 'mp4' | 'mp3';

export const MAX_CLIP_SECONDS = 24 * 60 * 60;

export interface ClipRange {
  start: number;
  end: number;
}

export interface JobRequest {
  url: string;
  format: Format;
  clip?: ClipRange;
}

export type ParseResult =
  | { ok: true; value: JobRequest }
  | { ok: false; error: string };

export function parseJobRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const { url, format, clip } = body as Record<string, unknown>;
  if (format !== 'mp4' && format !== 'mp3') {
    return { ok: false, error: "format must be 'mp4' or 'mp3'" };
  }
  const parsedClip = parseClipRange(clip);
  if (!parsedClip.ok) {
    return { ok: false, error: parsedClip.error };
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
    return { ok: false, error: 'only YouTube, Twitter/X, Instagram, TikTok, and Reddit URLs are supported' };
  }
  return {
    ok: true,
    value: parsedClip.value ? { url, format, clip: parsedClip.value } : { url, format },
  };
}

function parseClipRange(clip: unknown):
  | { ok: true; value?: ClipRange }
  | { ok: false; error: string } {
  if (clip === undefined || clip === null) {
    return { ok: true };
  }
  if (typeof clip !== 'object') {
    return { ok: false, error: 'clip must be an object with start and end times' };
  }

  const { start, end } = clip as Record<string, unknown>;
  if (typeof start !== 'number' || typeof end !== 'number') {
    return { ok: false, error: 'clip start and end must be numbers of seconds' };
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return { ok: false, error: 'clip start and end must be finite numbers' };
  }
  if (start < 0 || end < 0 || start > MAX_CLIP_SECONDS || end > MAX_CLIP_SECONDS) {
    return { ok: false, error: 'clip times must be between 0 and 24 hours' };
  }
  const roundedStart = roundToMilliseconds(start);
  const roundedEnd = roundToMilliseconds(end);
  if (roundedEnd <= roundedStart) {
    return { ok: false, error: 'clip end must be after start' };
  }

  return {
    ok: true,
    value: {
      start: roundedStart,
      end: roundedEnd,
    },
  };
}

function roundToMilliseconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
