/**
 * Shared launch-rate limiter for Trendyol product-create requests.
 *
 * The real Trendyol limit is 1 000 launches/min; we cap at 900 for safety.
 * This limiter is a module-level singleton: all storefront clients share the
 * same budget, so launching via RO and BG together still stays within 900/min.
 *
 * Design: sliding-window of launch timestamps.
 *   - Keeps the last N timestamps (up to CREATE_PRODUCT_MAX_PER_MIN).
 *   - On acquire(): drop timestamps older than 60 s, then if fewer than N remain
 *     record the current time and resolve immediately; otherwise wait until the
 *     oldest timestamp is > 60 s old before retrying.
 *   - acquireCreateProductSlot() resolves as soon as the slot is granted — it
 *     does NOT wait for any prior HTTP response. Multiple requests may be in
 *     flight concurrently.
 */

export const CREATE_PRODUCT_MAX_PER_MIN = 900;
const WINDOW_MS = 60_000;

class SlidingWindowLimiter {
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly timestamps: number[] = [];

  constructor(maxPerWindow: number, windowMs: number) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    this.evict(now);

    if (this.timestamps.length < this.maxPerWindow) {
      this.timestamps.push(now);
      return;
    }

    // Must wait until the oldest timestamp falls outside the window.
    // timestamps is non-empty here (length >= maxPerWindow >= 1), but we guard
    // defensively to avoid non-null assertions that ESLint forbids.
    const oldest = this.timestamps[0] ?? now;
    const waitMs = oldest + this.windowMs - now;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, waitMs)));
    return this.acquire();
  }

  /** Drop timestamps that are older than the window. */
  private evict(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? Infinity) <= cutoff) {
      this.timestamps.shift();
    }
  }

  /** Visible for testing: current number of in-window timestamps. */
  get inWindowCount(): number {
    const now = Date.now();
    this.evict(now);
    return this.timestamps.length;
  }
}

/** Singleton: shared across all storefront clients. */
const createProductLimiter = new SlidingWindowLimiter(CREATE_PRODUCT_MAX_PER_MIN, WINDOW_MS);

/**
 * Acquire a launch slot for a product-create request.
 * Resolves at the earliest allowed launch instant; does NOT wait for any prior
 * HTTP response. Multiple calls may be concurrently in flight.
 */
export function acquireCreateProductSlot(): Promise<void> {
  return createProductLimiter.acquire();
}

/**
 * Exposed for unit tests only — returns the singleton instance so tests can
 * reset state via `vi.useFakeTimers` / `vi.advanceTimersByTime`.
 *
 * @internal
 */
export { createProductLimiter as _createProductLimiter };
