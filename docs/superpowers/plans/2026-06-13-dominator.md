# dominator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local-only video downloader for YouTube, Twitter/X, Instagram, and TikTok (public posts only): minimal black single page, paste URL, MP4/MP3 toggle, progress bar, file lands in the browser's Downloads.

**Architecture:** One Hono (Node) server bound to 127.0.0.1:3000. It serves a single static HTML page and spawns the `yt-dlp` binary per job into a per-job temp dir. Progress streams to the browser over SSE; the finished file is fetched as a normal browser download, then the temp dir is deleted.

**Tech Stack:** TypeScript, Hono + @hono/node-server, tsx (runtime), Vitest (tests), yt-dlp + ffmpeg (external binaries, checked at startup).

**Spec:** `docs/superpowers/specs/2026-06-13-dominator-design.md`

## Execution status (saved 2026-06-13, session paused)

Executing via subagent-driven development: per task, one implementer subagent,
then a spec-compliance review, then a code-quality review. Working directly on
main, local only, nothing pushed.

- Task 1 scaffolding: DONE, commit f210a81, both reviews passed.
- Task 2 validate.ts: DONE, commit 5f1ebf4, both reviews passed. Reviewer
  suggestions declined on purpose: keep http allowed (spec says http or https),
  no URL canonicalization (hostname allowlist plus spawn '--' already confine it).
- Task 3 progress.ts: DONE, commit 65d927c, both reviews passed with accepted
  follow-ups NOT yet applied. Next session, before Task 4, have the implementer:
  1. Add a comment on PROCESSING_RE that 'VideoConvertor' matches yt-dlp's
     actual upstream spelling and must not be "corrected" to VideoConverter.
  2. Add two test fixtures: a '[FixupDuration] ...' line expecting
     {stage:'processing'} and a '[download]   0.1% of ~183.14MiB ...' line
     expecting {stage:'downloading', percent: 0.1}.
  Declined on purpose: Math.min(100) percent clamp (value comes from yt-dlp's
  own format; consumer is a CSS width capped by its container).
- Tasks 4 through 8: not started. Resume at the Task 3 follow-ups, then Task 4.

Current state verified: pnpm test 15/15 passing, pnpm typecheck clean.

### Update 2026-06-13 (second session)

- Task 3 follow-ups: DONE, commit cc3a71f, re-reviewed spec compliant.
- Task 4 jobs.ts: DONE, commit 7b3f8d3, both reviews passed. Quality review
  noted three Minor items (signal-kill message, files[0] single-file
  assumption, sweep-only-at-startup comment); declined to keep the
  plan-specified code as written for this local tool.
- Task 5 app.ts: DONE, commit 96a864d, spec review passed (one justified
  deviation: postJob return type must be `Response | Promise<Response>` to
  match Hono's app.request; empirically verified the plan's `Promise<Response>`
  fails typecheck). Quality review returned Changes needed; fixes captured as
  Task 5a below.
- Scope amendment (user approved): support Twitter/X, Instagram, and TikTok in
  addition to YouTube, public posts only, no cookie/login support. Spec
  amended. Captured as Task 5b below; Task 7 placeholder copy and Task 8
  README copy adjusted in place.
- Remaining order: Task 5a, Task 5b, Task 6, Task 7, Task 8.

### Completion (2026-06-13, second session)

All tasks DONE; project complete. Commits: 5a 6c7a6b8, 5b d94cd33, 6 7f8d930,
7 939821f + fix 4fb101a (fetch try/catch, JSON.parse guard; both Important
findings from the Task 7 quality review), 8 8d60283. Every task passed spec
compliance and code quality review; a final whole-project review returned
"ready to ship" with zero code changes required.

Declined across reviews, on purpose: failed-job entries staying in the jobs
map (negligible for a single-user tool; events/file endpoints behave
correctly for them), files[0] single-output assumption, t.co short-link host
(generic redirector, conflicts with the closed-allowlist decision), signal-
kill message wording, sweep-at-startup comment, UI mode-name shown for an
in-flight job after toggling, sub-RTT double-submit window.

