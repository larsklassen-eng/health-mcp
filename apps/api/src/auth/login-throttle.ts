/**
 * Slows down password guessing: after `maxFailures` failed sign-ins for one
 * email within `windowMs`, that email is refused until the window has passed.
 * Kept in memory, so it resets when the api restarts.
 */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60_000,
  ) {}

  /** Milliseconds until `key` may try again, or 0 when it may try now. */
  retryAfter(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    if (recent.length < this.maxFailures) return 0;
    return recent[recent.length - this.maxFailures]! + this.windowMs - now;
  }

  fail(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string, now: number): number[] {
    const recent = (this.failures.get(key) ?? []).filter((at) => at > now - this.windowMs);
    if (recent.length === 0) this.failures.delete(key);
    return recent;
  }
}
