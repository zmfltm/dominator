import { describe, expect, it } from 'vitest';
import { app } from './app';

function postJob(body: string): Response | Promise<Response> {
  return app.request('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/metadata', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await app.request('/api/metadata', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs before spawning metadata lookup', async () => {
    const res = await app.request('/api/metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/v' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, and Reddit URLs are supported',
    );
  });
});

describe('POST /api/previews', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await app.request('/api/previews', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs before starting a preview', async () => {
    const res = await app.request('/api/previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/v' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, and Reddit URLs are supported',
    );
  });
});

describe('POST /api/jobs', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await app.request('/api/jobs', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs with a readable message', async () => {
    const res = await postJob(JSON.stringify({ url: 'https://example.com/v', format: 'mp4' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, and Reddit URLs are supported',
    );
  });

  it('rejects unknown formats', async () => {
    const res = await postJob(JSON.stringify({ url: 'https://youtu.be/x', format: 'flac' }));
    expect(res.status).toBe(400);
  });

  it('rejects invalid clip ranges before starting a job', async () => {
    const res = await postJob(
      JSON.stringify({ url: 'https://youtu.be/x', format: 'mp4', clip: { start: 60, end: 10 } }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('clip end must be after start');
  });
});

describe('job lookup', () => {
  it('404s on events for unknown jobs', async () => {
    const res = await app.request('/api/jobs/nope/events');
    expect(res.status).toBe(404);
  });

  it('404s on file for unknown jobs', async () => {
    const res = await app.request('/api/jobs/nope/file');
    expect(res.status).toBe(404);
  });

  it('404s on cancel for unknown jobs', async () => {
    const res = await app.request('/api/jobs/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('404s on status for unknown previews', async () => {
    const res = await app.request('/api/previews/nope');
    expect(res.status).toBe(404);
  });

  it('404s on sprite for unknown previews', async () => {
    const res = await app.request('/api/previews/nope/sprite');
    expect(res.status).toBe(404);
  });

  it('404s on source video for unknown previews', async () => {
    const res = await app.request('/api/previews/nope/source');
    expect(res.status).toBe(404);
  });
});