Smoke test (headless via curl; yt-dlp 2026.06.09 and static ffmpeg 7.0.2 were
installed to ~/.local/bin during this session): YouTube mp4 and mp3 and a
public TikTok mp4 all downloaded end to end with correct Content-Disposition
filenames; unsupported host rejected 400; temp dirs empty afterwards; server
stopped cleanly. Not live-tested: Twitter/X and Instagram URLs (allowlist
accepts them; extractor success depends on the post), and the browser UI
click-through, which remains for the user.

### Follow-up (2026-06-13, third session)

Added a periodic stale-job reaper for abandoned completed downloads and old
failed-job map entries, with pure tests for the staleness predicate. Verified
with `pnpm test`, `pnpm typecheck`, and a headless startup/API curl smoke test.

### Hosting hardening follow-up (2026-06-13)

For personal Cloudflare Tunnel hosting, added a max of 7 running/starting jobs
and a cancel path: `DELETE /api/jobs/:id`, a `canceled` SSE event, yt-dlp
termination, temp-dir cleanup, and a cancel button in the UI. Verified with
`pnpm test` and `pnpm typecheck`.

### UI refinement follow-up (2026-06-13)

Removed themed/cringe status copy and old labels. Added a queue-first UI that
can stage multiple URLs before downloading, clears the input after queueing,
shows download by default and enables it when the input has a URL or queued
rows exist, shows add only while the input has text, replaces cancel with a clear button
below the list, tightens queue-row spacing, enlarges URL text, shows tiny
monochrome source icons per queued URL, offers `convert to mp3` on completed
rows, uses the user-provided tiny centered logo, and vendors Ioskeley Mono
under `public/fonts/`. Added root `AGENTS.md` as the current agent reference
file.

### Metadata/title follow-up (2026-06-13)

Added `POST /api/metadata` to fetch video titles with yt-dlp before download,
updated queue rows to show fetched titles with URL fallback, left the input
placeholder blank, enlarged the overall font slightly, tightened button/input
spacing, made the logo larger and higher, fixed the centered input in place
so queued rows grow downward without moving it, made queued rows more compact,
let long titles wrap across the full row, added compact per-row x remove
buttons that cancel only that row after download starts and do not start queued downloads,
added compact per-row down-arrow buttons for parallel single-file starts, made canceled rows
retryable through the main download button, removed the global queued-count
status, made add visually distinct from download, fixed the download button width, added an outside-left borderless
clear icon for the URL input, added hold/double-tap Backspace clear behavior,
added a cancel button for active plus queued downloads, added downloaded and
total size next to running percentages when yt-dlp reports a total, and kept
errors as yt-dlp reports them when metadata or extraction fails.

## File structure

```
dominator/
├── public/index.html      # entire UI, no build step
├── src/validate.ts        # pure: request body + YouTube URL validation
├── src/validate.test.ts
├── src/progress.ts        # pure: yt-dlp progress line parser
├── src/progress.test.ts
├── src/jobs.ts            # job map, temp dirs, yt-dlp subprocess lifecycle
├── src/app.ts             # Hono app: POST /api/jobs, SSE events, file delivery
├── src/app.test.ts
├── src/server.ts          # entry: binary checks, temp sweep, listen
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

Conventions: single quotes, semicolons, 2-space indent, no em-dashes anywhere
(code, comments, UI copy, commits).

---

### Task 1: Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "dominator",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "tsx src/server.ts",
    "dev": "tsx watch src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.14.0",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

`moduleResolution: "Bundler"` lets imports stay extensionless, which both tsx
and Vitest handle natively. `noEmit` because tsx runs TS directly; tsc is
typecheck-only.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
*.log
```

- [ ] **Step 4: Install and verify**

Run: `pnpm install`
Expected: lockfile created, no errors.

Run: `pnpm typecheck`
Expected: exits 0 (no source files yet is fine; tsc allows an empty include).
If tsc errors with "No inputs were found", that is acceptable at this step;
it disappears in Task 2.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold node project"
```

---

### Task 2: URL and request validation (`validate.ts`)

**Files:**
- Test: `src/validate.test.ts`
- Create: `src/validate.ts`

- [ ] **Step 1: Write the failing tests**

`src/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseJobRequest } from './validate';

