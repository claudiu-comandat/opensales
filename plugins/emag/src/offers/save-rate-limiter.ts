/**
 * Shared launch-rate limiter for product_offer/save calls.
 *
 * Constraint: no more than 150 request STARTS in any rolling 60-second window,
 * shared across ALL eMAG platforms (ro + bg + hu).
 *
 * Design: sliding-window of launch timestamps. `acquireSaveOfferSlot()` resolves
 * as soon as a launch slot is available — it does NOT wait for any response.
 * Multiple requests may be in-flight concurrently.
 *
 * The singleton is module-level, so it is naturally shared across all callers
 * regardless of which platform the call targets.
 */

export const SAVE_OFFER_MAX_PER_MIN = 150;

class SaveOfferRateLimiter {
  /** Timestamps (ms) of recent acquire() calls within the rolling 60s window. */
  private readonly launchTimestamps: number[] = [];
  private readonly queue: { resolve: () => void }[] = [];
  private draining = false;

  async acquire(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push({ resolve });
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const waitMs = this.computeWaitMs();
        if (waitMs > 0) await this.sleep(waitMs);
        const now = Date.now();
        this.purgeExpired(now);
        if (this.launchTimestamps.length < SAVE_OFFER_MAX_PER_MIN) {
          this.launchTimestamps.push(now);
          const next = this.queue.shift();
          if (next) next.resolve();
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private computeWaitMs(): number {
    const now = Date.now();
    this.purgeExpired(now);
    if (this.launchTimestamps.length < SAVE_OFFER_MAX_PER_MIN) return 0;
    // Oldest timestamp will expire at oldest + 60_000
    const oldest = this.launchTimestamps[0] ?? now;
    return Math.max(0, oldest + 60_000 - now);
  }

  private purgeExpired(now: number): void {
    const threshold = now - 60_000;
    while (this.launchTimestamps.length > 0 && (this.launchTimestamps[0] ?? 0) <= threshold) {
      this.launchTimestamps.shift();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** For testing only — reset internal state. */
  _reset(): void {
    this.launchTimestamps.length = 0;
    this.queue.length = 0;
    this.draining = false;
  }
}

/** Module-level singleton — shared across all platforms (ro/bg/hu). */
export const saveOfferRateLimiter = new SaveOfferRateLimiter();

/**
 * Acquire a launch slot. Resolves at the next allowed launch instant (steady
 * ~400 ms spacing at sustained 150/min load). Does NOT wait for any HTTP response.
 */
export const acquireSaveOfferSlot = (): Promise<void> => saveOfferRateLimiter.acquire();
