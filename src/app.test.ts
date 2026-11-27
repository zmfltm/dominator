import { describe, expect, it } from 'vitest';
import { app, isAllowedHost, parseAllowedHosts } from './app';
import { MAX_UPLOAD_BYTES } from './compress';

// Every request needs an allowed Host header, as a real client always sends.
function request(input: string | Request, init: RequestInit = {}): Response | Promise<Response> {
  const source = input instanceof Request ? input : undefined;
  const headers = new Headers(source?.headers ?? init.headers);
  if (!headers.has('host')) headers.set('host', '127.0.0.1:3000');
  return source
    ? app.request(new Request(source, { headers }))
    : app.request(input, { ...init, headers });
}

function postJob(body: string): Response | Promise<Response> {
  return request('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/metadata', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await request('/api/metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs before spawning metadata lookup', async () => {
    const res = await request('/api/metadata', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/v' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachment URLs are supported',
    );
  });
});

describe('POST /api/soundcloud', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await request('/api/soundcloud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects non-SoundCloud URLs before spawning yt-dlp', async () => {
    const res = await request('/api/soundcloud', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://youtu.be/x' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('only SoundCloud URLs can be expanded here');
  });
});

describe('POST /api/previews', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await request('/api/previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs before starting a preview', async () => {
    const res = await request('/api/previews', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/v' }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachment URLs are supported',
    );
  });
});

