---
id: REQ-CAP-FE-ITEM-DETAIL
schema_version: 4
name: Item detail view with status-aware actions
category: capability
severity: critical
status: draft
boundary: ItemDetail page component
owners:
  technical: "@workshop-participant"
tags: [wave-1, frontend, read, update]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
designs:
  - surface: rescue-board
    node: "1:239"
  - surface: rescue-board
    node: "1:308"
---

# Item detail view with status-aware actions

Full-page detail view for a single SurplusItem. Shows hero image,
status badge, category badge, title, description, and a detail card
with pickup location, posted by, posted time, and (if set) expiry.
Action buttons change based on item status. See
`domains/rescue-board.md#item-lifecycle` for the state machine.

## Input

```typescript
// Fetches item by id (GET /api/items/:id or from cached feed data)
// Actions call PATCH /api/items/:id/status or DELETE /api/items/:id
```

## Acceptance Criteria

### `fe-detail-01-renders-available-state`

```yaml
criterion:
  id: fe-detail-01-renders-available-state
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-01-renders-available-state"
      - "@design rescue-board/item-detail-available"
  predicate: |
    For an available item: renders hero image (full width, 280px tall),
    green "AVAILABLE" badge + gray category badge, bold title (30px),
    description paragraph, detail card with rows (pickup location,
    posted by, posted time, expiry if set). Expiry value renders in
    red text. Single action button: "Claim this item" (blue, pill-
    shaped, full width, with checkmark icon).
  negative_cases:
    - Must NOT show "Mark as picked up" or "Unclaim" buttons
    - Must NOT omit the expiry row when expiresAt is set
```

### `fe-detail-02-renders-claimed-state`

```yaml
criterion:
  id: fe-detail-02-renders-claimed-state
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-02-renders-claimed-state"
      - "@design rescue-board/item-detail-claimed"
  predicate: |
    For a claimed item: renders orange "CLAIMED" badge instead of
    green "AVAILABLE". Detail card shows "Claimed by" row with the
    claimer name. Two action buttons: "Mark as picked up" (dark,
    primary, with checkmark icon) and "Unclaim" (outlined, secondary,
    with undo icon).
  negative_cases:
    - Must NOT show "Claim this item" button on claimed items
    - Claimed-by row must NOT appear on available items
```

### `fe-detail-03-claim-action`

```yaml
criterion:
  id: fe-detail-03-claim-action
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-03-claim-action"
  predicate: |
    Clicking "Claim this item" sends PATCH /api/items/:id/status
    with action='claim'. On success, view updates to show claimed
    state (orange badge, claimed-by row, new buttons) without full
    page reload.
  negative_cases:
    - Must NOT navigate away from detail page on claim
    - Button must be disabled while request is in flight
```

### `fe-detail-04-pickup-and-unclaim-actions`

```yaml
criterion:
  id: fe-detail-04-pickup-and-unclaim-actions
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-04-pickup-and-unclaim-actions"
  predicate: |
    "Mark as picked up" sends PATCH with action='confirm_pickup'.
    On success, navigates to feed (item no longer visible).
    "Unclaim" sends PATCH with action='unclaim'. On success, view
    updates back to available state.
  negative_cases:
    - Must NOT allow both actions simultaneously (disable during flight)
```

### `fe-detail-05-back-navigation`

```yaml
criterion:
  id: fe-detail-05-back-navigation
  severity: medium
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-05-back-navigation"
  predicate: |
    Back arrow (circular button, top-left) navigates to the browse
    feed.
  negative_cases:
    - Must NOT lose scroll position in feed on return (nice-to-have,
      not blocking)
```

### `fe-detail-06-detail-card-layout`

```yaml
criterion:
  id: fe-detail-06-detail-card-layout
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-06-detail-card-layout"
  predicate: |
    Detail card is a bordered rounded container with icon+label+value
    rows. Each row has a 16px icon, "Label" in 12px muted, and value
    in 14px medium weight. Rows are separated by 14px gap.
  negative_cases:
    - Must NOT render rows without their corresponding icon
```
