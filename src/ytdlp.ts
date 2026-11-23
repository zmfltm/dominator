import { isYouTubeUrl } from './validate';

export function youtubeExtractorArgs(
  url: string,
  options: { fast?: boolean } = {},
): string[] {
  if (!isYouTubeUrl(url)) return [];
  const base = ['--js-runtimes', `node:${process.execPath}`];
  if (options.fast === false) return base;
  // Prefer visionos then web so yt-dlp avoids tv_samsung pre-roll ad sleeps
  // while still serving 1080p H.264+AAC streams.
  return [...base, '--extractor-args', 'youtube:player_client=visionos,web'];
}
