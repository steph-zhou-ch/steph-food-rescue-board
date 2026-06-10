---
id: REQ-CAP-FE-01-RENDER-PROVIDER-WEEK
schema_version: 4
name: Render provider weekly calendar
category: capability
severity: critical
status: draft
boundary: CalendarPage initial render + GetProviderWeek query
owners:
  technical: "@lawrence.chan"
tags: [wave-1, calendar, read]
invariants_respected:
  - REQ-INV-FE-01-DESIGN-FIDELITY
  - REQ-INV-FE-02-NO-BROKEN-STATES
domain: provider-calendar
protocols:
  - grid-model
  - week-navigation
  - cache-invalidation
designs:
  - surface: provider-week
    node: "23:7858"
---

# Render provider weekly calendar

Read-only render of the 7×15 grid populated from
`me.weekTiles(from, to)`. Entry point for everything else — if
tiles don't paint, no other CAP is reachable. See
`domains/provider-calendar.md#grid-model` for layout rules.

## Input

```graphql
query GetProviderWeek($from: DateTime!, $to: DateTime!) {
  me {
    id displayName workingHoursStart workingHoursEnd
    weekTiles(from: $from, to: $to) {
      __typename
      ... on Appointment { id startsAt endsAt clientName hasConflict serviceType }
      ... on AvailabilitySlot { id startsAt endsAt }
    }
  }
}
```

## Acceptance Criteria

### `cap-01-grid-renders-from-week-tiles`

```yaml
criterion:
  id: cap-01-grid-renders-from-week-tiles
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-01-RENDER-PROVIDER-WEEK @criterion cap-01-grid-renders-from-week-tiles"
      - "@design provider-week/calendar-grid"
  predicate: |
    Given N WeekTile entries from mock urql, the rendered calendar
    contains exactly N tile elements, each in the column matching
    its startsAt day-of-week and at the vertical offset matching
    its startsAt hour relative to 09:00.
  negative_cases:
    - Tile renders in wrong column (off-by-one timezone bug)
    - Tile extending past 23:00 is omitted instead of clipped
```

### `cap-01-today-column-highlight`

```yaml
criterion:
  id: cap-01-today-column-highlight
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-01-RENDER-PROVIDER-WEEK @criterion cap-01-today-column-highlight"
      - "@design provider-week/today-column"
  predicate: |
    Exactly one column carries data-today="true", corresponding to
    the current date in America/New_York.
  negative_cases:
    - On Sunday, Saturday's column must NOT be highlighted
    - At Tue 23:59 ET, Wed's column must NOT yet be highlighted
```

### `cap-01-week-range-label`

```yaml
criterion:
  id: cap-01-week-range-label
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FE-01-RENDER-PROVIDER-WEEK @criterion cap-01-week-range-label"
  predicate: |
    Label equals format(from, 'MMM d') + ' – ' +
    format(to - 1 day, 'MMM d, yyyy') in provider timezone.
  negative_cases:
    - Must NOT show the exclusive `to` date (would read one day late)
```
