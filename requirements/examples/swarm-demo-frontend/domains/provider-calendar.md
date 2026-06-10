---
domain: provider-calendar
bounded_context: swarm-demo-frontend
participants:
  - REQ-CAP-FE-01-RENDER-PROVIDER-WEEK
  - REQ-CAP-FE-02-PUBLISH-AVAILABILITY-FROM-EMPTY-CELL
  - REQ-CAP-FE-03-WITHDRAW-AVAILABILITY-FROM-TILE
  - REQ-CAP-FE-04-WEEK-NAVIGATION
  - REQ-CAP-FE-05-APPOINTMENT-DETAIL-ASIDE
  - REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE
  - REQ-CAP-FE-07-RESCHEDULE-APPOINTMENT
  - REQ-INT-FE-01-GRAPHQL-CODEGEN
  - REQ-INT-FE-02-DEV-JWT-ATTACHED
---

# Provider calendar domain

Single-page provider-facing calendar surface. One GraphQL schema
(`contracts/scheduling.graphql` symlinked from the backend repo),
one urql client, one auth token, one timezone (America/New_York).

## Grid model

7-column (Sun–Sat) × 15-row (09:00–23:00) grid. Each cell is
one hour. Tiles paint at their `startsAt`/`endsAt` offsets within
the grid. A tile clipped outside working hours still renders
(clipped visually, full bounds in data).

Today's column uses `color.calendar.today-column-bg` token. The
week-range label format is `MMM d – MMM d, yyyy` (inclusive
end-of-week display).

## Tile interaction protocol

Participants: REQ-CAP-FE-01 (renders tiles), REQ-CAP-FE-03
(availability click), REQ-CAP-FE-05 (appointment click),
REQ-CAP-FE-06 (edit-mode overrides)

Tiles are one of two `__typename` variants from `me.weekTiles`:

| `__typename` | Visual | Click behavior (normal mode) | Click behavior (edit mode) |
|---|---|---|---|
| `Appointment` | Purple/Forest/green per service type (INV-FE-03) | Opens detail aside (CAP-FE-05) | No-op (appointments are read-only in edit mode) |
| `AvailabilitySlot` | Light emerald | No-op (read-only in normal mode per W2 amendment) | × icon removes from pending diff |

Empty cells:
- Normal mode: inert (not clickable)
- Edit mode: click+drag paints a pending AFC block (CAP-FE-06)

The W1 behavior (click empty cell = instant publish, click
availability = instant withdraw) is superseded by the W2
Edit Availability mode gating.

## Availability editing protocol

Participants: REQ-CAP-FE-02, REQ-CAP-FE-03, REQ-CAP-FE-06

Wave 2 gates all availability mutations behind Edit Availability
mode. The lifecycle:

1. Provider clicks `Edit availability` → mode enters
2. Provider paints/removes blocks → local state only, no network
3. Provider clicks `Save availability` → single
   `SaveAvailabilityBatch` mutation fires
4. On success → mode exits, calendar re-renders from response
5. On Cancel → discard all pending, exit mode, no network

The W1 per-click publish/withdraw mutations (`publishAvailability`,
`withdrawAvailability`) are still in the SDL but the FE only
invokes them inside Edit mode as part of the batch save. The
instant single-click mutations from W1 are effectively deprecated
at the UX layer.

## Week navigation protocol

Participants: REQ-CAP-FE-01 (initial render), REQ-CAP-FE-04
(prev/next/picker)

- Window is always `[Sunday 00:00, Saturday 23:59:59.999]` in
  America/New_York.
- DST transitions: date arithmetic is day-based (Intl.DateTimeFormat),
  not hour-based. A spring/fall Sunday is still one calendar day.
- urql cache keys by `(operation, variables)` — each unique
  `(from, to)` pair is a separate cache entry.
- Navigating to a previously-visited week is a cache hit (no
  network).
- Navigating away shows loading state immediately (never stale
  tiles from the prior window).

## Cache invalidation protocol

Participants: all mutation CAPs + REQ-CAP-FE-01 (read)

The urql client uses `additionalTypenames: ['AvailabilitySlot',
'Appointment']` on the `GetProviderWeek` query. Any mutation that
touches these types invalidates the cached weekTiles for the
visible window.

| Mutation | Invalidation | Re-render source |
|----------|---|---|
| `SaveAvailabilityBatch` | Response payload replaces cache directly | response `weekTiles` |
| `RescheduleAppointment` | Response `affectedTiles` replaces cache | response `affectedTiles` |
| `publishAvailability` (legacy W1) | typename-based invalidation → refetch | refetched query |
| `withdrawAvailability` (legacy W1) | typename-based invalidation → refetch | refetched query |

## Aside protocol

Participants: REQ-CAP-FE-05 (detail view), REQ-CAP-FE-07
(reschedule form)

The right aside (380px) has two internal states:
- **Detail view**: read-only appointment info (client, diagnoses,
  status checks, Prepare/Start CTAs)
- **Reschedule form**: date-strip + time input + scope radio +
  confirmation chip + Confirm/Cancel

Transitions:
- Tile click → detail view (fetches `GetAppointmentDetail`)
- Edit icon in detail → reschedule form (no fetch)
- Confirm in reschedule → detail view (with refreshed data)
- Cancel in reschedule → detail view (unchanged data)
- X icon / Escape / click outside → aside closes
- Click another tile → detail view swaps to new tile
- Enter Edit Availability mode → aside force-closes (modes are
  mutually exclusive)

## Component reuse rules

All visual primitives come from `@ch/ui`
(`ui-components/src/components/ui/`). The app code at
`apps/web/src/` composes them — never re-implements.

New components allowed only when the Figma manifest entry says
`pending: <REQ-id>` for that node. They land in `@ch/ui`, not
in the consuming app.

Colors and spacing come from `tokens.json` via the Tailwind
theme bridge. No hex literals or px/rem literals in JSX style
props. No dynamic class-string concatenation (Tailwind v4's
compiled-class scanner doesn't see them).

## Auth contract (Wave 1–2)

All GraphQL operations carry `Authorization: Bearer <jwt>` via
the urql auth exchange. The JWT is a dev-fake with `providerId`
claim derived from `VITE_DEV_PROVIDER_ID`. Missing env var =
fatal startup error.

Backend's `me` resolver uses the claim. No client-side
authorization logic; no real Auth0 wiring until a future wave.

## GraphQL contract boundary

The SDL at `contracts/scheduling.graphql` is a symlink to the
backend repo. graphql-codegen produces `src/gql/` from that SDL +
the operation documents under `apps/web/src/`. CI gate:
`pnpm codegen --check` fails on drift.

Operations:
- `GetProviderWeek` — initial + navigated week loads
- `GetAppointmentDetail` — detail aside
- `PublishAvailability` — legacy W1 single-slot
- `WithdrawAvailability` — legacy W1 single-slot
- `SaveAvailabilityBatch` — W2 batch commit
- `RescheduleAppointment` — W2 reschedule

## Figma surfaces

| Surface | Node | CAPs served |
|---------|------|-------------|
| `provider-week` | `23:7858` | FE-01, FE-02, FE-03, FE-04 |
| `appointment-detail` | `23:9429` | FE-05 |
| `edit-availability` | `74:4642` | FE-06 |
| `appointment-reschedule` | `67:9077` | FE-07 |
