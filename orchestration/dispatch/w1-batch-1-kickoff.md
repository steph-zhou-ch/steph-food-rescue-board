# Wave 1 — kickoff brief (food-rescue board)

> Hand this to the manager at Phase 5:
> `scion message manager "$(cat orchestration/dispatch/w1-batch-1-kickoff.md)"`
> The manager acknowledges with a `[manager-ready] <ISO> wave-1` commit.

## Wave / batch

- **Wave:** 1
- **Batches:** 1 → 2 → 3 (sequential by DAG; see below)
- **Close-out gate:** `G.wave-1`

## The wave goal

Ship a working food-rescue board: a backend items REST API (in-memory
store, no DB) plus three frontend pages (browse feed, item detail, post
form). Six tracks across three batches, gated by two spec-adherence
audits.

## Tracks in this wave (DAG order)

| Batch | Track id | Agent class | Depends on | Composed prompt |
|---|---|---|---|---|
| 1 | `w1-api-items` | application-services-agent | — | `orchestration/prompts/composed/w1-api-items.md` |
| 2 | `w1-fe-browse-feed` | foundations-agent | `w1-api-items` | `orchestration/prompts/composed/w1-fe-browse-feed.md` |
| 2 | `w1-fe-item-detail` | foundations-agent | `w1-api-items` | `orchestration/prompts/composed/w1-fe-item-detail.md` |
| 2 | `w1-fe-post-form` | foundations-agent | `w1-api-items` | `orchestration/prompts/composed/w1-fe-post-form.md` |
| 3 | `w1-audit-api` | spec-adherence-agent | `w1-api-items` | `orchestration/prompts/composed/w1-audit-api.md` |
| 3 | `w1-audit-fe` | spec-adherence-agent | all 3 FE tracks | `orchestration/prompts/composed/w1-audit-fe.md` |

Batch 1 ships first (no predecessors). The three batch-2 FE tracks all
depend on `w1-api-items` and run in parallel once it completes. Batch-3
audits run after their respective impl tracks complete.

## Manager workflow (per track)

For each track whose predecessors are all `[complete:<id>]`:

1. `scion create <track-id> --harness <claude|...> -b swarm/<track-id>`
   — application/foundations tracks use `--harness claude`;
   spec-adherence audits use `--harness claude`.
2. Pre-create the worktree manually (Gotcha 2):
   `git worktree add /repo-root/.scion/agents/<track-id>/workspace -b swarm/<track-id>`
3. `scion start <track-id>`
4. `scion message --raw <track-id> $'\r'` — **REQUIRED** to dismiss the
   welcome screen before every prompt-bearing message (Gotcha 9).
5. **Pointer-message dispatch** (see hard rules): send only
   `Read 'orchestration/prompts/composed/<track-id>.md' for your full
   brief. First run: git fetch origin swarm/<track-id> && git checkout
   swarm/<track-id>. Then begin Phase 1 of your standard workflow and
   push every TDD pair.`
6. Poll `origin/swarm/<track-id>` for the `[complete:<track-id>]` commit.
7. On all impl tracks complete → spawn the matching audit track(s).
8. On audits `approved` → stage-merge in DAG order, run
   `./orchestration/gates/gate-check.sh G.wave-1`, then merge staging →
   trunk and re-run the gate on trunk.
9. Write `orchestration/reports/w1-closure.md`; update
   `orchestration/status.md` to `wave-1: closed`.

## Hard rules

- **Workers push only to their own `swarm/<track-id>` branch.** Never to
  `main`.
- **Workers must embed the token in the remote** (Gotcha 16):
  `git remote set-url origin https://x-access-token:${GITHUB_TOKEN}@github.com/steph-zhou-ch/steph-food-rescue-board.git`
- **Push every TDD pair, never batch** (Gotcha — container exits lose
  unpushed work). Re-emphasize on every worker restart.
- **Pointer-message dispatch is the default.** Composed prompts are
  11–22KB; do not paste bodies inline — send the `Read '...'` pointer so
  truncation can't silently drop the brief.
- **`--raw $'\r'` before every prompt**, on every `scion start` (initial
  spawn AND restarts).
- **Audit cap: 3 cycles.** If a track is still rejected after 3 fix
  cycles, file an escalation to `orchestration/escalations/` and pause
  the track — do not loop indefinitely.
- **UAT-in-env auth:** the manager authenticates with `SCION_HUB_TOKEN`
  (1-year UAT). Workers resolve `GITHUB_TOKEN` from the Hub
  (user + grove scope).
- **dev-auth Hub note (Gotcha 8):** this engagement runs the local Hub
  in `--dev-auth` mode. If `scion create/start/message` from inside the
  manager fails with a JWS-parse 401, fall back to the curl-shim spawn
  path (POST `/api/v1/agents` with the manager UAT as Bearer) and poll
  `origin/swarm/<track-id>` manually for completion markers.

## Known deviations (name them in the closure report)

- **Single-vantage audits.** Wave 1 audits with `spec-adherence-agent`
  only. The `code-review-codex` (OpenAI gpt-5.5) cross-model vantage is
  NOT wired — codex credentials were not provisioned in Phase 0.4. The
  two-vantage merge rule is intentionally relaxed for this wave; the
  closure report must state this.

## Status reporting expectation

Update `orchestration/status.md` after every meaningful event (spawn,
completion, audit verdict, merge, escalation). Append to "Recent
activity" newest-first. The Captain reads this as the read-only window
into the wave.

## Acknowledge before starting

Reply by pushing a `[manager-ready] <ISO-timestamp> wave-1` commit to
`origin/main`, then begin the DAG with `w1-api-items`.
