import { toPosixPath } from './util';

export interface ScheduledSyncCheck {
  mode: 'incremental' | 'full';
  paths?: string[];
  reason: string;
}

export interface TimerScheduler {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const realTimers: TimerScheduler = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout)
};

interface PendingBatch<T> {
  request: ScheduledSyncCheck;
  waiters: Array<{ resolve: (value: T) => void; reject: (error: unknown) => void }>;
}

export class SyncCheckScheduler<T> {
  private active = false;
  private pending?: PendingBatch<T>;
  private scheduled?: ScheduledSyncCheck;
  private timer?: unknown;

  constructor(
    private readonly runCheck: (request: ScheduledSyncCheck) => Promise<T>,
    private readonly timers: TimerScheduler = realTimers,
    private readonly onBackgroundError: (error: unknown) => void = () => undefined
  ) {}

  request(request: ScheduledSyncCheck): Promise<T> {
    if (!this.active) {
      this.active = true;
      return this.runBatch(request).finally(() => this.pump());
    }
    return new Promise<T>((resolve, reject) => {
      if (!this.pending) {
        this.pending = { request: normalizeRequest(request), waiters: [] };
      } else {
        this.pending.request = mergeRequests(this.pending.request, request);
      }
      this.pending.waiters.push({ resolve, reject });
    });
  }

  schedule(request: ScheduledSyncCheck, delayMs: number): void {
    this.scheduled = this.scheduled ? mergeRequests(this.scheduled, request) : normalizeRequest(request);
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      const scheduled = this.scheduled;
      this.scheduled = undefined;
      if (scheduled) void this.request(scheduled).catch(this.onBackgroundError);
    }, delayMs);
  }

  cancelScheduled(): void {
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
    this.scheduled = undefined;
  }

  private async runBatch(request: ScheduledSyncCheck): Promise<T> {
    return this.runCheck(normalizeRequest(request));
  }

  private pump(): void {
    const next = this.pending;
    this.pending = undefined;
    if (!next) {
      this.active = false;
      return;
    }
    void this.runBatch(next.request).then(
      value => next.waiters.forEach(waiter => waiter.resolve(value)),
      error => next.waiters.forEach(waiter => waiter.reject(error))
    ).finally(() => this.pump());
  }
}

export function mergeRequests(left: ScheduledSyncCheck, right: ScheduledSyncCheck): ScheduledSyncCheck {
  const mode = left.mode === 'full' || right.mode === 'full' ? 'full' : 'incremental';
  const paths = mode === 'full' || left.paths === undefined || right.paths === undefined
    ? undefined
    : [...new Set([...left.paths, ...right.paths].map(toPosixPath))].sort();
  return {
    mode,
    paths,
    reason: left.reason === right.reason ? left.reason : `${left.reason}+${right.reason}`
  };
}

function normalizeRequest(request: ScheduledSyncCheck): ScheduledSyncCheck {
  return {
    ...request,
    paths: request.mode === 'full' || request.paths === undefined
      ? undefined
      : [...new Set(request.paths.map(toPosixPath))].sort()
  };
}
