const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

const ALLOWED_HOSTS = new Set([
  ...YOUTUBE_HOSTS,
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
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'api.soundcloud.com',
  'api-v2.soundcloud.com',
]);

const SOUNDCLOUD_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'api.soundcloud.com',
  'api-v2.soundcloud.com',
]);

export type Format = 'mp4' | 'mp3' | 'audio';

export const MAX_CLIP_SECONDS = 24 * 60 * 60;
export const MAX_PLAYLIST_TRACKS = 500;

export interface ClipRange {
  start: number;
  end: number;
}

export interface PlaylistPosition {
  index: number;
  count: number;
}

export interface JobRequest {
  url: string;
  format: Format;
  clip?: ClipRange;
  playlist?: PlaylistPosition;
}

export type ParseResult =
  | { ok: true; value: JobRequest }
  | { ok: false; error: string };

export function parseJobRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const { url, format, clip, playlist } = body as Record<string, unknown>;
  if (format !== 'mp4' && format !== 'mp3' && format !== 'audio') {
    return { ok: false, error: "format must be 'mp4', 'mp3', or 'audio'" };
  }
  const parsedClip = parseClipRange(clip);
  if (!parsedClip.ok) {
    return { ok: false, error: parsedClip.error };
  }
  const parsedPlaylist = parsePlaylistPosition(playlist);
  if (!parsedPlaylist.ok) {
    return { ok: false, error: parsedPlaylist.error };
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
    return { ok: false, error: 'only YouTube, Twitter/X, Instagram, TikTok, Reddit, and SoundCloud URLs are supported' };
  }
  if (format === 'audio' && !SOUNDCLOUD_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: 'best audio is only supported for SoundCloud URLs' };
  }
  if (format === 'audio' && parsedClip.value) {
    return { ok: false, error: 'best-quality SoundCloud audio does not support clips' };
  }
  if (parsedPlaylist.value && format !== 'audio') {
    return { ok: false, error: 'playlist positions are only supported for SoundCloud audio' };
  }
  return {
    ok: true,
    value: {
      url,
      format,
      ...(parsedClip.value ? { clip: parsedClip.value } : {}),
      ...(parsedPlaylist.value ? { playlist: parsedPlaylist.value } : {}),
    },
  };
}

export function isYouTubeUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      YOUTUBE_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function isSoundCloudUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      SOUNDCLOUD_HOSTS.has(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function parsePlaylistPosition(playlist: unknown):
  | { ok: true; value?: PlaylistPosition }
  | { ok: false; error: string } {
  if (playlist === undefined || playlist === null) return { ok: true };
  if (typeof playlist !== 'object') {
    return { ok: false, error: 'playlist must contain an index and count' };
  }
  const { index, count } = playlist as Record<string, unknown>;
  if (
    typeof index !== 'number' ||
    typeof count !== 'number' ||
    !Number.isSafeInteger(index) ||
    !Number.isSafeInteger(count) ||
    count < 1 ||
    count > MAX_PLAYLIST_TRACKS ||
    index < 1 ||
    index > count
  ) {
    return { ok: false, error: 'playlist index and count must be valid integers up to 500' };
  }
  return { ok: true, value: { index, count } };
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
