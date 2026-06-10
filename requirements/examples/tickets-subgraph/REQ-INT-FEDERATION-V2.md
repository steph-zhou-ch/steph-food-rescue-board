---
id: REQ-INT-FEDERATION-V2
schema_version: 4
name: Apollo Federation v2 contract
category: integration
severity: critical
status: draft
boundary: subgraph SDL + _entities resolver
owners:
  technical: "@chanlawrencet-ch"
tags: [federation, graphql, wave-1]
invariants_respected:
  - REQ-INV-TENANT-ISOLATION
domain: ticketing
protocols:
  - assignee-resolution
---

# Apollo Federation v2 contract

This subgraph declares `Ticket @key(fields: "id")` and extends
`User @key(fields: "id")` with `filedTickets` / `assignedTickets`.
The `_entities` resolver enforces tenant scope. See
`domains/ticketing.md#assignee-resolution` for how the User field
resolvers interact with the write path.

## SDL surface

```graphql
type Ticket @key(fields: "id") {
  id: ID!
  tenantId: ID!
  title: String!
  description: String
  status: TicketStatus!
  filedBy: User!
  assignedTo: User
  createdAt: DateTime!
  updatedAt: DateTime!
  transitions: [TicketTransition!]!
}

extend type User @key(fields: "id") {
  id: ID! @external
  filedTickets: [Ticket!]!
  assignedTickets: [Ticket!]!
}
```

## Acceptance Criteria

### `ticket-entity-key-declared`

```yaml
criterion:
  id: ticket-entity-key-declared
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion ticket-entity-key-declared"
  predicate: |
    Emitted SDL has `type Ticket @key(fields: "id")` with
    `id: ID!`. SDL uses Federation v2 (@link import syntax).
  negative_cases:
    - Ticket declared without @key
    - @key references a field other than id
    - SDL is Federation v1
```

### `user-extends-with-external-id`

```yaml
criterion:
  id: user-extends-with-external-id
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion user-extends-with-external-id"
  predicate: |
    SDL has `extend type User @key(fields: "id")` with
    `id: ID! @external`, `filedTickets: [Ticket!]!`, and
    `assignedTickets: [Ticket!]!`.
  negative_cases:
    - Declares `type User` without @extends (claims ownership)
    - id field missing @external
    - filedTickets or assignedTickets nullable
```

### `entities-resolver-resolves-ticket-by-id`

```yaml
criterion:
  id: entities-resolver-resolves-ticket-by-id
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion entities-resolver-resolves-ticket-by-id"
  predicate: |
    _entities with { __typename: "Ticket", id: T1 } scoped to
    tenant A (where T1 exists in A) → full Ticket projection at
    that index.
  negative_cases:
    - Returns null for a same-tenant Ticket that exists
    - Returns wrong type at the index
```

### `cross-tenant-entities-returns-null`

```yaml
criterion:
  id: cross-tenant-entities-returns-null
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion cross-tenant-entities-returns-null"
  predicate: |
    _entities with a Ticket id from tenant B, request scoped to
    tenant A → null at that index. No error reveals the row
    exists in another tenant.
  negative_cases:
    - Returns the cross-tenant Ticket
    - Error says "forbidden" or "wrong tenant"
  linked_invariants:
    - REQ-INV-TENANT-ISOLATION
```

### `user-fields-resolve-tenant-scoped`

```yaml
criterion:
  id: user-fields-resolve-tenant-scoped
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion user-fields-resolve-tenant-scoped"
  predicate: |
    _entities with { __typename: "User", id: U } scoped to
    tenant A: filedTickets returns tickets where filed_by=U in
    tenant A (non-null array); assignedTickets returns tickets
    where assigned_to=U in tenant A (non-null array). Zero
    matches → []. Cross-tenant request → [] for both.
  negative_cases:
    - filedTickets returns null instead of []
    - Returns tickets from another tenant
    - assignedTickets errors when no assignments exist
  linked_invariants:
    - REQ-INV-TENANT-ISOLATION
```

### `supergraph-compose-check-blocks-merge`

```yaml
criterion:
  id: supergraph-compose-check-blocks-merge
  severity: high
  verification:
    level: e2e
    required_tags:
      - "@req REQ-INT-FEDERATION-V2 @criterion supergraph-compose-check-blocks-merge"
  predicate: |
    CI runs `rover supergraph compose` against pinned sibling SDL
    on every PR. Breaking SDL change → gate fails, merge blocked.
    Valid SDL → gate passes.
  negative_cases:
    - Breaking change merges without gate failure
    - Gate uses stale sibling SDL
```
