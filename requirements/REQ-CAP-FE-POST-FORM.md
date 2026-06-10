---
id: REQ-CAP-FE-POST-FORM
schema_version: 4
name: Post item form with validation
category: capability
severity: critical
status: draft
boundary: PostItemForm page component
owners:
  technical: "@workshop-participant"
tags: [wave-1, frontend, create]
invariants_respected:
  - REQ-INV-ITEM-LIFECYCLE
domain: rescue-board
protocols:
  - item-lifecycle
designs:
  - surface: rescue-board
    node: "1:170"
---

# Post item form with validation

Full-page form for creating a new surplus item. Header has a back arrow
and "Post an Item" title. Form fields: photo upload (optional), title,
description, category, pickup location, expiry (optional), and poster
name. Submits to `POST /api/items`. See
`domains/rescue-board.md#item-lifecycle` for the resulting state.

## Input

```typescript
// Form submits to POST /api/items
// On success, navigates to the browse feed (or item detail)
```

## Acceptance Criteria

### `fe-post-01-renders-all-fields`

```yaml
criterion:
  id: fe-post-01-renders-all-fields
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-POST-FORM @criterion fe-post-01-renders-all-fields"
      - "@design rescue-board/post-form"
  predicate: |
    Form renders these fields in order: photo upload area (dashed
    border, upload icon, "Click to upload a photo" text), title input
    with 0/100 character counter, description textarea with 0/500
    character counter, category pill selector (Food/Household/Other),
    pickup location input, expires datetime picker (with "Leave blank
    if no specific deadline" helper), your name/organization input.
    Submit button reads "Post Item" (pill-shaped, dark bg, full width).
  negative_cases:
    - Character counters must NOT be missing
    - Category must default to Food (first option selected)
```

### `fe-post-02-required-field-indicators`

```yaml
criterion:
  id: fe-post-02-required-field-indicators
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FE-POST-FORM @criterion fe-post-02-required-field-indicators"
  predicate: |
    Required fields (title, description, category, pickup location,
    name) display a red asterisk (*) after the label. Optional fields
    (photo, expires) show "(optional)" in the label text instead.
  negative_cases:
    - Must NOT show asterisk on optional fields
```

### `fe-post-03-character-count-live`

```yaml
criterion:
  id: fe-post-03-character-count-live
  severity: high
  verification:
    level: unit
    required_tags:
      - "@req REQ-CAP-FE-POST-FORM @criterion fe-post-03-character-count-live"
  predicate: |
    Title shows "{current}/100" and description shows "{current}/500"
    updating live as the user types. When at limit, counter turns red
    and further input is prevented.
  negative_cases:
    - Must NOT allow typing beyond the character limit
```

### `fe-post-04-submits-and-navigates`

```yaml
criterion:
  id: fe-post-04-submits-and-navigates
  severity: critical
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-POST-FORM @criterion fe-post-04-submits-and-navigates"
  predicate: |
    Clicking "Post Item" with all required fields filled sends
    POST /api/items with the form data. On 201 response, navigates
    to the browse feed. Button is disabled while request is in flight.
  negative_cases:
    - Must NOT submit if required fields are empty (show validation)
    - Must NOT allow double-submit
```

### `fe-post-05-back-navigation`

```yaml
criterion:
  id: fe-post-05-back-navigation
  severity: medium
  verification:
    level: integration
    required_tags:
      - "@req REQ-CAP-FE-POST-FORM @criterion fe-post-05-back-navigation"
  predicate: |
    Back arrow in header navigates to the browse feed without
    submitting. If form has unsaved input, no confirmation is
    required (workshop simplification).
  negative_cases:
    - Must NOT submit the form on back navigation
```
