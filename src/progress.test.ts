import { describe, expect, it } from 'vitest';
import { createProgressTracker, parseProgressLine } from './progress';

describe('parseProgressLine', () => {
  it('parses a mid-download line', () => {
    const line = '[download]  42.3% of    5.43MiB at  1.23MiB/s ETA 00:03';
    expect(parseProgressLine(line)).toEqual({
      stage: 'downloading',
      percent: 42.3,
      downloadedBytes: 2_408_464,
      totalBytes: 5_693_768,
      bytesPerSecond: 1_289_748,
      etaSeconds: 3,
    });
  });

  it('parses hour-long ETAs and skips unknown speed', () => {
    const line = '[download]   1.0% of ~ 2.00GiB at Unknown B/s ETA 1:02:03';
    expect(parseProgressLine(line)).toMatchObject({ percent: 1, etaSeconds: 3723 });
    expect(parseProgressLine(line)).not.toHaveProperty('bytesPerSecond');
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
      bytesPerSecond: 2_317_353,
      etaSeconds: 82,
    });
  });
});

describe('createProgressTracker', () => {
  it('carries finished stream bytes forward across a Destination line', () => {
    const track = createProgressTracker();
    track('[download] Destination: v.f1.mp4');
    expect(track('[download] 100% of 800.00MiB in 00:40')).toMatchObject({
      percent: 100,
      downloadedBytes: 838_860_800,
      totalBytes: 838_860_800,
    });
    expect(track('[download] Destination: a.f2.m4a')).toBeNull();
    const audio = track('[download]  50.0% of 10.00MiB at 1.00MiB/s ETA 00:05');
    expect(audio).toMatchObject({
      stage: 'downloading',
      downloadedBytes: 838_860_800 + 5_242_880,
      totalBytes: 838_860_800 + 10_485_760,
    });
    if (audio?.stage === 'downloading') expect(audio.percent).toBeGreaterThanOrEqual(100 - 1e-9);
  });

  it('never reports a lower percent and detects a reset without Destination', () => {
    const track = createProgressTracker();
    const percents: number[] = [];
    for (const line of [
      '[download]  50.0% of 100.00MiB at 1.00MiB/s ETA 00:05',
      '[download] 100% of 100.00MiB in 00:10',
      '[download]   1.0% of 10.00MiB at 1.00MiB/s ETA 00:05',
      '[download] 100% of 10.00MiB in 00:10',
    ]) {
      const event = track(line);
      if (event?.stage === 'downloading') percents.push(event.percent);
    }
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(percents.at(-1)).toBe(100);
  });

  it('does not inflate totals when an HLS estimated size ticks percent down mid-stream', () => {
    const track = createProgressTracker();
    const first = track('[download]  50.0% of ~ 10.00MiB at 1.00MiB/s ETA 00:05');
    const revised = track('[download]  45.0% of ~ 12.00MiB at 1.00MiB/s ETA 00:06');
    expect(first).toMatchObject({ stage: 'downloading', percent: 50, totalBytes: 10_485_760 });
    expect(revised).toMatchObject({ stage: 'downloading', percent: 50, totalBytes: 12_582_912 });
  });

  it('keeps percent monotonic even when totalBytes is unknown', () => {
    const track = createProgressTracker();
    expect(track('[download]  80.0% of Unknown B')).toMatchObject({ stage: 'downloading', percent: 80 });
    expect(track('[download]  10.0% of Unknown B')).toMatchObject({ stage: 'downloading', percent: 80 });
  });

  it('passes processing events through', () => {
    expect(createProgressTracker()('[Merger] Merging formats into "x.mkv"')).toEqual({
      stage: 'processing',
    });
  });
});
