# `orchestration/dispatch/`

Per-wave-batch kickoff briefs the Captain hands to the manager at
Phase 5. One markdown file per dispatch:

```
orchestration/dispatch/
  w1-batch-1-kickoff.md     ← authored at Phase 4 step 7 (docs/USER-GUIDE.md)
  w1-batch-2-kickoff.md     ← when a wave runs multiple batches
  w2-batch-1-kickoff.md
  …
```

## Authorship lifecycle

| Phase | Actor | Action |
|---|---|---|
| Phase 4 step 7 | Captain (Claude-assisted) | Author `<wave>-batch-<N>-kickoff.md` |
| Phase 5 step 2 | Captain | `scion message manager "$(cat orchestration/dispatch/<wave>-batch-<N>-kickoff.md)"` |
| Phase 5+ | Manager | Acknowledges via `[manager-ready] <ts> wave-<N>-batch-<N>` commit (manager-kickoff.md Lifecycle Step 1) |
| Phase 7 | Captain | Final dispatch file is preserved as historical record (do not delete after wave close) |

## Required fields in a kickoff brief

Per [`docs/USER-GUIDE.md` §Phase 4 step 7](../../docs/USER-GUIDE.md#phase-4--plan-the-wave-claude-driven):

- Wave number + batch number
- Tracks in this batch (impl + audit)
- The gate id(s) that gate close-out
- Pre-composed prompt paths (one per track, from
  `orchestration/prompts/composed/`)
- Wave-specific recipe-lessons the Captain wants the manager to apply
- Manager workflow (create + start + message + poll + audit + merge)
- Hard rules (workers push only to their branch; manager messages
  workers; 3-cycle audit cap; UAT-in-env auth)
- Status reporting expectation
- Acknowledge-before-starting marker

See the Wave-1 example file when it lands (`w1-batch-1-kickoff.md` —
authored at Phase 4 of the first wave).

## File naming

`<wave-id>-batch-<batch-number>-kickoff.md` — kebab-case, matches the
git tag the Captain applies at the end of Phase 4
(`wave-<N>-batch-<M>-bundle`).
