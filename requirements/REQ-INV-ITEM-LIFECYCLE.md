---
id: REQ-INV-ITEM-LIFECYCLE
schema_version: 4
name: Item status lifecycle integrity
category: invariant
severity: critical
status: draft
boundary: all status-mutating endpoints
owners:
  technical: "@workshop-participant"
tags: [wave-1, invariant]
invariants_respected: []
domain: rescue-board
protocols:
  - item-lifecycle
---

# Item status lifecycle integrity

All status transitions must follow the state machine defined in
`domains/rescue-board.md`. No endpoint may produce an illegal
transition. This invariant is respected by every CAP that mutates
item status.

## Acceptance Criteria

### `lifecycle-01-no-illegal-transitions`

```yaml
criterion:
  id: lifecycle-01-no-illegal-transitions
  severity: critical
  verification:
    level: unit
    required_tags:
      - "@req REQ-INV-ITEM-LIFECYCLE @criterion lifecycle-01-no-illegal-transitions"
  predicate: |
    The only legal transitions are:
      available → claimed (via claim)
      claimed → picked_up (via confirm_pickup)
      claimed → available (via unclaim)
      any → removed (via delete)
    Attempting any other transition returns 409 Conflict.
  negative_cases:
    - available → picked_up must be rejected
    - picked_up → claimed must be rejected
    - removed → available must be rejected
```

### `lifecycle-02-status-never-null`

```yaml
criterion:
  id: lifecycle-02-status-never-null
  severity: critical
  verification:
    level: unit
    required_tags:
      - "@req REQ-INV-ITEM-LIFECYCLE @criterion lifecycle-02-status-never-null"
  predicate: |
    Every SurplusItem always has a non-null status field set to
    one of: 'available', 'claimed', 'picked_up', 'removed'.
  negative_cases:
    - Must never store null, empty string, or unknown enum value
```
