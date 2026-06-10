---
id: REQ-CAP-BROWSE-FEED
schema_version: 4
name: Browse available items
category: capability
severity: critical
status: draft
boundary: GET /api/items
owners:
  technical: "@workshop-participant"
tags: [wave-1, read]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - feed-filtering
---

# Browse available items

Returns the list of surplus items currently available for pickup.
Only items with `status = 'available'` and non-expired `expiresAt`
appear. See `domains/rescue-board.md#feed-filtering` for rules.

## Input

```typescript
// GET /api/items?category=food
interface BrowseFeedQuery {
  category?: 'food' | 'household' | 'other'; // optional filter
}

// Response: 200 OK
interface BrowseFeedResponse {
  items: SurplusItem[];   // sorted newest-first
}
```

## Acceptance Criteria

### `browse-01-returns-available-only`

```yaml
criterion:
  id: browse-01-returns-available-only
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-BROWSE-FEED @criterion browse-01-returns-available-only"
  predicate: |
    GET /api/items returns only items where status = 'available'.
    Items that are 'claimed', 'picked_up', or 'removed' must NOT
    appear in the response.
  negative_cases:
    - Claimed items must NOT appear
    - Removed items must NOT appear
```

### `browse-02-filters-expired`

```yaml
criterion:
  id: browse-02-filters-expired
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-BROWSE-FEED @criterion browse-02-filters-expired"
  predicate: |
    Items with expiresAt in the past are excluded from results,
    even if their status is still 'available'.
  negative_cases:
    - Must NOT include items where expiresAt < now()
```

### `browse-03-category-filter`

```yaml
criterion:
  id: browse-03-category-filter
  severity: medium
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-BROWSE-FEED @criterion browse-03-category-filter"
  predicate: |
    GET /api/items?category=food returns only items with
    category='food'. Omitting the query param returns all categories.
  negative_cases:
    - Invalid category value must return 400, not empty results
```

### `browse-04-newest-first`

```yaml
criterion:
  id: browse-04-newest-first
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-BROWSE-FEED @criterion browse-04-newest-first"
  predicate: |
    Items are sorted by createdAt descending. The first item in
    the array has the most recent createdAt.
  negative_cases:
    - Must NOT return unsorted or oldest-first
```
