import { describe, expect, it } from 'vitest';
import { isAtJobLimit, isStale, MAX_RUNNING_JOBS } from './jobs';

describe('isStale', () => {
  const now = 1_000_000;
  const ttl = 1000;

  it('never reaps a running job, however old', () => {
    expect(isStale({ status: 'running', completedAt: undefined }, ttl, now)).toBe(false);
  });

  it('never reaps a terminal job that has no completion time', () => {
    expect(isStale({ status: 'done', completedAt: undefined }, ttl, now)).toBe(false);
  });

  it('keeps a freshly completed job within its ttl so the file stays downloadable', () => {
    expect(isStale({ status: 'done', completedAt: now - 500 }, ttl, now)).toBe(false);
  });

  it('reaps a completed-but-uncollected job once past its ttl', () => {
    expect(isStale({ status: 'done', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });

  it('reaps an errored job past its ttl so its map entry is freed', () => {
    expect(isStale({ status: 'error', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });

  it('reaps a canceled job past its ttl so its map entry is freed', () => {
    expect(isStale({ status: 'canceled', completedAt: now - 1500 }, ttl, now)).toBe(true);
  });
});

describe('isAtJobLimit', () => {
  it('allows work below the running job limit', () => {
    expect(isAtJobLimit(MAX_RUNNING_JOBS - 1)).toBe(false);
  });

  it('blocks work at the running job limit', () => {
    expect(isAtJobLimit(MAX_RUNNING_JOBS)).toBe(true);
  });
});
