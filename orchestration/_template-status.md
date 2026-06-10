<!--
  orchestration/_template-status.md — template for orchestration/status.md
  Copy this file to orchestration/status.md at Phase 4 (wave planning) and
  fill in every TODO marker. The Captain reads status.md to track the
  wave; the manager updates it during dispatch (per manager-kickoff
  Lifecycle Steps 4, 5, 6, 7, 10).
  See docs/USER-GUIDE.md §Phase 4 step 6.
-->

# Engagement status board

> Last update: `TODO-ISO-TIMESTAMP` by `TODO-author` (Captain | manager)
> Phase: `TODO-N` · Wave: `TODO-N` · Batch: `TODO-M`
> Current state: `TODO-one-line-state` (e.g., "handoff bundle staged", "manager dispatched", "audit cycle 1 in flight", "wave closed")

## Active tracks

| Track id | Agent class | Branch | Status | Predecessors | Notes |
|---|---|---|---|---|---|
| `TODO-track-id` | `TODO-class` | `swarm/TODO-track-id` | `pending \| ready \| running \| complete \| audit-pending \| fixing` | `TODO-list` | `TODO-notes` |

## Audits

| Auditor | Verdict | Cycle | Reviewed shas | Findings |
|---|---|---|---|---|
| `w<N>-spec-adherence` | `pending \| approved \| rejected` | 1 / 2 / 3 | `TODO` | `TODO` |
| `w<N>-code-review-codex` | `pending \| approved \| rejected` | 1 / 2 / 3 | `TODO` | `TODO` |

## Gates

| Gate id | Eligible? | Last run | Result |
|---|---|---|---|
| `G.wave-<N>-<name>` | `TODO-yes-no-why` | `TODO-ts` | `pass \| fail \| not-yet-run` |

## Escalations

| Filed at | Short id | Kind | Captain decision | Resolution |
|---|---|---|---|---|
| (none) |   |   |   |   |

## Recent activity (manager-authored; newest first)

- `TODO-ISO-TIMESTAMP` — `TODO description` (manager)
- `TODO-ISO-TIMESTAMP` — `TODO description` (manager)

<!--
  Conventions:
  - Manager appends to "Recent activity" after every meaningful event
    (spawn, completion, audit, merge, escalation).
  - Captain only edits the header timestamp + the "Captain decision"
    column in the Escalations table.
  - When the wave closes, the manager appends `Wave <N> closed at <ts>`
    to Recent activity and the Captain commits the final state.
-->
