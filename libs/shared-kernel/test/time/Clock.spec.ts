// Generic Clock port + UTC-storage discipline tests (worked example
//
// Predicate (verbatim from requirements/REQ-INV-TIMEZONE-DST.md):
//   "Every domain timestamp column (...) is TIMESTAMP WITH TIME ZONE in
//    Postgres, populated as UTC. Wire payloads use ISO-8601 with Z suffix.
//    Naive timestamps are rejected at validation."
//
// At the shared-kernel layer the predicate manifests as the Clock port
// shape: any clock that domain code consumes MUST expose `now(): Date`
// returning a Date instance that the time policy can serialize to an
// ISO-8601 string carrying an explicit UTC offset (`Z` or `+00:00`).
//
// This spec pins the port's TS shape and runtime contract so that
// any future clock implementation (test fakes included) cannot drift
// to a non-Date / non-UTC-renderable return value.

import { describe, expect, expectTypeOf, it } from 'vitest';

import type { Clock } from '../../src/time/Clock.js';
import { FixedClock } from '../../src/time/FixedClock.js';

describe('Clock port shape', () => {
  it('Clock.now() is declared as returning a Date', () => {
    expectTypeOf<Clock>().toMatchTypeOf<{ now: () => Date }>();
  });

  it('a clock implementation returns a Date instance whose ISO form ends in Z', () => {
    const fixedIso = '2026-04-15T14:00:00.000Z';
    const clock: Clock = new FixedClock(new Date(fixedIso));
    const t = clock.now();
    expect(t).toBeInstanceOf(Date);
    expect(t.toISOString()).toBe(fixedIso);
    expect(t.toISOString().endsWith('Z')).toBe(true);
  });

  it('clock-derived Dates expose epoch millis (UTC milliseconds since 1970)', () => {
    // getTime() is always UTC milliseconds since the epoch — proving that
    // a Date instance from the Clock port carries an unambiguous UTC
    // instant regardless of host TZ. This is what the storage layer
    // persists into TIMESTAMP WITH TIME ZONE columns.
    const fixed = new Date('2026-04-15T14:00:00.000Z');
    const clock: Clock = new FixedClock(fixed);
    expect(clock.now().getTime()).toBe(fixed.getTime());
  });
});
