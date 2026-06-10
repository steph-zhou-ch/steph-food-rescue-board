---
domain: rescue-board
bounded_context: food-rescue-board
participants:
  - REQ-CAP-POST-ITEM
  - REQ-CAP-BROWSE-FEED
  - REQ-CAP-GET-ITEM
  - REQ-CAP-CLAIM-ITEM
  - REQ-CAP-REMOVE-LISTING
  - REQ-CAP-FE-BROWSE-FEED
  - REQ-CAP-FE-POST-FORM
  - REQ-CAP-FE-ITEM-DETAIL
  - REQ-INV-ITEM-LIFECYCLE
---

# Rescue board

A localized board where restaurants, grocery stores, or individuals
post surplus food or items about to go to waste, and local shelters
or neighbors can claim them.

## Data model

### SurplusItem

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| title | string | Short name (e.g., "12 bagels") |
| description | string | Free text, max 500 chars |
| photoUrl | string? | Optional image URL |
| category | enum | `food`, `household`, `other` |
| pickupLocation | string | Address or landmark description |
| pickupLatLng | {lat, lng}? | Optional coordinates for map view |
| postedBy | string | Display name of the poster |
| status | enum | `available` → `claimed` → `picked_up` |
| claimedBy | string? | Display name of claimer |
| createdAt | timestamp | When the item was posted |
| expiresAt | timestamp? | Optional expiry (auto-removes from feed) |

### Status state machine

```
available ──claim──▶ claimed ──confirm-pickup──▶ picked_up
    │                    │
    └──remove──▶ removed  └──unclaim──▶ available
```

Items in `picked_up` or `removed` state do not appear in the feed.

## Item lifecycle protocol

Participants: REQ-CAP-POST-ITEM (creates), REQ-CAP-CLAIM-ITEM
(transitions), REQ-CAP-REMOVE-LISTING (terminates),
REQ-CAP-BROWSE-FEED (reads)

A SurplusItem enters the system in `available` status. Only
`available` items appear in the browse feed/map. Claiming
transitions to `claimed`; confirming pickup transitions to
`picked_up`. The poster can remove at any time (any status →
`removed`). A claimer can unclaim, returning to `available`.

Design decision: no auth for the workshop — anyone can post, claim,
or remove. Real deployment would add identity.

## Feed filtering protocol

Participants: REQ-CAP-BROWSE-FEED (consumer)

The feed shows only items where `status = 'available'` AND
(`expiresAt` is null OR `expiresAt > now()`). Default sort is
newest-first. Optional category filter narrows results.

## Expiry protocol

Items with `expiresAt` in the past are treated as removed for
display purposes. A background sweep (or lazy check on read)
handles cleanup. For the workshop, lazy filtering on read is
sufficient.

## Visual design tokens

Participants: REQ-CAP-FE-BROWSE-FEED, REQ-CAP-FE-POST-FORM,
REQ-CAP-FE-ITEM-DETAIL

From the Figma designs (file key: S2lGRVcSKnrBF6mu4A0e6r):

| Token | Value | Usage |
|-------|-------|-------|
| bg-page | #fcfbfa | Page background |
| bg-card | #ffffff | Card and form backgrounds |
| border-default | #dfdbd2 | Card borders, input borders, dividers |
| text-primary | #0e0c21 | Headings, body text |
| text-muted | #6d675e | Secondary text, labels, timestamps |
| text-placeholder | rgba(14,12,33,0.5) | Input placeholders |
| badge-food | #dc8226 | Food category badge (orange) |
| badge-household | #5893d3 | Household category badge (blue) |
| badge-other | #77a9a0 | Other category badge (teal) |
| badge-available | #738958 | Available status badge (green) |
| badge-claimed | #dc8226 | Claimed status badge (orange) |
| badge-neutral | #edebe5 | Secondary/category badge on detail |
| btn-primary | #0e0c21 | Primary buttons (post, dark actions) |
| btn-claim | #3c6ebc | Claim action button (blue) |
| text-danger | #b5292b | Expiry dates, required asterisks |
| radius-card | 16px | Card border radius |
| radius-pill | 9999px | Buttons, badges, filter pills |
| radius-input | 10px | Text inputs and textareas |
| font-heading | Geist Bold | Titles, headings |
| font-body | Inter | Body text, labels, buttons |

## Figma surfaces

| Surface | Node | CAPs served |
|---------|------|-------------|
| `rescue-board` | `1:2` | REQ-CAP-FE-BROWSE-FEED |
| `rescue-board` | `1:170` | REQ-CAP-FE-POST-FORM |
| `rescue-board` | `1:239` | REQ-CAP-FE-ITEM-DETAIL (available) |
| `rescue-board` | `1:308` | REQ-CAP-FE-ITEM-DETAIL (claimed) |
