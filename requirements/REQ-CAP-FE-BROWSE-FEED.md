---
id: REQ-CAP-FE-BROWSE-FEED
schema_version: 4
name: Render item feed with category filters
category: capability
severity: critical
status: draft
boundary: BrowseFeed page component
owners:
  technical: "@workshop-participant"
tags: [wave-1, frontend, read]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - feed-filtering
designs:
  - surface: rescue-board
    node: "1:2"
---

# Render item feed with category filters

Renders the main feed of available surplus items as a responsive card
grid. Includes a header with item count and "+ Post Item" CTA, category
filter pills, and item cards. Data sourced from `GET /api/items`. See
`domains/rescue-board.md#feed-filtering` for which items appear.

## Input

```typescript
// Data fetched from GET /api/items?category={selected}
// Renders as a card grid with category filter tabs
```

## Acceptance Criteria

### `fe-feed-01-renders-card-grid`

```yaml
criterion:
  id: fe-feed-01-renders-card-grid
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-01-renders-card-grid"
      - "@design rescue-board/browse-feed"
  predicate: |
    Each available item renders as a card showing: photo (or emoji
    placeholder if no photo), category badge (color-coded: food=orange,
    household=blue, other=teal), title (bold, single line truncated),
    pickup location with pin icon, posted-by with person icon, and
    relative time with clock icon.
  negative_cases:
    - Card must NOT render without a category badge
    - Cards without photos must show a colored placeholder, not a broken image
```

### `fe-feed-02-category-filter-pills`

```yaml
criterion:
  id: fe-feed-02-category-filter-pills
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-02-category-filter-pills"
      - "@design rescue-board/browse-feed"
  predicate: |
    Four filter pills render below the header: All, Food, Household,
    Other. The active pill is filled dark (bg-dark, text-white); inactive
    pills are outlined (border, text-muted). Clicking a pill filters the
    feed to that category (or shows all). Only one pill is active at a
    time.
  negative_cases:
    - Multiple pills must NOT be active simultaneously
    - Clicking the already-active pill must NOT deselect it (All is the reset)
```

### `fe-feed-03-header-with-count-and-cta`

```yaml
criterion:
  id: fe-feed-03-header-with-count-and-cta
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-03-header-with-count-and-cta"
  predicate: |
    Header shows "Rescue Board" title, subtitle "{N} items available
    nearby" reflecting the current filtered count, and a "+ Post Item"
    button (pill-shaped, dark bg) that navigates to the post form.
  negative_cases:
    - Count must update when category filter changes
    - Button must NOT submit a form — it navigates to the post page
```

### `fe-feed-04-card-navigates-to-detail`

```yaml
criterion:
  id: fe-feed-04-card-navigates-to-detail
  severity: high
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-04-card-navigates-to-detail"
  predicate: |
    Clicking an item card navigates to the item detail view for that
    item's id.
  negative_cases:
    - Must NOT open in a new tab (SPA navigation)
```

### `fe-feed-05-responsive-grid`

```yaml
criterion:
  id: fe-feed-05-responsive-grid
  severity: medium
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-05-responsive-grid"
  predicate: |
    Cards lay out in a responsive grid: 3 columns on wide viewports,
    2 on medium, 1 on narrow. Cards have consistent height with photo
    area fixed at 180px and content below.
  negative_cases:
    - Cards must NOT overflow the viewport horizontally
```
