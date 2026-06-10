---
id: REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE
schema_version: 4
name: Enter Edit Availability mode and batch-save slots
category: capability
severity: high
status: draft
boundary: Edit Availability mode state + SaveAvailabilityBatch mutation
owners:
  technical: "@lawrence.chan"
tags: [wave-2, calendar, write, mode]
invariants_respected:
  - REQ-INV-FE-01-DESIGN-FIDELITY
  - REQ-INV-FE-02-NO-BROKEN-STATES
domain: provider-calendar
protocols:
  - availability-editing
  - tile-interaction
  - cache-invalidation
designs:
  - surface: edit-availability
    node: "74:4642"
---

# Enter Edit Availability mode and batch-save slots

Provider enters mode, paints AFC blocks via drag, removes blocks
via ×, sees live "X of 28 hours" footer, then Save (one mutation)
or Cancel (discard). See `domains/provider-calendar.md
#availability-editing` for the full protocol.

## Input

```graphql
mutation SaveAvailabilityBatch($input: SaveAvailabilityBatchInput!) {
  saveAvailabilityBatch(input: $input) {
    weekTiles(from: $input.from, to: $input.to) {
      __typename
      ... on Appointment { id startsAt endsAt clientName hasConflict }
      ... on AvailabilitySlot { id startsAt endsAt }
    }
    weekHoursScheduled { scheduled target }
  }
}
```

Idempotency: key minted on mode entry, reused on Save retry,
discarded on Cancel or success.

## Acceptance Criteria

### `cap-06-enter-mode-toggles-chrome`

```yaml
criterion:
  id: cap-06-enter-mode-toggles-chrome
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE @criterion cap-06-enter-mode-toggles-chrome"
      - "@design edit-availability/mode-chrome"
  predicate: |
    Mode-entry renders Cancel + Save buttons (no Edit button),
    reveals the footer hours banner, and force-closes any open aside.
    No async work blocks the chrome swap.
  negative_cases:
    - Mode-entry must NOT issue any network request
    - Click inside grid before clicking Edit must NOT toggle mode
```

### `cap-06-paint-block-locally`

```yaml
criterion:
  id: cap-06-paint-block-locally
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE @criterion cap-06-paint-block-locally"
      - "@design edit-availability/availability-block"
  predicate: |
    Drag-paint produces a pending block whose hour-span matches
    dragged cells. Pending state is component-local; no urql
    operation fires during drag or on release.
  negative_cases:
    - End-row before start-row must normalize (min/max), not zero-height
    - Drag across two day columns must snap to start column only
```

### `cap-06-save-batch-mutation`

```yaml
criterion:
  id: cap-06-save-batch-mutation
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE @criterion cap-06-save-batch-mutation"
  predicate: |
    Exactly one SaveAvailabilityBatch mutation fires per Save click.
    Includes both additions and removals. Response payload
    populates cache without follow-up query.
  negative_cases:
    - Empty diff must NOT fire any mutation (no-op exits mode)
    - Failed Save must keep user in edit mode with pending intact
```

### `cap-06-cancel-discards-locally`

```yaml
criterion:
  id: cap-06-cancel-discards-locally
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE @criterion cap-06-cancel-discards-locally"
  predicate: |
    Cancel is a pure local-state reset; no GraphQL operation fires.
    Calendar re-renders from pre-mode cache state.
  negative_cases:
    - Cancel must NOT prompt for confirmation (browser-back IS prompted; in-app Cancel is not)
    - Cancel after failed Save must still cleanly discard all pending state
```

### `cap-06-hours-banner-tracks-pending`

```yaml
criterion:
  id: cap-06-hours-banner-tracks-pending
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FE-06-EDIT-AVAILABILITY-MODE @criterion cap-06-hours-banner-tracks-pending"
      - "@design edit-availability/week-hours-banner"
  predicate: |
    computePendingHours(existing, additions, removalIds, target)
    returns { scheduled, target, status: 'ok' | 'below' }.
    scheduled = sum(existing - removals) + sum(additions).
    Renders success treatment iff status === 'ok'.
  negative_cases:
    - Removing a pending addition must NOT double-count removal
    - Sub-hour durations must NOT round to zero
```
