// A storyboard is a set of sprite sheets laid out as a grid of equally spaced
// frames. YouTube publishes these for every video; previews.ts builds one from
// the low-resolution preview download for other sites.
export interface Storyboard {
  width: number;
  height: number;
  columns: number;
  rows: number;
  // Seconds between consecutive frames.
  interval: number;
  sheets: string[];
}

const MAX_SHEETS = 1000;

export function isStoryboardImageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'i.ytimg.com' || /^i\d+\.ytimg\.com$/.test(parsed.hostname))
    );
  } catch {
    return false;
  }
}

// Reads yt-dlp's storyboard formats (sb0, sb1, ...), largest frames first.
export function parseYouTubeStoryboards(formats: unknown): Storyboard[] {
  if (!Array.isArray(formats)) return [];
  const storyboards: Storyboard[] = [];
  for (const value of formats) {
    if (typeof value !== 'object' || value === null) continue;
    const format = value as Record<string, unknown>;
    if (typeof format.format_id !== 'string' || !/^sb\d+$/.test(format.format_id)) continue;
    const width = positiveInteger(format.width);
    const height = positiveInteger(format.height);
    const columns = positiveInteger(format.columns);
    const rows = positiveInteger(format.rows);
    if (!width || !height || !columns || !rows) continue;
    if (!Array.isArray(format.fragments) || format.fragments.length === 0) continue;
    if (format.fragments.length > MAX_SHEETS) continue;

    const sheets: string[] = [];
    for (const fragment of format.fragments) {
      const url = (fragment as Record<string, unknown> | null)?.url;
      if (!isStoryboardImageUrl(url)) break;
      sheets.push(url);
    }
    if (sheets.length !== format.fragments.length) continue;

    const interval = storyboardInterval(format, columns * rows);
    if (!interval) continue;
    storyboards.push({ width, height, columns, rows, interval, sheets });
  }
  return storyboards.sort((a, b) => b.width - a.width);
}

function storyboardInterval(format: Record<string, unknown>, framesPerSheet: number): number | undefined {
  const fps = Number(format.fps);
  if (Number.isFinite(fps) && fps > 0) return roundSeconds(1 / fps);
  const first = (format.fragments as Array<Record<string, unknown> | null>)[0];
  const duration = Number(first?.duration);
  if (Number.isFinite(duration) && duration > 0) return roundSeconds(duration / framesPerSheet);
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

function roundSeconds(seconds: number): number {
  return Math.round(seconds * 1000) / 1000;
}
