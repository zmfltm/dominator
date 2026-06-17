export type ProgressEvent =
  | { stage: 'downloading'; percent: number; downloadedBytes?: number; totalBytes?: number }
  | { stage: 'processing' };

const DOWNLOAD_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?\s*([\d.]+)\s*([KMGT]?i?B))?/i;
const PROCESSING_RE = /^\[(Merger|ExtractAudio|VideoConvertor|Fixup\w+)\]/; // VideoConvertor matches yt-dlp's actual upstream spelling and must not be "corrected" to VideoConverter

export function parseProgressLine(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  const download = DOWNLOAD_RE.exec(trimmed);
  if (download) {
    const percent = Number(download[1]);
    const totalBytes = parseByteSize(download[2], download[3]);
    if (totalBytes === undefined) {
      return { stage: 'downloading', percent };
    }
    return {
      stage: 'downloading',
      percent,
      downloadedBytes: Math.round(totalBytes * (percent / 100)),
      totalBytes,
    };
  }
  if (PROCESSING_RE.test(trimmed)) {
    return { stage: 'processing' };
  }
  return null;
}

function parseByteSize(value: string | undefined, unit: string | undefined): number | undefined {
  if (!value || !unit) return undefined;
  const amount = Number(value);
  if (!Number.isFinite(amount)) return undefined;
  const normalized = unit.toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
    kib: 1024,
    mib: 1024 ** 2,
    gib: 1024 ** 3,
    tib: 1024 ** 4,
  };
  const multiplier = multipliers[normalized];
  if (!multiplier) return undefined;
  return Math.round(amount * multiplier);
}
