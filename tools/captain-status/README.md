# captain-status

A **one-glance, git-reconciled** snapshot of the swarm — the trustworthy answer
to "what's the status?" without polling the manager or trusting a stale dashboard.

```bash
pnpm captain-status
```

Runs in ~1–2s (a single fetch + a few git reads — no audit fan-out). Prints:

- **Trunk** tip + subject, and **how long since the last trunk advance**
  (with a ⚠ if it's been ≥30 min — a stall signal).
- **Phase / Wave / Batch** and the current-state line, read from
  `origin/main:orchestration/status.md` (the manager's own board).
- **In-flight tracks** — unmerged impl branches ahead of trunk, excluding
  auditor/verdict branches and any branch whose wave already has a closure
  report (so rebased/squashed tips don't read as false in-flight).
- **Recent escalations** + their `Status:` line.
- **Containers** — `manager` + worker states from `scion list`.

## Why it exists
Status-polling was the loudest signal in the engagement retrospective: the
Captain asked "what's the status / latest?" 30+ times, and ~52% of all
manager interaction was status-checking rather than direction. The truth always
lived in git (trunk + status board + branches + escalations); this surfaces it
directly so the human never has to ask the copilot to assemble it.

Source of truth is **`origin/main`**, fetched fresh each run. Maps to the
retrospective P0 #2.
