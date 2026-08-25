import { isYouTubeUrl } from './validate';

export function youtubeJsRuntimeArgs(url: string): string[] {
  if (!isYouTubeUrl(url)) return [];
  return ['--js-runtimes', `node:${process.execPath}`];
}
