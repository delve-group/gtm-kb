import { describe, expect, it } from 'vitest';
import { FixedWindowRateLimiter } from './rate-limiter.js';

describe('FixedWindowRateLimiter', () => {
  it('enforces per-client and global ceilings and resets after the window', () => {
    let now = 1_000;
    const limiter = new FixedWindowRateLimiter({
      windowMs: 10_000,
      perKeyLimit: 2,
      globalLimit: 3,
      clock: () => now,
    });

    expect(limiter.check('one').allowed).toBe(true);
    expect(limiter.check('one').allowed).toBe(true);
    expect(limiter.check('one')).toMatchObject({ allowed: false, retryAfterSeconds: 10 });
    expect(limiter.check('two').allowed).toBe(true);
    expect(limiter.check('three').allowed).toBe(false);

    now += 10_000;
    expect(limiter.check('one').allowed).toBe(true);
  });

  it('uses a shared overflow bucket after the key map reaches its bound', () => {
    const limiter = new FixedWindowRateLimiter({
      windowMs: 10_000,
      perKeyLimit: 1,
      globalLimit: 10,
      maxTrackedKeys: 1,
      clock: () => 1_000,
    });

    expect(limiter.check('tracked').allowed).toBe(true);
    expect(limiter.check('rotated-one').allowed).toBe(true);
    expect(limiter.check('rotated-two').allowed).toBe(false);
  });
});
