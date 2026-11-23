import { isYouTubeUrl } from './validate';

export function youtubeJsRuntimeArgs(url: string): string[] {
  if (!isYouTubeUrl(url)) return [];
  // Prefer visionos then web so yt-dlp avoids tv_samsung pre-roll ad sleeps
  // while still serving 1080p H.264+AAC streams.
  return [
    '--js-runtimes',
    `node:${process.execPath}`,
    '--extractor-args',
    'youtube:player_client=visionos,web',
  ];
}
