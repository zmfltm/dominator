import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn }));

function metadataProcess(title = 'Example video', code = 0) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  queueMicrotask(() => {
    child.stdout.write(JSON.stringify({ title, duration: 120 }));
    child.emit('close', code);
  });
  return child;
}

beforeEach(() => {
  vi.resetModules();
  spawn.mockReset();
  spawn.mockImplementation(() => metadataProcess());
});
afterEach(() => vi.restoreAllMocks());

describe('metadata cache', () => {
  const url = 'https://youtu.be/example';

  it('shares in-flight requests and reuses completed metadata', async () => {
    const { fetchVideoMetadata } = await import('./metadata');
    const first = fetchVideoMetadata(url);
    const concurrent = fetchVideoMetadata(url);
    expect(concurrent).toBe(first);
    await expect(first).resolves.toEqual({ title: 'Example video', duration: 120 });
    await expect(fetchVideoMetadata(url)).resolves.toEqual({ title: 'Example video', duration: 120 });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('refreshes expired metadata', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const { fetchVideoMetadata, METADATA_CACHE_TTL_MS } = await import('./metadata');
    await fetchVideoMetadata(url);
    now.mockReturnValue(1001 + METADATA_CACHE_TTL_MS);
    spawn.mockImplementation(() => metadataProcess('Updated title'));
    await expect(fetchVideoMetadata(url)).resolves.toMatchObject({ title: 'Updated title' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('does not cache extraction failures', async () => {
    const { fetchVideoMetadata } = await import('./metadata');
    spawn.mockImplementationOnce(() => metadataProcess('', 1));
    await expect(fetchVideoMetadata(url)).rejects.toThrow('yt-dlp exited with code 1');
    await expect(fetchVideoMetadata(url)).resolves.toMatchObject({ title: 'Example video' });
    expect(spawn).toHaveBeenCalledTimes(2);
  });

  it('evicts old entries when the cache reaches its limit', async () => {
    const { fetchVideoMetadata, MAX_CACHED_METADATA } = await import('./metadata');
    for (let index = 0; index <= MAX_CACHED_METADATA; index += 1) {
      await fetchVideoMetadata(`${url}-${index}`);
    }
    await fetchVideoMetadata(`${url}-0`);
    expect(spawn).toHaveBeenCalledTimes(MAX_CACHED_METADATA + 2);
  });
});
