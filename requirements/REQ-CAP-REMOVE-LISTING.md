---
id: REQ-CAP-REMOVE-LISTING
schema_version: 4
name: Remove a listing
category: capability
severity: high
status: draft
boundary: DELETE /api/items/:id
owners:
  technical: "@workshop-participant"
tags: [wave-1, delete]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
---

# Remove a listing

Marks a SurplusItem as `removed`, hiding it from the feed. Can be
called regardless of current status (available, claimed, or
picked_up). See `domains/rescue-board.md#item-lifecycle`.

## Input

```typescript
// DELETE /api/items/:id

// Response: 200 OK
interface RemoveItemResponse {
  id: string;
  status: 'removed';
}
```

## Acceptance Criteria

### `remove-01-marks-removed`

```yaml
criterion:
  id: remove-01-marks-removed
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-REMOVE-LISTING @criterion remove-01-marks-removed"
  predicate: |
    DELETE /api/items/:id returns 200 with status='removed'.
    Item no longer appears in GET /api/items feed.
  negative_cases:
    - Must NOT physically delete the record (soft delete only)
```

### `remove-02-any-status`

```yaml
criterion:
  id: remove-02-any-status
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-REMOVE-LISTING @criterion remove-02-any-status"
  predicate: |
    DELETE succeeds whether item status is 'available', 'claimed',
    or 'picked_up'. All return 200 with status='removed'.
  negative_cases:
    - Must NOT return 409 for claimed items (poster can always remove)
```

### `remove-03-not-found`

```yaml
criterion:
  id: remove-03-not-found
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-REMOVE-LISTING @criterion remove-03-not-found"
  predicate: |
    DELETE on a non-existent item id returns 404.
  negative_cases:
    - Must NOT return 200 for missing item
```

### `remove-04-idempotent`

```yaml
criterion:
  id: remove-04-idempotent
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-REMOVE-LISTING @criterion remove-04-idempotent"
  predicate: |
    DELETE on an already-removed item returns 200 (not 409).
    Operation is idempotent.
  negative_cases:
    - Must NOT error on double-remove
```