describe('parseJobRequest', () => {
  it('accepts a standard watch URL with mp4', () => {
    const result = parseJobRequest({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      format: 'mp4',
    });
    expect(result).toEqual({
      ok: true,
      value: { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', format: 'mp4' },
    });
  });

  it('accepts youtu.be short links with mp3', () => {
    const result = parseJobRequest({
      url: 'https://youtu.be/dQw4w9WgXcQ?si=abc',
      format: 'mp3',
    });
    expect(result.ok).toBe(true);
  });

  it('accepts music.youtube.com and m.youtube.com', () => {
    expect(
      parseJobRequest({ url: 'https://music.youtube.com/watch?v=x', format: 'mp3' }).ok,
    ).toBe(true);
    expect(
      parseJobRequest({ url: 'https://m.youtube.com/watch?v=x', format: 'mp4' }).ok,
    ).toBe(true);
  });

  it('rejects non-YouTube hosts', () => {
    const result = parseJobRequest({ url: 'https://vimeo.com/12345', format: 'mp4' });
    expect(result).toEqual({ ok: false, error: 'only YouTube URLs are supported' });
  });

  it('rejects lookalike hosts', () => {
    const result = parseJobRequest({
      url: 'https://youtube.com.evil.example/watch?v=x',
      format: 'mp4',
    });
    expect(result.ok).toBe(false);
  });

  it('rejects non-http(s) schemes', () => {
    const result = parseJobRequest({ url: 'file:///etc/passwd', format: 'mp4' });
    expect(result.ok).toBe(false);
  });

  it('rejects strings that are not URLs', () => {
    const result = parseJobRequest({ url: 'not a url', format: 'mp4' });
    expect(result).toEqual({ ok: false, error: 'not a valid URL' });
  });

  it('rejects unknown formats', () => {
    const result = parseJobRequest({ url: 'https://youtu.be/x', format: 'wav' });
    expect(result).toEqual({ ok: false, error: "format must be 'mp4' or 'mp3'" });
  });

  it('rejects non-object bodies', () => {
    expect(parseJobRequest(null).ok).toBe(false);
    expect(parseJobRequest('hi').ok).toBe(false);
    expect(parseJobRequest(undefined).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL, cannot resolve `./validate`.

- [ ] **Step 3: Write the implementation**

`src/validate.ts`:

```ts
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

export type Format = 'mp4' | 'mp3';

export interface JobRequest {
  url: string;
  format: Format;
}

export type ParseResult =
  | { ok: true; value: JobRequest }
  | { ok: false; error: string };

export function parseJobRequest(body: unknown): ParseResult {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'request body must be a JSON object' };
  }
  const { url, format } = body as Record<string, unknown>;
  if (format !== 'mp4' && format !== 'mp3') {
    return { ok: false, error: "format must be 'mp4' or 'mp3'" };
  }
  if (typeof url !== 'string') {
    return { ok: false, error: 'url must be a string' };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'url must be http or https' };
  }
  if (!YOUTUBE_HOSTS.has(parsed.hostname)) {
    return { ok: false, error: 'only YouTube URLs are supported' };
  }
  return { ok: true, value: { url, format } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all validate tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/validate.ts src/validate.test.ts
git commit -m "feat: validate job requests against youtube host allowlist"
```

---

### Task 3: Progress line parser (`progress.ts`)

yt-dlp with `--progress --newline` emits lines like
`[download]  42.3% of    5.43MiB at  1.23MiB/s ETA 00:03` while downloading,
and lines like `[Merger] Merging formats into "..."` or
`[ExtractAudio] Destination: ...` while post-processing with ffmpeg. The
parser turns each line into a progress event or null.

**Files:**
- Test: `src/progress.test.ts`
- Create: `src/progress.ts`

- [ ] **Step 1: Write the failing tests**

`src/progress.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseProgressLine } from './progress';

describe('parseProgressLine', () => {
  it('parses a mid-download line', () => {
    const line = '[download]  42.3% of    5.43MiB at  1.23MiB/s ETA 00:03';
    expect(parseProgressLine(line)).toEqual({ stage: 'downloading', percent: 42.3 });
  });

  it('parses a completed download line', () => {
    const line = '[download] 100% of 5.43MiB in 00:04';
    expect(parseProgressLine(line)).toEqual({ stage: 'downloading', percent: 100 });
  });

  it('treats merger lines as processing', () => {
    const line = '[Merger] Merging formats into "/tmp/dominator-x/video.mp4"';
    expect(parseProgressLine(line)).toEqual({ stage: 'processing' });
  });

  it('treats audio extraction lines as processing', () => {
    const line = '[ExtractAudio] Destination: /tmp/dominator-x/audio.mp3';
    expect(parseProgressLine(line)).toEqual({ stage: 'processing' });
  });

  it('ignores download lines without a percent', () => {
    expect(parseProgressLine('[download] Destination: /tmp/x.mp4')).toBeNull();
  });

  it('ignores unrelated yt-dlp output', () => {
    expect(parseProgressLine('[youtube] dQw4w9WgXcQ: Downloading webpage')).toBeNull();
    expect(parseProgressLine('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL, cannot resolve `./progress`.

- [ ] **Step 3: Write the implementation**

`src/progress.ts`:

```ts
export type ProgressEvent =
  | { stage: 'downloading'; percent: number }
  | { stage: 'processing' };

const DOWNLOAD_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%/;
const PROCESSING_RE = /^\[(Merger|ExtractAudio|VideoConvertor|Fixup\w+)\]/;

export function parseProgressLine(line: string): ProgressEvent | null {
  const trimmed = line.trim();
  const download = DOWNLOAD_RE.exec(trimmed);
  if (download) {
    return { stage: 'downloading', percent: Number(download[1]) };
  }
  if (PROCESSING_RE.test(trimmed)) {
    return { stage: 'processing' };
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all progress tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/progress.ts src/progress.test.ts
git commit -m "feat: parse yt-dlp progress output"
```

---

### Task 4: Job lifecycle (`jobs.ts`)

In-memory job map plus yt-dlp subprocess management. No direct unit tests
(the spec scopes testing to the pure modules and endpoint validation); it is
covered by typecheck, the app tests importing it, and the manual smoke test.

Two non-obvious decisions, keep them as written:

1. The failure event is named `failed`, never `error`. A Node `EventEmitter`
   that emits `'error'` with no listener attached throws and would crash the
   server.
2. `spawn` always gets an args array and the URL goes after `--`. The URL can
   never be interpreted by a shell or as a yt-dlp flag.

**Files:**
- Create: `src/jobs.ts`

- [ ] **Step 1: Write the implementation**

`src/jobs.ts`:

```ts
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseProgressLine, type ProgressEvent } from './progress';
import type { JobRequest } from './validate';

export const TEMP_PREFIX = 'dominator-';

export interface Job {
  id: string;
  dir: string;
  status: 'running' | 'done' | 'error';
  filePath?: string;
  error?: string;
  events: EventEmitter;
  lastProgress: ProgressEvent | null;
}

const jobs = new Map<string, Job>();

const FORMAT_ARGS: Record<JobRequest['format'], string[]> = {
  mp4: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]'],
  mp3: ['-x', '--audio-format', 'mp3', '--audio-quality', '0'],
};

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export async function startJob(request: JobRequest): Promise<Job> {
  const dir = await mkdtemp(join(tmpdir(), TEMP_PREFIX));
  const job: Job = {
    id: randomUUID(),
    dir,
    status: 'running',
    events: new EventEmitter(),
    lastProgress: null,
  };
  jobs.set(job.id, job);

  const args = [
    ...FORMAT_ARGS[request.format],
    '--no-playlist',
    '--progress',
    '--newline',
    '-o',
    join(dir, '%(title)s.%(ext)s'),
    '--',
    request.url,
  ];
  const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });

  let pending = '';
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      const progress = parseProgressLine(line);
      if (progress) {
        job.lastProgress = progress;
        job.events.emit('progress', progress);
      }
    }
  });

  child.on('error', (err) => {
    failJob(job, `failed to start yt-dlp: ${err.message}`);
  });

  child.on('close', async (code) => {
    if (job.status !== 'running') return;
    if (code !== 0) {
      failJob(job, extractError(stderr) ?? `yt-dlp exited with code ${code}`);
      return;
    }
    try {
      const files = await readdir(job.dir);
      if (files.length === 0) {
        failJob(job, 'yt-dlp finished but produced no file');
        return;
      }
      job.filePath = join(job.dir, files[0]);
      job.status = 'done';
      job.events.emit('done');
    } catch (err) {
      failJob(job, `could not read output: ${(err as Error).message}`);
    }
  });

  return job;
}

export async function deleteJob(id: string): Promise<void> {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  await rm(job.dir, { recursive: true, force: true });
}

export async function sweepLeftoverDirs(): Promise<void> {
  const base = tmpdir();
  const entries = await readdir(base);
  await Promise.all(
    entries
      .filter((name) => name.startsWith(TEMP_PREFIX))
      .map((name) => rm(join(base, name), { recursive: true, force: true })),
  );
}

function failJob(job: Job, message: string): void {
  job.status = 'error';
  job.error = message;
  job.events.emit('failed', message);
  void rm(job.dir, { recursive: true, force: true });
}

function extractError(stderr: string): string | undefined {
  const errorLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));
  return errorLines.at(-1)?.replace(/^ERROR:\s*/, '');
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/jobs.ts
git commit -m "feat: manage yt-dlp download jobs with temp dirs"
```

---

### Task 5: HTTP endpoints (`app.ts`)

**Files:**
- Test: `src/app.test.ts`
- Create: `src/app.ts`

- [ ] **Step 1: Write the failing tests**

These cover the validation and not-found paths only. No test spawns yt-dlp;
every request below is rejected before any subprocess starts.

`src/app.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { app } from './app';

