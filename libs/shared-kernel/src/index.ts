// Shared-kernel entry — cross-layer primitives.
//
// Conventions:
//   - `Result<T, E>` for use-case return values (over throw-for-flow)
//   - `Clock` port — never `new Date()` / `Date.now()` directly in any layer
//   - branded UUIDs for entity identity at type-level
//   - structured `DomainError` hierarchy with closed-enum reason codes
//
// Populated by foundations-agent track.

export type { Clock } from './time/Clock.js';
export { SystemClock } from './time/SystemClock.js';
export { FixedClock } from './time/FixedClock.js';
