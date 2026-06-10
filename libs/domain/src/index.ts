// domain library entry — populated by capability tracks.
//
// Conventions:
//   - Pure TypeScript: no framework, no I/O, no SQL driver imports.
//   - Entities + value-objects + state machines + outbound port
//     interfaces only. Outbound port implementations live in
//     libs/outbound-adapters.
//   - Branded UUIDs for entity identity at type-level.
//   - Closed-enum reason codes on every domain error.
export {};
