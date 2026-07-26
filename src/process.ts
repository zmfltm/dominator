import type { ChildProcess } from 'node:child_process';

export const DETACH_CHILD_PROCESS = process.platform !== 'win32';

export function signalProcessTree(
  child: Pick<ChildProcess, 'pid' | 'kill'>,
  signal: NodeJS.Signals,
): boolean {
  if (DETACH_CHILD_PROCESS && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false;
      return child.kill(signal);
    }
  }
  return child.kill(signal);
}
