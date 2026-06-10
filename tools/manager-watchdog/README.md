# manager-watchdog

Keeps the swarm **manager** alive without a human hand-driving nudges — the
codified, reusable version of the ad-hoc "watchdog v3 / `--interrupt` / per-wave
restart" babysitting the Captain improvised every session.

```bash
pnpm manager-watchdog                    # run the loop (10-min interval)
pnpm manager-watchdog --once             # one check + remediate, then exit
pnpm manager-watchdog --once --dry-run   # detect only; print what it WOULD do
pnpm manager-watchdog --restart          # codified safe restart now (per-wave reset)
pnpm manager-watchdog --interval 300 --stall-min 12 -v
```

## How it decides (the false-positive fix)
Pairs with `manager-kickoff.md` §5a: the manager emits a `swarm/manager-pulse`
commit **every poll cycle**, so a **stale pulse is an unambiguous stall** — no
guessing from terminal state. A stall requires *all* of:
- manager phase `running` (else it's down → restart),
- **not** in an active state (`thinking`/`executing`/`compacting`/`baking` ⇒ alive
  — this is what watchdog-v3 kept misreading as "stalled"),
- pulse stale ≥ `--stall-min` (or, with no pulse branch, trunk stale ≥ that).

It **stands down** entirely when `status.md` reads `ENGAGEMENT-COMPLETE` (an idle
manager after `task_completed` is correct, not a stall).

## Remediation ladder (skipped under `--dry-run`)
1. **Nudge** — `scion message --interrupt manager` (ack-required), wait, re-check.
2. Still stalled → **safe restart** — `scion stop && scion start manager -t default`
   (codifies the `-t default` gotcha — without it the manager comes back in
   `created` state) + dismiss trust dialog + "resume from `status.md`". Doubles as
   the per-wave context reset that prevents compaction.
3. **TUI / trust prompt** → `scion message --raw manager $'\r'` to dismiss.
4. **Rate-limit / auth** → **do NOT restart** (the credit/auth state must change
   first); surface to the human (exit 3). Pair with `pnpm auth-doctor --fix`.

Everything routes **through the manager**, never workers (chain-of-command).
Exit: `0` healthy/handled · `3` escalation needs a human · `2` bad invocation.
Maps to the retrospective P1 (manager-intrinsic liveness).
