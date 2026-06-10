---
id: REQ-CAP-POST-ITEM
schema_version: 4
name: Post a surplus item
category: capability
severity: critical
status: draft
boundary: POST /api/items
owners:
  technical: "@workshop-participant"
tags: [wave-1, create]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
---

# Post a surplus item

Creates a new SurplusItem in `available` status. The poster provides
a title, description, optional photo URL, category, and pickup
location. See `domains/rescue-board.md#item-lifecycle` for status
rules.

## Input

```typescript
// POST /api/items
interface CreateItemRequest {
  title: string;          // 1-100 chars, required
  description: string;    // 1-500 chars, required
  photoUrl?: string;      // valid URL or omitted
  category: 'food' | 'household' | 'other';
  pickupLocation: string; // 1-200 chars, required
  pickupLatLng?: { lat: number; lng: number };
  postedBy: string;       // 1-50 chars, display name
  expiresAt?: string;     // ISO 8601 datetime, optional
}

// Response: 201 Created
interface CreateItemResponse {
  id: string;             // UUID of created item
  status: 'available';
  createdAt: string;
}
```

## Acceptance Criteria

### `post-01-creates-available-item`

```yaml
criterion:
  id: post-01-creates-available-item
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-POST-ITEM @criterion post-01-creates-available-item"
  predicate: |
    POST /api/items with valid body returns 201, response contains
    a UUID id and status 'available'. Subsequent GET /api/items
    includes the new item in results.
  negative_cases:
    - Item must NOT be created with status other than 'available'
    - Response must NOT omit the id field
```

### `post-02-validates-required-fields`

```yaml
criterion:
  id: post-02-validates-required-fields
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-POST-ITEM @criterion post-02-validates-required-fields"
  predicate: |
    POST /api/items with missing title, description, category,
    pickupLocation, or postedBy returns 400 with a message naming
    the missing field(s).
  negative_cases:
    - Must NOT return 201 when required fields are missing
    - Must NOT return 500 (validation is pre-storage)
```

### `post-03-enforces-length-limits`

```yaml
criterion:
  id: post-03-enforces-length-limits
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-POST-ITEM @criterion post-03-enforces-length-limits"
  predicate: |
    title > 100 chars, description > 500 chars, pickupLocation >
    200 chars, or postedBy > 50 chars returns 400.
  negative_cases:
    - Must NOT truncate silently (reject, don't mangle)
```
