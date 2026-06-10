---
id: REQ-<CATEGORY>-<NAME>
schema_version: 4
name: <PM-readable requirement name>
category: capability | invariant | integration
severity: critical | high | medium | low
status: draft | approved | deprecated
boundary: <the code path this REQ owns — e.g., "mutation fileTicket", "urql auth exchange", "all tenant-scoped tables">
owners:
  technical: "@tech-handle"
tags:
  - <wave-N>
  - <free-form tags>
invariants_respected:
  - REQ-INV-<NAME>               # which invariants this REQ must honor
domain: <domain-slug>             # matches a file under domains/
protocols:
  - <protocol-section-heading>   # sections in the domain file this REQ participates in
events_emitted:                  # optional; omit if none
  - <EventType.vN>
designs:                         # optional; omit for non-UI REQs
  - surface: <surface-slug>
    node: "<figma-node-id>"
consumes:                        # optional; for cross-repo dependencies
  - repo: <repo-name>
    req: <REQ-ID>
    contract_path: <path>
business_rationale: |            # optional; 2-3 sentences if non-obvious
  Why this REQ exists in business terms.
---

# <Requirement name>

<2-3 sentence summary. What this code path does. Reference
`domains/<context>.md#<protocol>` for cross-CAP context.>

## Input

<Optional. The GraphQL operation, API shape, or CLI interface this
boundary exposes. Fenced code block.>

```graphql
# or ```typescript, ```bash, etc.
```

## Acceptance Criteria

### `<criterion-id>`

```yaml
criterion:
  id: <criterion-id>            # MUST match section heading
  severity: critical | high | medium | low
  verification:
    level: unit | integration | e2e | manual
    required_tags:
      - "@req <REQ-ID> @criterion <criterion-id>"
      # For UI criteria, also:
      # - "@design <surface-slug>/<node-name>"
  predicate: |
    Machine-readable rule the test asserts. 2-4 lines max.
    Reference domain protocols by name rather than re-asserting
    cross-cutting rules.
  negative_cases:
    - What must NOT happen (1)
    - What must NOT happen (2)
  linked_invariants:             # optional
    - REQ-INV-<NAME>
```

### `<next-criterion-id>`

```yaml
criterion:
  ...
```