describe('POST /api/jobs', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('rejects unsupported URLs with a readable message', async () => {
    const res = await postJob(JSON.stringify({ url: 'https://example.com/v', format: 'mp4' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(
      'only YouTube, Twitter/X, Instagram, TikTok, Reddit, SoundCloud, and Discord audio attachment URLs are supported',
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

describe('Host header allowlist', () => {
  it('allows loopback hosts on any port', () => {
    for (const host of ['localhost', 'localhost:3000', '127.0.0.1:8080', '[::1]', '[::1]:3000', 'LOCALHOST']) {
      expect(isAllowedHost(host, new Set())).toBe(true);
    }
  });

  it('allows Tailscale ts.net names', () => {
    expect(isAllowedHost('my-box.tail1234.ts.net', new Set())).toBe(true);
    expect(isAllowedHost('my-box.tail1234.ts.net:3000', new Set())).toBe(true);
  });

  it('rejects other and malformed hosts', () => {
    for (const host of [undefined, '', 'evil.example', 'evil.example:3000', '127.0.0.1.evil.example', 'localhost@evil', '::1', 'ts.net.evil.example', 'evilts.net']) {
      expect(isAllowedHost(host, new Set())).toBe(false);
    }
  });

  it('allows hosts from DOMINATOR_ALLOWED_HOSTS', () => {
    const extra = parseAllowedHosts(' Dl.Example.com, ,other.example ');
    expect([...extra]).toEqual(['dl.example.com', 'other.example']);
    expect(isAllowedHost('dl.example.com:443', extra)).toBe(true);
    expect(isAllowedHost('evil.example', extra)).toBe(false);
  });

  it.each(['/', '/api/jobs/nope/events', '/api/jobs/nope/file'])('rejects GET %s with a rebinding Host', async (path) => {
    const res = await app.request(path, { headers: { host: 'rebind.attacker.example:3000' } });
    expect(res.status).toBe(403);
  });

  it('rejects requests with no Host header', async () => {
    const res = await app.request('/api/jobs/nope/file');
    expect(res.status).toBe(403);
  });
});

describe('API request security', () => {
  it('rejects simple cross-origin POST bodies before starting work', async () => {
    const res = await request('/api/jobs', {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        origin: 'https://attacker.example',
        host: '127.0.0.1:3000',
      },
      body: JSON.stringify({ url: 'https://youtu.be/x', format: 'mp4' }),
    });
    expect(res.status).toBe(403);
  });

  it('requires JSON content for POST endpoints', async () => {
    const res = await request('/api/metadata', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ url: 'https://youtu.be/x' }),
    });
    expect(res.status).toBe(415);
  });

  it.each([false, true])('limits actual body bytes without Content-Length (chunked: %s)', async (chunked) => {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (chunked) headers.set('transfer-encoding', 'chunked');
    const res = await request('/api/jobs', {
      method: 'POST',
      headers,
      body: JSON.stringify({ url: 'x'.repeat(20 * 1024), format: 'mp3' }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe('request body is too large');
  });

  it('rejects oversized API bodies', async () => {
    const res = await request('/api/jobs', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(20 * 1024),
      },
      body: '{}',
    });
    expect(res.status).toBe(413);
  });
});

describe('job lookup', () => {
  it('404s on events for unknown jobs', async () => {
    const res = await request('/api/jobs/nope/events');
    expect(res.status).toBe(404);
  });

  it('404s on file for unknown jobs', async () => {
    const res = await request('/api/jobs/nope/file');
    expect(res.status).toBe(404);
  });

  it('404s on cancel for unknown jobs', async () => {
    const res = await request('/api/jobs/nope', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('404s on status for unknown previews', async () => {
    const res = await request('/api/previews/nope');
    expect(res.status).toBe(404);
  });

  it('404s on sprite for unknown previews', async () => {
    const res = await request('/api/previews/nope/sprite');
    expect(res.status).toBe(404);
  });

  it('404s on source video for unknown previews', async () => {
    const res = await request('/api/previews/nope/source');
    expect(res.status).toBe(404);
  });
});

describe('Discord message links', () => {
  it.each(['/api/jobs', '/api/metadata', '/api/previews'])('rejects message URLs at %s before starting work', async (path) => {
    const response = await request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://discord.com/channels/352908185511788554/835522047874433074/1552815306844536882',
        format: 'mp3',
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('copy the audio attachment link');
  });
});

describe('POST /api/compress', () => {
  const octet = { 'content-type': 'application/octet-stream' };

  it('rejects cross-origin uploads', async () => {
    const res = await request('/api/compress?name=a.mp4', {
      method: 'POST',
      headers: { ...octet, origin: 'https://attacker.example', host: '127.0.0.1:3000' },
      body: 'x',
    });
    expect(res.status).toBe(403);
  });

  it('rejects cross-site fetches', async () => {
    const res = await request('/api/compress?name=a.mp4', {
      method: 'POST',
      headers: { ...octet, 'sec-fetch-site': 'cross-site' },
      body: 'x',
    });
    expect(res.status).toBe(403);
  });

  it('requires application/octet-stream', async () => {
    const res = await request('/api/compress?name=a.mp4', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('requires a file name', async () => {
    const res = await request('/api/compress', {
      method: 'POST',
      headers: octet,
      body: 'x',
    });
    expect(res.status).toBe(400);
    const blank = await request('/api/compress?name=%20', {
      method: 'POST',
      headers: octet,
      body: 'x',
    });
    expect(blank.status).toBe(400);
  });

  it('rejects invalid compress menu options', async () => {
    const res = await request('/api/compress?name=a.mp4&quality=invalid', {
      method: 'POST',
      headers: octet,
      body: 'x',
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('quality');
  });

  it('rejects a Content-Length over the upload cap before reading', async () => {
    const res = await request('/api/compress?name=a.mp4', {
      method: 'POST',
      headers: { ...octet, 'content-length': String(MAX_UPLOAD_BYTES + 1) },
      body: 'x',
    });
    expect(res.status).toBe(413);
  });

  it('rejects an empty body', async () => {
    const res = await request('/api/compress?name=a.mp4', {
      method: 'POST',
      headers: octet,
    });
    expect(res.status).toBe(400);
  });

  it('cancels the job when the client disconnects before the response', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await request(new Request('http://localhost/api/compress?name=a.mp4', {
      method: 'POST',
      headers: octet,
      body: 'not media',
      signal: controller.signal,
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('upload did not finish');
  });

  it('still limits the size of JSON bodies on other routes', async () => {
    const res = await request('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'x'.repeat(20 * 1024), format: 'mp3' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('static asset cache headers', () => {
  it('sets no-cache on the root page and does not cache missing font 404s', async () => {
    const root = await request('/');
    expect(root.status).toBe(200);
    expect(root.headers.get('cache-control')).toBe('no-cache');

    const missingFont = await request('/fonts/does-not-exist.woff2');
    expect(missingFont.status).toBe(404);
    expect(missingFont.headers.get('cache-control')).toBeNull();
  });
});
