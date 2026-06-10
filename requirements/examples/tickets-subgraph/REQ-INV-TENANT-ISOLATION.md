---
id: REQ-INV-TENANT-ISOLATION
schema_version: 4
name: Tenant isolation via RLS triplet + GUC handshake
category: invariant
severity: critical
status: draft
boundary: all tenant-scoped tables + repository layer
owners:
  technical: "@chanlawrencet-ch"
  security: "@chanlawrencet-ch"
tags: [tenant-isolation, rls, security, wave-1]
---

# Tenant isolation via RLS triplet + GUC handshake

Every tenant-scoped table has ENABLE + FORCE + canonical policy on
`current_setting('app.tenant_id')`. Every write transaction issues
`SET LOCAL app.tenant_id` before DML. Cross-tenant access surfaces
as "not found", never as an auth error.

## Rules

- RLS triplet applied in the same migration that creates the table.
- Writes: `SET LOCAL app.tenant_id = <claim>` before any DML.
- Cross-tenant reads: zero rows.
- Cross-tenant writes: domain's "not found" variant (never
  AuthorizationError, never existence-leak).

## Acceptance Criteria

### `rls-triplet-on-every-tenant-scoped-table`

```yaml
criterion:
  id: rls-triplet-on-every-tenant-scoped-table
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INV-TENANT-ISOLATION @criterion rls-triplet-on-every-tenant-scoped-table"
  predicate: |
    For every tenant-scoped table: pg_class.relrowsecurity = true,
    relforcerowsecurity = true, and a policy exists whose
    qual + with_check reference current_setting('app.tenant_id').
  negative_cases:
    - Table created without ENABLE ROW LEVEL SECURITY
    - ENABLE present but FORCE missing
    - Policy hardcodes a literal tenant id
```

### `set-local-guc-at-write-time`

```yaml
criterion:
  id: set-local-guc-at-write-time
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INV-TENANT-ISOLATION @criterion set-local-guc-at-write-time"
  predicate: |
    Every write path issues SET LOCAL app.tenant_id inside its
    transaction before tenant-scoped DML. A transaction without
    SET LOCAL fails (zero inserts), never succeeds silently.
  negative_cases:
    - DML issued without prior SET LOCAL
    - Uses SET (session-scoped) instead of SET LOCAL
    - Successful insert with unset GUC
```

### `cross-tenant-read-returns-zero-rows`

```yaml
criterion:
  id: cross-tenant-read-returns-zero-rows
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INV-TENANT-ISOLATION @criterion cross-tenant-read-returns-zero-rows"
  predicate: |
    Two tenants T1, T2 each with data. Query pinned to T1 returns
    only T1's rows across all tenant-scoped tables.
  negative_cases:
    - SELECT from T1 returns any row with tenant_id = T2
```

### `cross-tenant-write-surfaces-as-not-found`

```yaml
criterion:
  id: cross-tenant-write-surfaces-as-not-found
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-INV-TENANT-ISOLATION @criterion cross-tenant-write-surfaces-as-not-found"
  predicate: |
    A write targeting a row in another tenant returns the domain's
    "not found" variant. No error message distinguishes "wrong
    tenant" from "missing." No telemetry reveals the cross-tenant
    case.
  negative_cases:
    - Returns AuthorizationError or Forbidden
    - Error message says "permission denied"
    - Log includes the other tenant's id
```
