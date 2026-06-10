// REQ-INV-TIMEZONE-DST :: FixedClock — test-side binding for the
// Clock port. Returns a deterministic instant on every `now()` call.
//
// Tests construct FixedClock with a precise UTC Date so use cases
// exhibit reproducible time-dependent behavior. The clock can be
// re-pointed at a new instant via `setNow(d)` for tests that need
// to drive the clock forward (e.g. asserting cancellation lateness).

import type { Clock } from './Clock.js';

/**
 * Deterministic Clock implementation for tests. Constructed with a
 * single UTC instant; subsequent `now()` calls return the same
 * instant until `setNow(d)` is invoked.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    // Return a fresh Date so callers cannot mutate the internal
    // instant — `Date` instances are mutable through setters.
    return new Date(this.current.getTime());
  }

  setNow(d: Date): void {
    this.current = new Date(d.getTime());
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
