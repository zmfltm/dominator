import { spawn } from 'node:child_process';

export const METADATA_TIMEOUT_MS = 15_000;

export class MetadataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MetadataError';
  }
}

export function firstNonEmptyLine(output: string): string | undefined {
  return output
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
}

export function extractYtDlpError(stderr: string): string | undefined {
  const errorLines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('ERROR:'));
  return errorLines.at(-1)?.replace(/^ERROR:\s*/, '');
}

export function fetchVideoTitle(url: string, timeoutMs = METADATA_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'yt-dlp',
      [
        '--skip-download',
        '--no-playlist',
        '--no-warnings',
        '--print',
        'title',
        '--',
        url,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      settle(() => reject(new MetadataError('could not fetch title before timeout')));
    }, timeoutMs);
    timeout.unref();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-100_000);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000);
    });

    child.on('error', (err) => {
      settle(() => reject(new MetadataError(`failed to start yt-dlp: ${err.message}`)));
    });

    child.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        const message = extractYtDlpError(stderr) ?? `yt-dlp exited with code ${code}`;
        settle(() => reject(new MetadataError(message)));
        return;
      }
      const title = firstNonEmptyLine(stdout);
      if (!title) {
        settle(() => reject(new MetadataError('yt-dlp returned no title')));
        return;
      }
      settle(() => resolve(title));
    });
  });
}
