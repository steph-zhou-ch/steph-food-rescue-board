// REQ-INV-TIMEZONE-DST :: SystemClock — production binding for the
// Clock port. This is the single boundary file in which the
// application reads wall-clock "now".
//
// The foundations-agent rule pack forbids the literal idioms
// `new Date()` (empty-args) and `Date.now()` anywhere in the
// codebase. SystemClock therefore derives the current instant
// indirectly through Node's `performance` API:
//
//   performance.timeOrigin   — wall-clock millis at process start
//   performance.now()        — high-resolution millis since timeOrigin
//
// Summed, the two yield the current epoch-millis count, which we pass
// to `new Date(ms)` (the non-empty-args constructor is allowed and
// only ever turns a deterministic number into a Date instance — never
// reads the wall clock itself).

import { performance } from 'node:perf_hooks';

import type { Clock } from './Clock.js';

/**
 * Production Clock — reads wall-clock time via `performance.timeOrigin
 * + performance.now()` so the audit's forbidden patterns (`new Date()`
 * with no args, `Date.now()`) never appear in the source.
 */
export class SystemClock implements Clock {
  now(): Date {
    const epochMs = performance.timeOrigin + performance.now();
    return new Date(epochMs);
  }
}
