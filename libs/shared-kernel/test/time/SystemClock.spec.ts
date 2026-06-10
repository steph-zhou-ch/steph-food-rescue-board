// Generic Clock port + UTC-storage discipline tests (worked example
//
// Predicate (verbatim from requirements/REQ-INV-TIMEZONE-DST.md):
//   "Every domain timestamp column (...) is TIMESTAMP WITH TIME ZONE in
//    Postgres, populated as UTC."
//
// The SystemClock is the single foundation-time boundary that supplies
// the application's wall-clock "now". Domain code never reaches for
// `new Date()` / `Date.now()` directly (forbidden by the
// foundations-agent rule pack); instead it depends on the Clock port,
// which the production wiring binds to SystemClock.
//
// This spec asserts SystemClock's runtime contract: each call returns
// a Date whose ISO-8601 representation ends in 'Z' (UTC), whose
// monotonicity respects wall-clock advance, and whose epoch ms is
// plausibly close to the test-run's epoch ms.

import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import type { Clock } from '../../src/time/Clock.js';
import { SystemClock } from '../../src/time/SystemClock.js';

describe('SystemClock', () => {
  it('implements the Clock port', () => {
    const clock: Clock = new SystemClock();
    expect(typeof clock.now).toBe('function');
  });

  it('returns a Date instance whose ISO-8601 form ends in Z (UTC suffix)', () => {
    const clock = new SystemClock();
    const t = clock.now();
    expect(t).toBeInstanceOf(Date);
    expect(t.toISOString().endsWith('Z')).toBe(true);
  });

  it('returns a Date close to the test-run wall-clock instant (within 5 seconds)', () => {
    // Use performance.timeOrigin + performance.now() as an
    // independent witness so the test does NOT itself depend on the
    // forbidden `Date.now()` / `new Date()` (empty-args) idioms.
    const witnessEpochMs = performance.timeOrigin + performance.now();
    const clock = new SystemClock();
    const t = clock.now();
    expect(Math.abs(t.getTime() - witnessEpochMs)).toBeLessThan(5_000);
  });

  it('two sequential now() calls are non-decreasing (wall-clock monotonicity)', () => {
    const clock = new SystemClock();
    const a = clock.now().getTime();
    const b = clock.now().getTime();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});
