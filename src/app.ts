import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { Readable } from 'node:stream';
import { cancelJob, deleteJob, getJob, JobLimitError, startJob, type Job } from './jobs';
import { fetchVideoMetadata, MetadataError } from './metadata';
import {
  getPreview,
  previewStatusBody,
  PreviewLimitError,
  startPreview,
} from './previews';
import type { ProgressEvent } from './progress';
import { parseJobRequest } from './validate';

export const app = new Hono();

const MAX_API_BODY_BYTES = 16 * 1024;

app.use('/api/*', async (c, next) => {
  if (c.req.method !== 'POST') return next();

  const origin = c.req.header('origin');
  const host = c.req.header('host');
  if (origin && (!host || !hasSameHost(origin, host))) {
    return c.json({ error: 'cross-origin requests are not allowed' }, 403);
  }
  if (c.req.header('sec-fetch-site') === 'cross-site') {
    return c.json({ error: 'cross-origin requests are not allowed' }, 403);
  }

  const contentType = c.req.header('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && !contentType?.endsWith('+json')) {
    return c.json({ error: 'content-type must be application/json' }, 415);
  }

  const contentLength = Number(c.req.header('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_API_BODY_BYTES) {
    return c.json({ error: 'request body is too large' }, 413);
  }
  return next();
});

function hasSameHost(origin: string, host: string): boolean {
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

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
    const metadata = await fetchVideoMetadata(parsed.value.url);
    return c.json(metadata);
  } catch (err) {
    if (err instanceof MetadataError) {
      return c.json({ error: err.message }, 502);
    }
    throw err;
  }
});

app.post('/api/previews', async (c) => {
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
    const preview = await startPreview(parsed.value.url);
    return c.json(previewStatusBody(preview), preview.status === 'done' ? 200 : 202);
  } catch (err) {
    if (err instanceof PreviewLimitError) {
      return c.json({ error: err.message }, 429);
    }
    throw err;
  }
});

app.get('/api/previews/:id', (c) => {
  const preview = getPreview(c.req.param('id'));
  if (!preview) {
    return c.json({ error: 'no such preview' }, 404);
  }
  return c.json(previewStatusBody(preview));
});

app.get('/api/previews/:id/source', async (c) => {
  const preview = getPreview(c.req.param('id'));
  if (!preview) {
    return c.json({ error: 'no such preview' }, 404);
  }
  if (preview.status !== 'done' || !preview.sourcePath) {
    return c.json({ error: 'preview is not ready' }, 409);
  }
  let size: number;
  try {
    ({ size } = await stat(preview.sourcePath));
  } catch {
    return c.json({ error: 'preview no longer available' }, 410);
  }
  const range = parseRange(c.req.header('range'), size);
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${size}` },
    });
  }
  const headers: Record<string, string> = {
    'Content-Type': videoContentType(preview.sourcePath),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };
  const streamOptions: { start?: number; end?: number } = {};
  let status = 200;
  if (range) {
    status = 206;
    streamOptions.start = range.start;
    streamOptions.end = range.end;
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
    headers['Content-Length'] = String(range.end - range.start + 1);
  } else {
    headers['Content-Length'] = String(size);
  }
  const fileStream = createReadStream(preview.sourcePath, streamOptions);
  fileStream.once('error', (err) => {
    console.error(`preview source stream error for preview ${preview.id}:`, err);
    fileStream.destroy();
  });
  return new Response(Readable.toWeb(fileStream) as ReadableStream, { status, headers });
});

app.get('/api/previews/:id/sprite', async (c) => {
  const preview = getPreview(c.req.param('id'));
  if (!preview) {
    return c.json({ error: 'no such preview' }, 404);
  }
  if (preview.status !== 'done' || !preview.spritePath) {
    return c.json({ error: 'preview is not ready' }, 409);
  }
  let size: number;
  try {
    ({ size } = await stat(preview.spritePath));
  } catch {
    return c.json({ error: 'preview no longer available' }, 410);
  }
  const fileStream = createReadStream(preview.spritePath);
  fileStream.once('error', (err) => {
    console.error(`preview stream error for preview ${preview.id}:`, err);
    fileStream.destroy();
  });
  return new Response(Readable.toWeb(fileStream) as ReadableStream, {
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(size),
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

type ByteRange = { start: number; end: number };

function parseRange(header: string | undefined, size: number): ByteRange | 'invalid' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return 'invalid';
  const [, startText, endText] = match;
  if (!startText && !endText) return 'invalid';

  let start: number;
  let end: number;
  if (!startText) {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return 'invalid';
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(startText);
    end = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return 'invalid';
  }

  if (start < 0 || end < start || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

function videoContentType(filePath: string): string {
  const extension = extname(filePath).toLowerCase();
  if (extension === '.mp4' || extension === '.m4v') return 'video/mp4';
  if (extension === '.webm') return 'video/webm';
  if (extension === '.mov') return 'video/quicktime';
  if (extension === '.mkv') return 'video/x-matroska';
  return 'application/octet-stream';
}

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
      void stream
        .writeSSE({ event: 'progress', data: JSON.stringify(progress) })
        .catch(finish);
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
  let fullyRead = false;
  fileStream.once('end', () => {
    fullyRead = true;
  });
  fileStream.once('close', () => {
    if (fullyRead) {
      void deleteJob(job.id).catch((err) => {
        console.error(`failed to clean delivered job ${job.id}:`, err);
      });
    }
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
