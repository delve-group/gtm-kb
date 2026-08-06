export interface FixedWindowRateLimiterOptions {
  readonly windowMs: number;
  readonly perKeyLimit: number;
  readonly globalLimit: number;
  readonly maxTrackedKeys?: number;
  readonly clock?: () => number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}

interface Counter {
  count: number;
}

/**
 * Small, deliberately process-local limiter for the single-replica demo. The
 * global ceiling bounds work even when callers rotate source addresses, while
 * maxTrackedKeys prevents the limiter itself becoming an unbounded map.
 */
export class FixedWindowRateLimiter {
  readonly #windowMs: number;
  readonly #perKeyLimit: number;
  readonly #globalLimit: number;
  readonly #maxTrackedKeys: number;
  readonly #clock: () => number;
  readonly #perKey = new Map<string, Counter>();
  #globalCount = 0;
  #resetAt = 0;

  constructor(options: FixedWindowRateLimiterOptions) {
    for (const [name, value] of [
      ['windowMs', options.windowMs],
      ['perKeyLimit', options.perKeyLimit],
      ['globalLimit', options.globalLimit],
      ['maxTrackedKeys', options.maxTrackedKeys ?? 2_048],
    ] as const) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer.`);
      }
    }
    if (options.globalLimit < options.perKeyLimit) {
      throw new TypeError('globalLimit must be at least perKeyLimit.');
    }
    this.#windowMs = options.windowMs;
    this.#perKeyLimit = options.perKeyLimit;
    this.#globalLimit = options.globalLimit;
    this.#maxTrackedKeys = options.maxTrackedKeys ?? 2_048;
    this.#clock = options.clock ?? Date.now;
  }

  check(candidateKey: string): RateLimitDecision {
    const now = this.#clock();
    if (this.#resetAt === 0 || now >= this.#resetAt) {
      this.#resetAt = now + this.#windowMs;
      this.#globalCount = 0;
      this.#perKey.clear();
    }

    const key = this.#boundedKey(candidateKey);
    const counter = this.#perKey.get(key) ?? { count: 0 };
    const retryAfterSeconds = Math.max(1, Math.ceil((this.#resetAt - now) / 1_000));
    if (this.#globalCount >= this.#globalLimit || counter.count >= this.#perKeyLimit) {
      return Object.freeze({ allowed: false, retryAfterSeconds });
    }

    counter.count += 1;
    this.#globalCount += 1;
    this.#perKey.set(key, counter);
    return Object.freeze({ allowed: true, retryAfterSeconds });
  }

  #boundedKey(candidateKey: string): string {
    const key = candidateKey.trim() || 'unknown';
    if (this.#perKey.has(key) || this.#perKey.size < this.#maxTrackedKeys) return key;
    return '__overflow__';
  }
}
