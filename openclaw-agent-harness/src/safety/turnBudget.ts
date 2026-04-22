export class SlidingWindowCounter {
  private readonly windowMs: number;
  private readonly maxRetained: number;
  private readonly byKey = new Map<string, number[]>();

  constructor(args: { windowMs: number; maxRetained: number }) {
    this.windowMs = args.windowMs;
    this.maxRetained = args.maxRetained;
  }

  noteEvent(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    const arr = this.byKey.get(key) ?? [];

    // Drop old timestamps.
    let start = 0;
    while (start < arr.length && arr[start] < cutoff) start += 1;
    const pruned = start > 0 ? arr.slice(start) : arr;

    pruned.push(now);

    // Guard memory in pathological cases.
    const limited = pruned.length > this.maxRetained ? pruned.slice(pruned.length - this.maxRetained) : pruned;
    this.byKey.set(key, limited);

    return limited.length;
  }

  getCount(key: string, now = Date.now()): number {
    const cutoff = now - this.windowMs;
    const arr = this.byKey.get(key);
    if (!arr?.length) return 0;
    let start = 0;
    while (start < arr.length && arr[start] < cutoff) start += 1;
    return arr.length - start;
  }
}

export function createTurnsPerHourLimiter(args: { maxTurnsPerHour: number }): SlidingWindowCounter {
  // A "turn" is an attempt execution within the last hour.
  // We retain a bounded number of timestamps per key to cap memory.
  // The runtime check can still use a smaller "maxTurnsPerHour" per mode.
  const retained = Math.max(10, Math.floor(args.maxTurnsPerHour) * 2);
  return new SlidingWindowCounter({ windowMs: 60 * 60_000, maxRetained: retained });
}

