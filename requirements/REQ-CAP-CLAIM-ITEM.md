---
id: REQ-CAP-CLAIM-ITEM
schema_version: 4
name: Claim or mark item as picked up
category: capability
severity: critical
status: draft
boundary: PATCH /api/items/:id/status
owners:
  technical: "@workshop-participant"
tags: [wave-1, update]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
---

# Claim or mark item as picked up

Transitions a SurplusItem through the lifecycle: `available` →
`claimed` → `picked_up`. Also supports unclaiming (`claimed` →
`available`). See `domains/rescue-board.md#item-lifecycle` for the
full state machine.

## Input

```typescript
// PATCH /api/items/:id/status
interface UpdateStatusRequest {
  action: 'claim' | 'unclaim' | 'confirm_pickup';
  claimedBy?: string;    // required for 'claim', 1-50 chars
}

// Response: 200 OK
interface UpdateStatusResponse {
  id: string;
  status: 'available' | 'claimed' | 'picked_up';
  claimedBy: string | null;
}
```

## Acceptance Criteria

### `claim-01-available-to-claimed`

```yaml
criterion:
  id: claim-01-available-to-claimed
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-CLAIM-ITEM @criterion claim-01-available-to-claimed"
  predicate: |
    PATCH with action='claim' on an 'available' item returns 200
    with status='claimed' and claimedBy set. Item no longer appears
    in GET /api/items feed.
  negative_cases:
    - Must NOT allow claim on an already-claimed item (returns 409)
    - Must NOT allow claim without claimedBy field (returns 400)
```

### `claim-02-claimed-to-picked-up`

```yaml
criterion:
  id: claim-02-claimed-to-picked-up
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-CLAIM-ITEM @criterion claim-02-claimed-to-picked-up"
  predicate: |
    PATCH with action='confirm_pickup' on a 'claimed' item returns
    200 with status='picked_up'.
  negative_cases:
    - Must NOT allow confirm_pickup on 'available' item (returns 409)
    - Must NOT allow confirm_pickup on 'picked_up' item (returns 409)
```

### `claim-03-unclaim-returns-to-available`

```yaml
criterion:
  id: claim-03-unclaim-returns-to-available
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-CLAIM-ITEM @criterion claim-03-unclaim-returns-to-available"
  predicate: |
    PATCH with action='unclaim' on a 'claimed' item returns 200
    with status='available' and claimedBy=null. Item reappears
    in the browse feed.
  negative_cases:
    - Must NOT allow unclaim on 'available' item (returns 409)
```

### `claim-04-not-found`

```yaml
criterion:
  id: claim-04-not-found
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-CLAIM-ITEM @criterion claim-04-not-found"
  predicate: |
    PATCH on a non-existent item id returns 404.
  negative_cases:
    - Must NOT return 500 for missing item
```
