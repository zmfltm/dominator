import { describe, expect, it } from 'vitest';
import { parseYouTubeStoryboards } from './storyboard';

const sheet = (n: number) => `https://i.ytimg.com/sb/abc/storyboard3_L2/M${n}.jpg?sigh=x`;

describe('parseYouTubeStoryboards', () => {
  it('reads storyboard grids, largest first, with frame spacing from fps', () => {
    const formats = [
      { format_id: '18', width: 640, height: 360 },
      { format_id: 'sb1', width: 160, height: 90, columns: 5, rows: 5, fps: 0.1, fragments: [{ url: sheet(0) }, { url: sheet(1) }] },
      { format_id: 'sb0', width: 320, height: 180, columns: 3, rows: 3, fps: 0.1, fragments: [{ url: sheet(0) }] },
    ];
    expect(parseYouTubeStoryboards(formats)).toEqual([
      { width: 320, height: 180, columns: 3, rows: 3, interval: 10, sheets: [sheet(0)] },
      { width: 160, height: 90, columns: 5, rows: 5, interval: 10, sheets: [sheet(0), sheet(1)] },
    ]);
  });

  it('falls back to fragment duration when fps is missing', () => {
    const [board] = parseYouTubeStoryboards([
      { format_id: 'sb1', width: 160, height: 90, columns: 5, rows: 5, fragments: [{ url: sheet(0), duration: 250 }] },
    ]);
    expect(board.interval).toBe(10);
  });

  it('drops storyboards with non-YouTube or non-HTTPS sheet URLs', () => {
    expect(parseYouTubeStoryboards([
      { format_id: 'sb1', width: 160, height: 90, columns: 5, rows: 5, fps: 0.1, fragments: [{ url: 'https://evil.example/a.jpg' }] },
      { format_id: 'sb2', width: 80, height: 45, columns: 5, rows: 5, fps: 0.1, fragments: [{ url: 'http://i.ytimg.com/a.jpg' }] },
    ])).toEqual([]);
  });

  it('ignores malformed input', () => {
    expect(parseYouTubeStoryboards(null)).toEqual([]);
    expect(parseYouTubeStoryboards([{ format_id: 'sb0', width: 0 }])).toEqual([]);
  });
});
