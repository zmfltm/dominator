export interface MediaStream {
  codec_type: 'video' | 'audio';
  codec_name: string;
  pix_fmt?: string;
  profile?: string;
  channels?: number;
}

export function parseMediaStreams(output: string): MediaStream[] {
  const data: unknown = JSON.parse(output);
  if (typeof data !== 'object' || data === null || !('streams' in data) || !Array.isArray(data.streams)) {
    throw new Error('ffprobe returned no media streams');
  }
  const streams: MediaStream[] = [];
  for (const stream of data.streams) {
    if (typeof stream !== 'object' || stream === null) continue;
    if (stream.codec_type !== 'video' && stream.codec_type !== 'audio') continue;
    if (typeof stream.codec_name !== 'string') throw new Error('ffprobe returned a stream without a codec');
    streams.push({
      codec_type: stream.codec_type,
      codec_name: stream.codec_name,
      pix_fmt: typeof stream.pix_fmt === 'string' ? stream.pix_fmt : undefined,
      profile: typeof stream.profile === 'string' ? stream.profile : undefined,
      channels: typeof stream.channels === 'number' ? stream.channels : undefined,
    });
  }
  if (!streams.some((stream) => stream.codec_type === 'video')) throw new Error('download contains no video stream');
  return streams;
}

export function compatibleVideo(stream: MediaStream): boolean {
  return stream.codec_name === 'h264' && stream.pix_fmt === 'yuv420p';
}

export function compatibleAudio(stream: MediaStream): boolean {
  return stream.codec_name === 'aac' && stream.profile === 'LC' &&
    typeof stream.channels === 'number' && stream.channels > 0 && stream.channels <= 2;
}

export function buildCompatibleMp4Args(inputPath: string, outputPath: string, streams: MediaStream[]): string[] {
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  return [
    '-hide_banner', '-loglevel', 'warning', '-y', '-i', inputPath,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    ...(video && compatibleVideo(video)
      ? ['-c:v', 'copy']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2', '-crf', '20', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-vf', 'scale=ceil(iw/2)*2:ceil(ih/2)*2']),
    ...(audio && compatibleAudio(audio)
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-ac', '2']),
    '-movflags', '+faststart', outputPath,
  ];
}
