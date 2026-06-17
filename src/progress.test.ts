import { describe, expect, it } from 'vitest';
import { parseProgressLine } from './progress';

describe('parseProgressLine', () => {
  it('parses a mid-download line', () => {
    const line = '[download]  42.3% of    5.43MiB at  1.23MiB/s ETA 00:03';
    expect(parseProgressLine(line)).toEqual({
      stage: 'downloading',
      percent: 42.3,
      downloadedBytes: 2_408_464,
      totalBytes: 5_693_768,
    });
  });

  it('parses a completed download line', () => {
    const line = '[download] 100% of 5.43MiB in 00:04';
    expect(parseProgressLine(line)).toEqual({
      stage: 'downloading',
      percent: 100,
      downloadedBytes: 5_693_768,
      totalBytes: 5_693_768,
    });
  });

  it('treats merger lines as processing', () => {
    const line = '[Merger] Merging formats into "/tmp/dominator-x/video.mp4"';
    expect(parseProgressLine(line)).toEqual({ stage: 'processing' });
  });

  it('treats audio extraction lines as processing', () => {
    const line = '[ExtractAudio] Destination: /tmp/dominator-x/audio.mp3';
    expect(parseProgressLine(line)).toEqual({ stage: 'processing' });
  });

  it('ignores download lines without a percent', () => {
    expect(parseProgressLine('[download] Destination: /tmp/x.mp4')).toBeNull();
  });

  it('ignores unrelated yt-dlp output', () => {
    expect(parseProgressLine('[youtube] dQw4w9WgXcQ: Downloading webpage')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
  });

  it('treats fixup duration lines as processing', () => {
    const line = '[FixupDuration] Fixing duration of "/tmp/dominator-x/video.mp4"';
    expect(parseProgressLine(line)).toEqual({ stage: 'processing' });
  });

  it('parses a very low percent download line', () => {
    const line = '[download]   0.1% of ~183.14MiB at  2.21MiB/s ETA 01:22';
    expect(parseProgressLine(line)).toEqual({
      stage: 'downloading',
      percent: 0.1,
      downloadedBytes: 192_036,
      totalBytes: 192_036_209,
    });
  });
});
