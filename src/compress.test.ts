import { describe, expect, it } from 'vitest';
import {
  buildFfmpegCompressArgs,
  classifyProbe,
  compressedFileName,
  parseFfmpegProgressLine,
  UnsupportedMediaError,
  uploadFileName,
} from './compress';

describe('buildFfmpegCompressArgs', () => {
  it('re-encodes video to a capped-resolution H.264 MP4 with progress on stdout', () => {
    const args = buildFfmpegCompressArgs('/tmp/in.mov', '/tmp/out.mp4', 'video');
    expect(args.slice(0, 10)).toEqual([
      '-hide_banner', '-loglevel', 'warning', '-nostats',
      '-progress', 'pipe:1', '-y', '-i', '/tmp/in.mov', '-map',
    ]);
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-crf', '28', '-preset', 'medium']));
    expect(args).toEqual(expect.arrayContaining(['-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k']));
    expect(args).toContain('0:a:0?');
    expect(args.at(-1)).toBe('/tmp/out.mp4');
  });

  it('extracts the first audio stream to MP3 and drops video', () => {
    const args = buildFfmpegCompressArgs('/tmp/in.wav', '/tmp/out.mp3', 'audio');
    expect(args.slice(args.indexOf('-i'))).toEqual([
      '-i', '/tmp/in.wav', '-vn', '-map', '0:a:0',
      '-c:a', 'libmp3lame', '-q:a', '5', '/tmp/out.mp3',
    ]);
  });
});

describe('parseFfmpegProgressLine', () => {
  it('converts out_time_us into a percent of the duration', () => {
    expect(parseFfmpegProgressLine('out_time_us=2500000', 10)).toBe(25);
  });

  it('clamps to 0..100', () => {
    expect(parseFfmpegProgressLine('out_time_us=99000000', 10)).toBe(100);
    expect(parseFfmpegProgressLine('out_time_us=0', 10)).toBe(0);
  });

  it('ignores other lines, negative timestamps, and unknown durations', () => {
    expect(parseFfmpegProgressLine('frame=12', 10)).toBeNull();
    expect(parseFfmpegProgressLine('out_time_us=-9223372036854775807', 10)).toBeNull();
    expect(parseFfmpegProgressLine('out_time_us=N/A', 10)).toBeNull();
    expect(parseFfmpegProgressLine('out_time_us=1000000', null)).toBeNull();
  });
});

describe('compressedFileName', () => {
  it('replaces the extension and names the output by kind', () => {
    expect(compressedFileName('holiday.mov', 'video')).toBe('holiday.compressed.mp4');
    expect(compressedFileName('song.flac', 'audio')).toBe('song.compressed.mp3');
  });

  it('keeps only the basename and strips separators and control characters', () => {
    expect(compressedFileName('../../etc/pass.mp4', 'video')).toBe('pass.compressed.mp4');
    expect(compressedFileName('C:\\Users\\me\\clip.mp4', 'video')).toBe('clip.compressed.mp4');
    expect(compressedFileName('a\u0000b\nc.mp4', 'video')).toBe('abc.compressed.mp4');
  });

  it('caps the length and falls back to file', () => {
    expect(compressedFileName(`${'x'.repeat(500)}.mp4`, 'video')).toBe(`${'x'.repeat(120)}.compressed.mp4`);
    expect(compressedFileName('', 'audio')).toBe('file.compressed.mp3');
    expect(compressedFileName('...', 'video')).toBe('file.compressed.mp4');
    expect(compressedFileName('/', 'video')).toBe('file.compressed.mp4');
  });
});

describe('uploadFileName', () => {
  it('keeps a safe extension so ffprobe can sniff by name', () => {
    expect(uploadFileName('clip.MOV')).toBe('input.mov');
    expect(uploadFileName('no-extension')).toBe('input');
    expect(uploadFileName('weird.ext/../x.$$$')).toBe('input');
  });
});

describe('classifyProbe', () => {
  const video = { codec_type: 'video', disposition: { attached_pic: 0 } };
  const audio = { codec_type: 'audio', disposition: { attached_pic: 0 } };
  const cover = { codec_type: 'video', disposition: { attached_pic: 1 } };

  it('treats any real video stream as video', () => {
    expect(classifyProbe({ streams: [video, audio], format: { duration: '12.5' } })).toEqual({
      kind: 'video',
      durationSeconds: 12.5,
    });
  });

  it('treats audio with cover art as audio', () => {
    expect(classifyProbe({ streams: [cover, audio], format: { duration: '3' } }).kind).toBe('audio');
  });

  it('reports an unknown duration as null', () => {
    expect(classifyProbe({ streams: [audio], format: {} }).durationSeconds).toBeNull();
    expect(classifyProbe({ streams: [audio], format: { duration: 'N/A' } }).durationSeconds).toBeNull();
  });

  it('rejects files without audio or video, cover art alone included', () => {
    expect(() => classifyProbe({ streams: [] })).toThrow(UnsupportedMediaError);
    expect(() => classifyProbe({ streams: [cover] })).toThrow(
      'unsupported file; choose a video or audio file',
    );
    expect(() => classifyProbe(null)).toThrow(UnsupportedMediaError);
  });
});
