import { describe, expect, it } from 'vitest';
import { buildCompatibleMp4Args, compatibleAudio, compatibleVideo, parseMediaStreams, type MediaStream } from './media';

const h264: MediaStream = { codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' };
const aac: MediaStream = { codec_type: 'audio', codec_name: 'aac', profile: 'LC', channels: 2 };

describe('MP4 compatibility', () => {
  it('accepts H.264 8-bit video and mono/stereo AAC LC audio', () => {
    expect(compatibleVideo(h264)).toBe(true);
    expect(compatibleAudio(aac)).toBe(true);
    expect(compatibleAudio({ ...aac, channels: 1 })).toBe(true);
  });

  it.each(['av1', 'vp9', 'hevc'])('converts %s to H.264 while preserving compatible audio', (codec) => {
    const args = buildCompatibleMp4Args('/tmp/source.mp4', '/tmp/output.mp4', [{ ...h264, codec_name: codec }, aac]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
    expect(args[args.indexOf('-movflags') + 1]).toBe('+faststart');
  });

  it('converts 10-bit H.264 and pads odd dimensions to even dimensions', () => {
    const args = buildCompatibleMp4Args('/tmp/source.mp4', '/tmp/output.mp4', [{ ...h264, pix_fmt: 'yuv420p10le' }]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264');
    expect(args[args.indexOf('-vf') + 1]).toBe('scale=ceil(iw/2)*2:ceil(ih/2)*2');
    expect(args).toContain('0:a:0?');
  });

  it('converts unsupported audio without re-encoding compatible video', () => {
    const args = buildCompatibleMp4Args('/tmp/source.mp4', '/tmp/output.mp4', [h264, { ...aac, codec_name: 'opus' }]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('aac');
    expect(args[args.indexOf('-profile:a') + 1]).toBe('aac_low');
    expect(args[args.indexOf('-ac') + 1]).toBe('2');
  });

  it('converts multichannel and HE-AAC audio for upload compatibility', () => {
    expect(compatibleAudio({ ...aac, channels: 6 })).toBe(false);
    expect(compatibleAudio({ ...aac, profile: 'HE-AAC' })).toBe(false);
    expect(compatibleAudio({ ...aac, channels: undefined })).toBe(false);
  });

  it('remuxes compatible streams without quality loss', () => {
    const args = buildCompatibleMp4Args('/tmp/source.mkv', '/tmp/output.mp4', [h264, aac]);
    expect(args[args.indexOf('-c:v') + 1]).toBe('copy');
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy');
  });
});

describe('ffprobe output', () => {
  it('validates media streams and ignores subtitle streams', () => {
    const streams = parseMediaStreams(JSON.stringify({ streams: [h264, aac, { codec_type: 'subtitle', codec_name: 'srt' }] }));
    expect(streams).toEqual([h264, aac]);
  });

  it.each(['{}', 'null', '{"streams":[]}', '{"streams":[{"codec_type":"audio","codec_name":"aac"}]}', '{"streams":[{"codec_type":"video"}]}'])('rejects invalid or video-less output: %s', (output) => {
    expect(() => parseMediaStreams(output)).toThrow();
  });
});