function postJob(body: string): Promise<Response> {
  return app.request('/api/jobs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('POST /api/jobs', () => {
  it('rejects bodies that are not JSON', async () => {
    const res = await app.request('/api/jobs', { method: 'POST', body: 'not json' });
    expect(res.status).toBe(400);
  });

  it('rejects non-YouTube URLs with a readable message', async () => {
    const res = await postJob(JSON.stringify({ url: 'https://example.com/v', format: 'mp4' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('only YouTube URLs are supported');
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL, cannot resolve `./app`.

- [ ] **Step 3: Write the implementation**

The SSE handler replays the latest known state on connect (covers a browser
reconnect mid-job), then follows live emitter events. The SSE failure event is
named `failed` on the wire too, because the browser `EventSource` fires its
built-in `error` event for connection drops and overloading the name would
conflate the two.

`src/app.ts`:

```ts
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { deleteJob, getJob, startJob, type Job } from './jobs';
import type { ProgressEvent } from './progress';
import { parseJobRequest } from './validate';

export const app = new Hono();

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
  const job = await startJob(parsed.value);
  return c.json({ jobId: job.id }, 201);
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
      void stream.writeSSE({ event: 'done', data: 'done' }).then(finish);
    };
    const onFailed = (message: string) => {
      void stream.writeSSE({ event: 'failed', data: message }).then(finish);
    };
    function finish() {
      job.events.off('progress', onProgress);
      job.events.off('done', onDone);
      job.events.off('failed', onFailed);
      resolve();
    }
    job.events.on('progress', onProgress);
    job.events.once('done', onDone);
    job.events.once('failed', onFailed);
    stream.onAbort(finish);
  });
}

app.get('/api/jobs/:id/file', async (c) => {
  const job = getJob(c.req.param('id'));
  if (!job) {
    return c.json({ error: 'no such job' }, 404);
  }
  if (job.status !== 'done' || !job.filePath) {
    return c.json({ error: 'job is not finished' }, 409);
  }
  const { size } = await stat(job.filePath);
  const filename = basename(job.filePath);
  const asciiName = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  const fileStream = createReadStream(job.filePath);
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test`
Expected: all tests PASS (validate, progress, app).

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/app.test.ts
git commit -m "feat: add job, sse, and file delivery endpoints"
```

---

### Task 5a: Review fixes for `app.ts`

Accepted findings from the Task 5 code-quality review. All changes are in the
`/api/jobs/:id/file` handler and `followJob`.

Declined on purpose: changing the test helper `postJob` return type back to
`Promise<Response>` (Hono's `app.request` is typed `Response | Promise<Response>`;
the narrower type fails typecheck, verified empirically).

**Files:**
- Modify: `src/app.ts`

- [ ] **Step 1: Guard the file handler against a vanished file**

Wrap the `stat` call so a file deleted between job completion and the request
returns a structured 410 instead of an unhandled rejection:

```ts
let size: number;
try {
  ({ size } = await stat(job.filePath));
} catch {
  return c.json({ error: 'file no longer available' }, 410);
}
```

- [ ] **Step 2: Handle read-stream errors**

An unhandled `'error'` event on a Node stream throws and kills the process.
After creating `fileStream`, add:

```ts
fileStream.once('error', (err) => {
  console.error(`file stream error for job ${job.id}:`, err);
  fileStream.destroy();
});
```

- [ ] **Step 3: Make SSE listener cleanup unconditional**

In `followJob`, `void stream.writeSSE(...).then(finish)` skips `finish` if the
write rejects, leaking listeners. Change both terminal writes to
`.then(finish, finish)`.

- [ ] **Step 4: Strip semicolons from the ASCII filename fallback**

A title containing `;` makes compliant parsers misread the
`Content-Disposition` parameter list. Extend the sanitizer:

```ts
const asciiName = filename
  .replace(/[^\x20-\x7e]/g, '_')
  .replace(/[";]/g, "'");
```

(Replacing `;` with `'` alongside `"` is fine; `filename*` carries the real
name.)

- [ ] **Step 5: Verify and commit**

Run: `pnpm test` (expect 22 passing) and `pnpm typecheck` (exit 0).

```bash
git add src/app.ts
git commit -m "fix: harden file delivery and sse cleanup paths"
```

---

### Task 5b: Multi-site support (Twitter/X, Instagram, TikTok)

User-approved scope amendment: accept Twitter/X, Instagram, and TikTok URLs in
addition to YouTube. Public posts only; no cookie or login support. Gated
content fails with yt-dlp's error, which already reaches the UI.

**Files:**
- Modify: `src/validate.test.ts`
- Modify: `src/validate.ts`
- Modify: `src/app.test.ts`
- Modify: `src/jobs.ts`

- [ ] **Step 1: Update the failing tests first**

In `src/validate.test.ts`:
- Add accepted cases (mirror the existing accepted-case style):
  - `https://twitter.com/user/status/123` (mp4)
  - `https://x.com/user/status/123` (mp4)
  - `https://www.instagram.com/reel/abc123/` (mp4)
  - `https://www.tiktok.com/@user/video/123` (mp4)
  - `https://vm.tiktok.com/ZMabcdef/` (mp3)
- Change the expected rejection message in the non-YouTube-hosts test (vimeo
  case) to `'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported'`
  and rename that test to `rejects unsupported hosts`.
- Keep the lookalike test and add one more lookalike:
  `https://tiktok.com.evil.example/v` expecting `ok: false`.

In `src/app.test.ts`, the readable-message test asserts the old string; update
it to the new message.

Run: `pnpm test`. Expected: new/changed cases FAIL against current code.

- [ ] **Step 2: Widen the allowlist**

In `src/validate.ts`, rename `YOUTUBE_HOSTS` to `ALLOWED_HOSTS` and set:

```ts
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'x.com',
  'www.x.com',
  'instagram.com',
  'www.instagram.com',
  'm.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
]);
```

Change the rejection message to
`'only YouTube, Twitter/X, Instagram, and TikTok URLs are supported'`.

- [ ] **Step 3: Loosen the MP4 format selector**

In `src/jobs.ts`, the selector is YouTube-tuned and can match nothing on sites
that serve one combined file. Append a final `/b` fallback:

```ts
mp4: ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b'],
```

Worst case the fallback delivers a non-mp4 container named honestly by its
real extension. MP3 mode needs no change.

- [ ] **Step 4: Verify and commit**

Run: `pnpm test` (expect all passing; 25 total, since some URL fixtures share
an it-block) and `pnpm typecheck` (exit 0).

```bash
git add src/validate.ts src/validate.test.ts src/app.test.ts src/jobs.ts
git commit -m "feat: support twitter, instagram, and tiktok urls"
```

---

### Task 6: Server entry (`server.ts`)

**Files:**
- Create: `src/server.ts`

- [ ] **Step 1: Write the implementation**

`src/server.ts`:

```ts
import { serve } from '@hono/node-server';
import { spawnSync } from 'node:child_process';
import { app } from './app';
import { sweepLeftoverDirs } from './jobs';

function checkBinary(name: string, versionArgs: string[]): void {
  const result = spawnSync(name, versionArgs, { stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    console.error(
      `dominator needs '${name}' on PATH and could not run it.\n` +
        `Install it (e.g. 'brew install ${name}' or your distro's package) and retry.`,
    );
    process.exit(1);
  }
}

checkBinary('yt-dlp', ['--version']);
checkBinary('ffmpeg', ['-version']);

await sweepLeftoverDirs();

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 3000 }, (info) => {
  console.log(`dominator ready: http://127.0.0.1:${info.port}`);
});
```

- [ ] **Step 2: Verify it starts and serves the API**

Run: `pnpm typecheck`
Expected: exits 0.

Run: `pnpm start` in the background, then:

```bash
curl -s -X POST http://127.0.0.1:3000/api/jobs \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/x","format":"mp4"}'
```

Expected output: `{"error":"only YouTube URLs are supported"}`
Stop the server afterwards.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: add server entry with binary checks and temp sweep"
```

---

### Task 7: UI (`public/index.html`)

**Files:**
- Create: `public/index.html`

- [ ] **Step 1: Write the page**

Pure black, one centered column: mode toggle, URL input with trigger button,
2px progress bar, one status line. Theming is copy only (firing modes from
Psycho-Pass). The client listens for the SSE events `progress`, `done`, and
`failed`; the built-in `EventSource` `error` event only signals connection
drops and is ignored once the job has finished.

`public/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>dominator</title>
<style>
  :root {
    --bg: #000;
    --fg: #e8e8e8;
    --dim: #555;
    --line: #2a2a2a;
    --accent: #19c2d8;
    --error: #ff4444;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--fg);
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    min-height: 100vh;
    display: grid;
    place-items: center;
  }
  main { width: min(560px, 90vw); display: flex; flex-direction: column; gap: 1.25rem; }
  h1 {
    font-size: 0.85rem;
    font-weight: 400;
    letter-spacing: 0.6em;
    color: var(--dim);
    text-transform: uppercase;
    text-align: center;
  }
  .modes { display: flex; border: 1px solid var(--line); }
  .modes button {
    flex: 1;
    padding: 0.6rem 0;
    background: none;
    border: 0;
    color: var(--dim);
    font: inherit;
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    cursor: pointer;
  }
  .modes button.active { background: var(--accent); color: #000; }
  form { display: flex; border: 1px solid var(--line); }
  input {
    flex: 1;
    padding: 0.75rem;
    background: none;
    border: 0;
    color: var(--fg);
    font: inherit;
    outline: none;
  }
  input::placeholder { color: var(--dim); }
  form button {
    padding: 0 1.5rem;
    background: none;
    border: 0;
    border-left: 1px solid var(--line);
    color: var(--accent);
    font: inherit;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    font-size: 0.65rem;
    cursor: pointer;
  }
  .bar { height: 2px; background: var(--line); overflow: hidden; }
  .bar div { height: 100%; width: 0; background: var(--accent); transition: width 0.3s; }
  .status {
    font-size: 0.7rem;
    color: var(--dim);
    letter-spacing: 0.08em;
    min-height: 1em;
  }
  .status.error { color: var(--error); }
</style>
</head>
<body>
<main>
  <h1>dominator</h1>
  <div class="modes" role="radiogroup" aria-label="enforcement mode">
    <button type="button" class="active" data-format="mp4">Lethal Eliminator / MP4</button>
    <button type="button" data-format="mp3">Non-Lethal Paralyzer / MP3</button>
  </div>
  <form id="form">
    <input id="url" type="url" placeholder="paste a video url" autofocus spellcheck="false" required>
    <button type="submit">fire</button>
  </form>
  <div class="bar"><div id="fill"></div></div>
  <p id="status" class="status"></p>
</main>
<script>
  const form = document.getElementById('form');
  const urlInput = document.getElementById('url');
  const fill = document.getElementById('fill');
  const statusLine = document.getElementById('status');
  const modeButtons = [...document.querySelectorAll('.modes button')];
  const MODE_NAMES = { mp4: 'lethal eliminator', mp3: 'non-lethal paralyzer' };

  let format = 'mp4';
  let source = null;
  let finished = false;

  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      format = button.dataset.format;
      for (const b of modeButtons) b.classList.toggle('active', b === button);
    });
  }

  function setStatus(text, isError = false) {
    statusLine.textContent = text;
    statusLine.classList.toggle('error', isError);
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (source) source.close();
    finished = false;
    fill.style.width = '0';
    setStatus('aiming...');

    const response = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value.trim(), format }),
    });
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error, true);
      return;
    }

    source = new EventSource('/api/jobs/' + data.jobId + '/events');
    source.addEventListener('progress', (e) => {
      const progress = JSON.parse(e.data);
      if (progress.stage === 'downloading') {
        fill.style.width = progress.percent + '%';
        setStatus('enforcement mode: ' + MODE_NAMES[format] + ' ... ' + progress.percent.toFixed(1) + '%');
      } else {
        fill.style.width = '100%';
        setStatus('processing target...');
      }
    });
    source.addEventListener('done', () => {
      finished = true;
      source.close();
      fill.style.width = '100%';
      setStatus('target eliminated. saving file.');
      window.location.href = '/api/jobs/' + data.jobId + '/file';
    });
    source.addEventListener('failed', (e) => {
      finished = true;
      source.close();
      setStatus(e.data, true);
    });
    source.onerror = () => {
      if (!finished) setStatus('lost connection to server', true);
    };
  });
</script>
</body>
</html>
```

- [ ] **Step 2: Verify the page is served**

Run: `pnpm start` in the background, then:

```bash
curl -s http://127.0.0.1:3000/ | grep -c dominator
```

Expected: a number greater than 0. Stop the server afterwards.

- [ ] **Step 3: Commit**

```bash
git add public/index.html
git commit -m "feat: add minimal black dominator ui"
```

---

### Task 8: README and final verification

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

````markdown
# dominator

Personal, local-only video downloader for YouTube, Twitter/X, Instagram,
and TikTok. Minimal black page: paste a URL, pick a firing mode (MP4 or
MP3), pull the trigger.

Public posts only: there is no login or cookie support, so gated content
(common on Instagram) fails with the extractor's error message.

Named after the weapon from Psycho-Pass. For personal use only; respect
each site's terms of service and copyright law.

## Prerequisites

- Node >= 20 and pnpm
- `yt-dlp` and `ffmpeg` on PATH

```bash
# macOS
brew install yt-dlp ffmpeg
# Debian/Ubuntu
sudo apt install yt-dlp ffmpeg
```

If downloads start failing with extraction errors, update yt-dlp first
(`yt-dlp -U` or your package manager). YouTube changes things; yt-dlp
keeps up.

## Run

```bash
pnpm install
pnpm start
```

Open http://127.0.0.1:3000. Run from the repo root (the static page is
served from `./public`). The server binds to 127.0.0.1 only.

## Develop

```bash
pnpm dev        # restart on change
pnpm test       # vitest
pnpm typecheck  # tsc --noEmit
```
````

- [ ] **Step 2: Run the full gates**

Run: `pnpm test`
Expected: all tests PASS.

Run: `pnpm typecheck`
Expected: exits 0.

- [ ] **Step 3: Manual smoke test (requires network and yt-dlp installed)**

Start `pnpm start`, open http://127.0.0.1:3000 in a browser, paste a short
YouTube video URL, fire in MP4 mode. Expected: progress bar advances, then
the browser downloads an .mp4 named after the video title. Repeat in MP3
mode, expect an .mp3. Optionally repeat with a public tweet or TikTok URL.
Paste a vimeo URL, expect a red error without firing.
Check the temp dir afterwards: `ls /tmp | grep dominator` should be empty.

If the executor has no browser or network access, note the smoke test as
pending for the user instead of claiming it passed.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: add readme with prereqs and run instructions"
```
