---
domain: ticketing
bounded_context: tickets-subgraph
participants:
  - REQ-CAP-FILE-TICKET
  - REQ-CAP-TRANSITION-TICKET
  - REQ-CAP-LIST-TICKETS
  - REQ-CAP-VIEW-TICKET
  - REQ-INT-FEDERATION-V2
---

# Ticketing domain

## Data model

```
tickets (
  id            UUID PK,
  tenant_id     UUID NOT NULL,
  title         TEXT NOT NULL,          -- 1..200 chars post-trim
  description   TEXT,                   -- 0..10_000 chars
  status        TEXT NOT NULL,          -- see §Status lifecycle
  filed_by      UUID NOT NULL,
  assigned_to   UUID,                   -- see §Assignee resolution
  filed_at      TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
)

ticket_transitions (
  id            UUID PK,
  ticket_id     UUID NOT NULL,
  tenant_id     UUID NOT NULL,
  from_status   TEXT,                   -- NULL for initial filing
  to_status     TEXT NOT NULL,
  actor         UUID NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  reason        TEXT
)
```

RLS triplet on both tables per REQ-INV-TENANT-ISOLATION.

## Assignee resolution protocol

Participants: REQ-CAP-FILE-TICKET (write), REQ-INT-FEDERATION-V2 (read)

Design: dependency-free at write time. tickets-subgraph has no
runtime dependency on users-subgraph during mutations.

- **Write path** (fileTicket): validates UUID format only; persists
  `assigned_to` as given. Malformed UUID → `ASSIGNEE_NOT_FOUND`.
  No existence check, no HTTP call to users-subgraph.
- **Read path** (router): resolves `Ticket.assignedTo: User` via
  users-subgraph `_entities`. Non-existent user → `null` on the
  field. Cross-tenant user → `null` (RLS on users side).
- **User field resolvers** (`User.filedTickets`, `User.assignedTickets`):
  query tickets DB with `filed_by = parent.id` / `assigned_to = parent.id`
  under tenant RLS. Always return `[]`, never null.

Supersedes: write-time federated lookup (retired Wave 6).

## Status lifecycle protocol

Participants: REQ-CAP-FILE-TICKET (creates), REQ-CAP-TRANSITION-TICKET (mutates), REQ-CAP-LIST-TICKETS (filters)

```
OPEN → IN_PROGRESS → RESOLVED → CLOSED
```

- **Wire enum:** `OPEN | IN_PROGRESS | RESOLVED | CLOSED` (uppercase)
- **Storage:** text column, historically lowercase from fileTicket
- **Contract:** all SQL comparisons are case-insensitive
  (`LOWER(status) = LOWER($2)`). The read boundary normalizes to
  uppercase before returning to GraphQL wire.
- **Transitions:** only forward along the graph above. Illegal
  transitions return `ILLEGAL_TRANSITION`.
- **History:** every transition appends to `ticket_transitions`
  (append-only per REQ-INV-APPEND-ONLY-HISTORY). No row is ever
  updated or deleted.

## Idempotency protocol

Participants: REQ-CAP-FILE-TICKET

- Key: `(tenant_id, client_request_id)` with a DB unique index.
- Replay with identical payload → return original ticket, no side effects.
- Replay with different payload → `IDEMPOTENCY_CONFLICT`.
- Different key, same content → new ticket (no content-based dedup).
- Window: indefinite (no TTL).

## Event contracts

| Event | Producer | Payload |
|-------|----------|---------|
| `TicketFiled.v1` | REQ-CAP-FILE-TICKET | tenant_id, ticket_id, filed_by, filed_at, assignee_user_id? |
| `TicketTransitioned.v1` | REQ-CAP-TRANSITION-TICKET | tenant_id, ticket_id, from_status, to_status, actor, occurred_at |
