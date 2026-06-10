---
id: REQ-INV-FE-01-DESIGN-FIDELITY
schema_version: 4
name: Calendar matches the Figma design manifest
category: invariant
severity: high
status: draft
boundary: all calendar components + Storybook stories + tokens.json
owners:
  technical: "@lawrence.chan"
tags: [wave-1, design, storybook]
domain: provider-calendar
protocols:
  - component-reuse-rules
designs:
  - surface: provider-week
    node: "23:7858"
---

# Calendar matches the Figma design manifest

Every significant visual element has a Storybook story tagged
`@design <surface>/<node-name>`. Colors and spacing from
`tokens.json` only — no hex/px literals. Components from `@ch/ui`
only — no local re-implementations. See
`domains/provider-calendar.md#component-reuse-rules`.

## Acceptance Criteria

### `inv-01-required-design-tags-present`

```yaml
criterion:
  id: inv-01-required-design-tags-present
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-INV-FE-01-DESIGN-FIDELITY @criterion inv-01-required-design-tags-present"
  predicate: |
    Storybook story index contains at least one story for each
    required @design tag: provider-week/calendar-grid,
    provider-week/today-column, provider-week/availability-tile,
    provider-week/appointment-tile, provider-week/empty-cell-hover.
  negative_cases:
    - Typo'd surface name (e.g. 'provider-weekly/...') must NOT satisfy
    - Story without @design tag must NOT satisfy
```

### `inv-01-tokens-not-hardcoded`

```yaml
criterion:
  id: inv-01-tokens-not-hardcoded
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-INV-FE-01-DESIGN-FIDELITY @criterion inv-01-tokens-not-hardcoded"
  predicate: |
    No source file under apps/web/src/calendar/** contains a hex
    color literal or px/rem spacing literal in a JSX style prop.
    All values resolve through the Tailwind theme bridge from
    tokens.json.
  negative_cases:
    - JSX style with hex literal (background: '#fff') must fail
    - JSX style with px literal (paddingTop: '12px') must fail
    - Tailwind token class (bg-calendar-today-column) must pass
```
