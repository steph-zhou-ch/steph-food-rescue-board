---
id: REQ-CAP-GET-ITEM
schema_version: 4
name: Get a single item by id
category: capability
severity: high
status: draft
boundary: GET /api/items/:id
owners:
  technical: "@workshop-participant"
tags: [wave-1, read]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
---

# Get a single item by id

Returns the full SurplusItem record for a given id, regardless of
status. Used by the item detail page to render the current state.
See `domains/rescue-board.md#item-lifecycle` for status values.

## Input

```typescript
// GET /api/items/:id

// Response: 200 OK
interface GetItemResponse {
  id: string;
  title: string;
  description: string;
  photoUrl: string | null;
  category: 'food' | 'household' | 'other';
  pickupLocation: string;
  pickupLatLng: { lat: number; lng: number } | null;
  postedBy: string;
  status: 'available' | 'claimed' | 'picked_up' | 'removed';
  claimedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}
```

## Acceptance Criteria

### `get-item-01-returns-full-record`

```yaml
criterion:
  id: get-item-01-returns-full-record
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-GET-ITEM @criterion get-item-01-returns-full-record"
  predicate: |
    GET /api/items/:id returns 200 with the complete SurplusItem
    including all fields (status, claimedBy, expiresAt, etc.)
    regardless of the item's current status.
  negative_cases:
    - Must NOT filter out claimed or removed items (detail page shows all states)
```

### `get-item-02-not-found`

```yaml
criterion:
  id: get-item-02-not-found
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-GET-ITEM @criterion get-item-02-not-found"
  predicate: |
    GET /api/items/:id with a non-existent UUID returns 404.
  negative_cases:
    - Must NOT return 500 for a missing item
    - Must NOT return 200 with null body
```
