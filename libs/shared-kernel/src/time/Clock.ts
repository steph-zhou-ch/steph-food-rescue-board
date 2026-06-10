// REQ-INV-TIMEZONE-DST :: Clock port.
//
// The Clock port is the single chokepoint through which the domain
// (and any layer that needs to know "now") reads wall-clock time.
// Domain / application code MUST depend on this port — never on
// `new Date()` or `Date.now()` directly (forbidden by the
// foundations-agent rule pack and by REQ-INV-TIMEZONE-DST's
// clock-abstraction discipline).
//
// Production wiring binds `Clock` to `SystemClock`. Tests bind it to
// `FixedClock` for deterministic instants. Both implementations
// return a `Date` whose `.toISOString()` ends in `Z` — the wire form
// the TimezonePolicy serializer expects.

/**
 * Port for "current wall-clock instant". The single Date instance
 * returned from `now()` carries an unambiguous UTC instant (epoch
 * milliseconds via `getTime()`); rendering to a timezone is the
 * TimezonePolicy serializer's job, never the clock's.
 */
export interface Clock {
  /** Current wall-clock instant as a UTC `Date`. */
  now(): Date;
}
