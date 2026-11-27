export type ProgressEvent =
  | {
      stage: 'downloading';
      percent: number;
      downloadedBytes?: number;
      totalBytes?: number;
      bytesPerSecond?: number;
      etaSeconds?: number;
    }
  | { stage: 'processing' }
  | { stage: 'compressing'; percent: number | null };

const DOWNLOAD_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%(?:\s+of\s+~?\s*([\d.]+)\s*([KMGT]?i?B))?/i;
const SPEED_RE = /\sat\s+([\d.]+)\s*([KMGT]?i?B)\/s/i;
const ETA_RE = /\sETA\s+(\d+(?::\d{2}){1,2})\b/;
const PROCESSING_RE = /^\[(Merger|ExtractAudio|VideoConvertor|Fixup\w+)\]/; // VideoConvertor matches yt-dlp's actual upstream spelling and must not be "corrected" to VideoConverter

export function parseProgressLine(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  const download = DOWNLOAD_RE.exec(trimmed);
  if (download) {
    const percent = Number(download[1]);
    const totalBytes = parseByteSize(download[2], download[3]);
    const speed = SPEED_RE.exec(trimmed);
    const bytesPerSecond = speed ? parseByteSize(speed[1], speed[2]) : undefined;
    const eta = ETA_RE.exec(trimmed);
    const etaSeconds = eta ? parseClock(eta[1]) : undefined;
    return {
      stage: 'downloading',
      percent,
      ...(totalBytes !== undefined
        ? { downloadedBytes: Math.round(totalBytes * (percent / 100)), totalBytes }
        : {}),
      ...(bytesPerSecond !== undefined ? { bytesPerSecond } : {}),
      ...(etaSeconds !== undefined ? { etaSeconds } : {}),
    };
  }
  if (PROCESSING_RE.test(trimmed)) {
    return { stage: 'processing' };
  }
  return null;
}

function parseClock(value: string): number {
  return value.split(':').reduce((total, part) => total * 60 + Number(part), 0);
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

const DESTINATION_RE = /^\[download\]\s+Destination:/;

type DownloadingEvent = Extract<ProgressEvent, { stage: 'downloading' }>;

// yt-dlp reports each stream (video, then audio) as its own 0-100%. This keeps
// finished streams' bytes so a job's progress never moves backward.
export function createProgressTracker(): (line: string) => ProgressEvent | null {
  let priorDownloaded = 0;
  let priorTotal = 0;
  let last: DownloadingEvent | null = null;
  let lastPercent = 0;

  const finishStream = () => {
    if (last?.totalBytes !== undefined) {
      priorTotal += last.totalBytes;
      priorDownloaded += last.downloadedBytes ?? last.totalBytes;
    }
    last = null;
  };

  return (line) => {
    const trimmed = line.trim();
    if (DESTINATION_RE.test(trimmed)) {
      finishStream();
      return null;
    }
    const event = parseProgressLine(line);
    if (!event || event.stage !== 'downloading') return event;
    // Percent resetting after a finished stream without a Destination line also
    // marks a new stream. Ignore mid-stream drops from HLS size re-estimates.
    if (last && last.percent >= 100 && event.percent < last.percent) finishStream();
    last = event;
    if (event.totalBytes === undefined) {
      const percent = Math.max(lastPercent, Math.min(100, event.percent));
      lastPercent = percent;
      return { ...event, percent };
    }

    const downloadedBytes = priorDownloaded + (event.downloadedBytes ?? 0);
    const totalBytes = priorTotal + event.totalBytes;
    const percent = Math.max(lastPercent, Math.min(100, (downloadedBytes / totalBytes) * 100));
    lastPercent = percent;
    return { ...event, percent, downloadedBytes, totalBytes };
  };
}
