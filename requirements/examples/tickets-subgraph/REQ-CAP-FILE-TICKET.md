---
id: REQ-CAP-FILE-TICKET
schema_version: 4
name: File a ticket
category: capability
severity: critical
status: draft
boundary: mutation fileTicket
owners:
  technical: "@chanlawrencet-ch"
tags: [mutation, wave-2]
invariants_respected:
  - REQ-INV-TENANT-ISOLATION
  - REQ-INV-APPEND-ONLY-HISTORY
events_emitted:
  - TicketFiled.v1
domain: ticketing
protocols:
  - assignee-resolution
  - idempotency
---

# File a ticket

Creates a `Ticket` scoped to the caller's tenant with retry-safe
semantics via `clientRequestId`. The only write-time check on
`assigneeUserId` is UUID format (see `domains/ticketing.md
#assignee-resolution` for the full cross-capability protocol).

## Input

```graphql
mutation fileTicket(input: FileTicketInput!): FileTicketResult!

input FileTicketInput {
  clientRequestId: ID!   # UUIDv4, idempotency key
  title: String!         # 1..200 chars post-trim
  description: String    # 0..10_000 chars
  assigneeUserId: ID     # valid UUID or omit
}

union FileTicketResult = FileTicketSuccess | FileTicketError
```

Error codes: `TITLE_EMPTY | TITLE_TOO_LONG | DESCRIPTION_TOO_LONG
| ASSIGNEE_NOT_FOUND | IDEMPOTENCY_CONFLICT | RATE_LIMITED`

## Acceptance Criteria

### `accepts-valid-input`

```yaml
criterion:
  id: accepts-valid-input
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion accepts-valid-input"
  predicate: |
    Valid FileTicketInput → FileTicketSuccess. Persisted row has
    status='open', title=trimmed input, filed_by=caller,
    tenant_id=caller's tenant. ticket_transitions row:
    null→open. Outbox row: TicketFiled.v1.
  negative_cases:
    - Valid input returns FileTicketError
    - Persisted row has wrong status or fields
```

### `idempotent-replay-returns-original`

```yaml
criterion:
  id: idempotent-replay-returns-original
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion idempotent-replay-returns-original"
  predicate: |
    Same clientRequestId + identical payload → returns original
    Ticket. No new rows in tickets, ticket_transitions, or outbox.
  negative_cases:
    - Replay creates a second ticket
    - Replay enqueues a second outbox row
```

### `idempotency-conflict-on-payload-mismatch`

```yaml
criterion:
  id: idempotency-conflict-on-payload-mismatch
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion idempotency-conflict-on-payload-mismatch"
  predicate: |
    Same clientRequestId + different payload → FileTicketError
    IDEMPOTENCY_CONFLICT. No new rows written.
  negative_cases:
    - Mismatched payload silently returns original ticket
    - Mismatched payload creates a new ticket
```

### `malformed-assignee-returns-not-found`

```yaml
criterion:
  id: malformed-assignee-returns-not-found
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion malformed-assignee-returns-not-found"
  predicate: |
    assigneeUserId present but not a valid UUID → FileTicketError
    ASSIGNEE_NOT_FOUND. No ticket persisted.
  negative_cases:
    - Malformed UUID is persisted
    - Returns a different error code
```

### `valid-assignee-persisted-at-write`

```yaml
criterion:
  id: valid-assignee-persisted-at-write
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion valid-assignee-persisted-at-write"
  predicate: |
    assigneeUserId is a valid UUID → FileTicketSuccess.
    assigned_to = provided UUID in DB. No HTTP call to
    users-subgraph during the write path.
  negative_cases:
    - Valid UUID returns ASSIGNEE_NOT_FOUND
    - Write path makes outbound HTTP call
    - assigned_to is null despite valid UUID provided
  linked_invariants:
    - REQ-INV-TENANT-ISOLATION
    - REQ-INT-FEDERATION-V2
```

### `tenant-isolation-write-rls`

```yaml
criterion:
  id: tenant-isolation-write-rls
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion tenant-isolation-write-rls"
  predicate: |
    Ticket inserted under tenant A carries tenant_id=A.
    Read scoped to tenant B returns zero rows for that ticket.
    SET LOCAL app.tenant_id issued before DML.
  negative_cases:
    - Inserted row has wrong tenant_id
    - Cross-tenant read returns the row
    - Transaction skips SET LOCAL
  linked_invariants:
    - REQ-INV-TENANT-ISOLATION
```

### `rejects-empty-title`

```yaml
criterion:
  id: rejects-empty-title
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion rejects-empty-title"
  predicate: |
    Title "" or whitespace-only → FileTicketError TITLE_EMPTY.
    No DB write.
  negative_cases:
    - Empty title returns Success
    - Whitespace-only title accepted
```

### `rejects-overlong-title`

```yaml
criterion:
  id: rejects-overlong-title
  severity: medium
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion rejects-overlong-title"
  predicate: |
    Title > 200 chars → FileTicketError TITLE_TOO_LONG.
    Title of exactly 200 chars is accepted. No DB write on reject.
  negative_cases:
    - 201-char title returns Success
    - 200-char title is rejected
```

### `emits-ticket-filed-event`

```yaml
criterion:
  id: emits-ticket-filed-event
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FILE-TICKET @criterion emits-ticket-filed-event"
  predicate: |
    Successful fileTicket → exactly one outbox row with
    event_type='TicketFiled.v1', payload has tenant_id, ticket_id,
    filed_by, filed_at, optional assignee_user_id. Idempotent
    replay does NOT enqueue a second row.
  negative_cases:
    - Success with no outbox row
    - Replay writes a second outbox row
```
