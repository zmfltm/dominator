import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('frontend script missing');

type Listener = (event: { data: string }) => void;
class TestEventSource {
  static instances: TestEventSource[];
  listeners = new Map<string, Listener>();
  close = vi.fn();
  onerror: (() => void) | null = null;
  constructor(public url: string) { TestEventSource.instances.push(this); }
  addEventListener(name: string, listener: Listener) { this.listeners.set(name, listener); }
  emit(name: string, data = '') { this.listeners.get(name)?.({ data }); }
}

interface QueueItem {
  status: string;
  jobId: string | null;
  source: TestEventSource | null;
}
interface Frontend {
  queueItem(url: string, format: string, title: string): QueueItem;
  startItem(item: QueueItem): Promise<void>;
  startSingleItem(item: QueueItem): void;
  cancelAllDownloads(): Promise<unknown>;
  queueInput(): Promise<QueueItem[] | null>;
  items: QueueItem[];
}

function frontend(fetch = vi.fn()) {
  TestEventSource.instances = [];
  const elements = new Map<string, { value: string; addEventListener: ReturnType<typeof vi.fn>; classList: { toggle: ReturnType<typeof vi.fn> } }>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '', addEventListener: vi.fn(), classList: { toggle: vi.fn() } });
    return elements.get(id)!;
  };
  const context = {
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { matchMedia: () => ({ matches: false }), addEventListener: vi.fn(), setTimeout },
    requestAnimationFrame: vi.fn(() => 1),
    fetch, URL, URLSearchParams, EventSource: TestEventSource, setTimeout, clearTimeout,
  };
  const api = runInNewContext(script + '\n({ queueItem, startItem, startSingleItem, cancelAllDownloads, queueInput, items })', context) as Frontend;
  const click = (id: string) => element(id).addEventListener.mock.calls.find(([name]) => name === 'click')?.[1]();
  return { api, fetch, element, click };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function jobResponse(jobId: string) { return Response.json({ jobId }, { status: 201 }); }

describe('frontend download lifecycle', () => {
  it('cancels a job that arrives after cancellation without reopening its stream', async () => {
    const pending = deferredResponse();
    const fetch = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(Response.json({}));
    const { api } = frontend(fetch);
    const item = api.queueItem('https://youtu.be/example', 'mp4', 'Example');
    const starting = api.startItem(item);
    await api.cancelAllDownloads();
    pending.resolve(jobResponse('old-job'));
    await starting;
    expect(item.status).toBe('canceled');
    expect(item.jobId).toBeNull();
    expect(TestEventSource.instances).toHaveLength(0);
    expect(fetch).toHaveBeenLastCalledWith('/api/jobs/old-job', { method: 'DELETE' });
  });

  it.each([true, false])('ignores an old %s response after the row has been retried', async (succeeds) => {
    const pending = deferredResponse();
    const fetch = vi.fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(jobResponse('new-job'))
      .mockResolvedValue(Response.json({}));
    const { api } = frontend(fetch);
    const item = api.queueItem('https://youtu.be/example', 'mp4', 'Example');
    const oldRun = api.startItem(item);
    await api.cancelAllDownloads();
    api.startSingleItem(item);
    await vi.waitFor(() => expect(item.jobId).toBe('new-job'));
    pending.resolve(succeeds ? jobResponse('old-job') : Response.json({ error: 'old failure' }, { status: 502 }));
    await oldRun;
    expect(item.jobId).toBe('new-job');
    expect(item.status).toBe('starting');
    expect(TestEventSource.instances).toHaveLength(1);
    expect(item.source?.url).toBe('/api/jobs/new-job/events');
    expect(item.source?.close).not.toHaveBeenCalled();
  });

  it('ignores events from a canceled attempt after retry', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(jobResponse('first')).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(jobResponse('second'));
    const { api } = frontend(fetch);
    const item = api.queueItem('https://youtu.be/example', 'mp4', 'Example');
    await api.startItem(item);
    const oldSource = item.source!;
    await api.cancelAllDownloads();
    api.startSingleItem(item);
    await vi.waitFor(() => expect(item.jobId).toBe('second'));
    oldSource.emit('progress', JSON.stringify({ stage: 'downloading', percent: 99 }));
    oldSource.emit('failed', 'old failure');
    oldSource.emit('done');
    expect(item.status).toBe('starting');
    expect(item.jobId).toBe('second');
  });

  it('allows retrying failed rows without starting the rest of the queue', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ error: 'offline' }, { status: 502 })).mockResolvedValueOnce(jobResponse('retry'));
    const { api } = frontend(fetch);
    const failed = api.queueItem('https://youtu.be/example', 'mp4', 'Example');
    const queued = api.queueItem('https://youtu.be/another', 'mp4', 'Another');
    await api.startItem(failed);
    expect(failed.status).toBe('failed');
    api.startSingleItem(failed);
    await vi.waitFor(() => expect(failed.jobId).toBe('retry'));
    itemSource(failed).emit('failed', 'still offline');
    expect(queued.status).toBe('queued');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops expanding pasted links when the queue is canceled', async () => {
    const pending = deferredResponse();
    const { api, element } = frontend(vi.fn().mockReturnValueOnce(pending.promise));
    element('url').value = 'https://soundcloud.com/artist/sets/example https://youtu.be/another';
    const queueing = api.queueInput();
    await api.cancelAllDownloads();
    pending.resolve(Response.json({ tracks: [{ url: 'https://soundcloud.com/artist/track', title: 'Track' }] }));
    expect(await queueing).toBeNull();
    expect(api.items).toHaveLength(0);
  });

  it('clears immediately and keeps newly queued rows when cancellation finishes later', async () => {
    const cancellation = deferredResponse();
    const fetch = vi.fn().mockResolvedValueOnce(jobResponse('active')).mockReturnValueOnce(cancellation.promise);
    const { api, click } = frontend(fetch);
    const item = api.queueItem('https://youtu.be/example', 'mp4', 'Example');
    await api.startItem(item);
    click('clear');
    expect(api.items).toHaveLength(0);
    const added = api.queueItem('https://youtu.be/new', 'mp4', 'New download');
    cancellation.resolve(Response.json({ status: 'canceled' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(api.items).toEqual([added]);
    expect(added.status).toBe('queued');
  });
});

function itemSource(item: QueueItem) {
  if (!item.source) throw new Error('download stream missing');
  return item.source;
}
