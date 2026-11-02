/**
 * Caps the accounts created through sign-up within a sliding hour, all
 * together, against scripted sign-ups. Kept in memory, so it resets when the
 * api restarts. `perHour` is at least 1; with 0, sign-up is off and never asks.
 */
export class SignupLimit {
  private created: number[] = [];

  constructor(
    private readonly perHour: number,
    private readonly windowMs = 60 * 60_000,
  ) {}

  /** Milliseconds until another account may be created, or 0 when one may be now. */
  retryAfter(now = Date.now()): number {
    this.created = this.created.filter((at) => at > now - this.windowMs);
    if (this.created.length < this.perHour) return 0;
    return this.created[this.created.length - this.perHour]! + this.windowMs - now;
  }

  record(now = Date.now()): void {
    this.created.push(now);
  }
}
