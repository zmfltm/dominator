import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { cancelJob, deleteJob, getJob, JobLimitError, startJob, type Job } from './jobs';
import { fetchVideoTitle, MetadataError } from './metadata';
import type { ProgressEvent } from './progress';
import { parseJobRequest } from './validate';

export const app = new Hono();

app.post('/api/metadata', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be JSON' }, 400);
  }
  if (typeof body !== 'object' || body === null) {
    return c.json({ error: 'request body must be a JSON object' }, 400);
  }
  const parsed = parseJobRequest({
    url: (body as Record<string, unknown>).url,
    format: 'mp4',
  });
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  try {
    const title = await fetchVideoTitle(parsed.value.url);
    return c.json({ title });
  } catch (err) {
    if (err instanceof MetadataError) {
      return c.json({ error: err.message }, 502);
    }
    throw err;
  }
});

app.post('/api/jobs', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'request body must be JSON' }, 400);
  }
  const parsed = parseJobRequest(body);
  if (!parsed.ok) {
    return c.json({ error: parsed.error }, 400);
  }
  try {
    const job = await startJob(parsed.value);
    return c.json({ jobId: job.id }, 201);
  } catch (err) {
    if (err instanceof JobLimitError) {
      return c.json({ error: err.message }, 429);
    }
    throw err;
  }
});

app.get('/api/jobs/:id/events', (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) {
    return c.json({ error: 'no such job' }, 404);
  }
  return streamSSE(c, async (stream) => {
    if (job.lastProgress) {
      await stream.writeSSE({ event: 'progress', data: JSON.stringify(job.lastProgress) });
    }
    if (job.status === 'done') {
      await stream.writeSSE({ event: 'done', data: 'done' });
      return;
    }
    if (job.status === 'error') {
      await stream.writeSSE({ event: 'failed', data: job.error ?? 'unknown error' });
      return;
    }
    if (job.status === 'canceled') {
      await stream.writeSSE({ event: 'canceled', data: 'job canceled' });
      return;
    }
    await followJob(job, stream);
  });
});

interface SSEStream {
  writeSSE(message: { event: string; data: string }): Promise<void>;
  onAbort(cb: () => void): void;
}

function followJob(job: Job, stream: SSEStream): Promise<void> {
  return new Promise((resolve) => {
    const onProgress = (progress: ProgressEvent) => {
      void stream.writeSSE({ event: 'progress', data: JSON.stringify(progress) });
    };
    const onDone = () => {
      void stream.writeSSE({ event: 'done', data: 'done' }).then(finish, finish);
    };
    const onFailed = (message: string) => {
      void stream.writeSSE({ event: 'failed', data: message }).then(finish, finish);
    };
    const onCanceled = () => {
      void stream.writeSSE({ event: 'canceled', data: 'job canceled' }).then(finish, finish);
    };
    function finish() {
      job.events.off('progress', onProgress);
      job.events.off('done', onDone);
      job.events.off('failed', onFailed);
      job.events.off('canceled', onCanceled);
      resolve();
    }
    job.events.on('progress', onProgress);
    job.events.once('done', onDone);
    job.events.once('failed', onFailed);
    job.events.once('canceled', onCanceled);
    stream.onAbort(finish);
  });
}

app.delete('/api/jobs/:id', (c) => {
  const result = cancelJob(c.req.param('id'));
  if (result === 'not_found') {
    return c.json({ error: 'no such job' }, 404);
  }
  if (result === 'not_running') {
    return c.json({ error: 'job is not running' }, 409);
  }
  return c.json({ status: 'canceled' });
});

app.get('/api/jobs/:id/file', async (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) {
    return c.json({ error: 'no such job' }, 404);
  }
  if (job.status !== 'done' || !job.filePath) {
    return c.json({ error: 'job is not finished' }, 409);
  }
  let size: number;
  try {
    ({ size } = await stat(job.filePath));
  } catch {
    return c.json({ error: 'file no longer available' }, 410);
  }
  const filename = basename(job.filePath);
  const asciiName = filename
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/[";]/g, "'");
  const fileStream = createReadStream(job.filePath);
  fileStream.once('error', (err) => {
    console.error(`file stream error for job ${job.id}:`, err);
    fileStream.destroy();
  });
  fileStream.once('close', () => {
    void deleteJob(job.id);
  });
  return new Response(Readable.toWeb(fileStream) as ReadableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(size),
      'Content-Disposition':
        `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

app.use('/*', serveStatic({ root: './public' }));
