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
      'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported',
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
      'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported',
    );
  });

  it('rejects unknown formats', async () => {
    const res = await postJob(JSON.stringify({ url: 'https://youtu.be/x', format: 'flac' }));
    expect(res.status).toBe(400);
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
});
