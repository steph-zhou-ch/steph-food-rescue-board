# Swarm Dashboard

Live Captain monitoring dashboard for Scion swarm engagements. Reads git state (track-metas, audit branches, commits, `scion list`) and serves a self-hosted UI with:

- KPI strip + wave overview grid
- Project burndown chart with velocity-based ETA
- Wave timeline (Gantt) + per-wave cumulative chart
- Sortable track table with click-to-expand detail drawer
- Recent activity feed with emoji classification
- **Captain extensions**: decision queue, stall detector, audit findings explorer, worker pulse, REQ coverage matrix, recipe-lesson tracker

## Quick start

```bash
cd tools/swarm-dashboard
pnpm install
PORT=4318 pnpm serve
# opens at http://127.0.0.1:4318/captain
```

## Routes

| Route | Purpose |
|---|---|
| `/` and `/captain` | Full dashboard (designer template + Captain extensions) |
| `/legacy` | Original designer template only |
| `/skeleton` | Lightweight dark-mode skeleton (debug per-section endpoints) |
| `/api/captain/<section>` | JSON per section: `hero`, `queue`, `stalls`, `timeline`, `activity`, `audits`, `workers`, `coverage`, `lessons` |
| `/api/snapshot` | Full legacy JSON snapshot |
| `/api/invalidate` | Force re-read all sections on next fetch |
| `/healthz` | Liveness probe |

## What to customize per engagement

### Required: service name (5 spots in `captain.ts`)

Search for `<your-service>` and replace with your engagement name (e.g. `tickets-subgraph`). These are display labels in the page title and header:

```bash
grep -n '<your-service>' captain.ts
```

### Optional: wave plan estimates (`render.ts`)

The `loadWavePlan()` function returns per-wave criteria totals used as placeholders before track-metas are authored. Replace the zeros with your engagement's estimates from the Phase 2 catalog kickoff brief:

```ts
// In render.ts — loadWavePlan()
for (let w = 1; w <= 10; w++) totals.set(w, 0);
// Replace with e.g.:
// [1, 22], [2, 64], [3, 73], [4, 33], [5, 38], ...
```

Once track-metas exist for a wave, the dashboard uses their actual criteria counts instead.

### Optional: designer HTML template

The file at `template/Phase-2 Swarm Dashboard.html` is the design reference that `render.ts` injects live data into. It ships with sample data from the original engagement as illustration — all overwritten at render time.

If you receive an updated design handoff, drop the new HTML into `template/` with the same filename.

## Architecture

```
serve.ts    → HTTP server, routes requests to render/captain functions
render.ts   → Reads git state, builds JSON snapshot, injects into designer HTML
captain.ts  → Captain extensions layer (decision queue, stall detection, etc.)
template/   → Designer-authored HTML prototype (data gets overwritten)
```

**Data sources** (all read-only):
- `git show origin/main:orchestration/track-meta/*.yaml` — track definitions
- `git for-each-ref refs/remotes/origin/swarm/` — worker + audit branches
- `git log origin/main` — commit history (merge markers, close markers, etc.)
- `git show origin/main:requirements/REQ-*.md` — catalog for criteria counts
- `scion list` — live container status (graceful fallback if CLI unavailable)

**Performance**: cold load ~4–5s (first git-show of every track-meta + verdict file); warm load ~200ms. Legacy HTML cached 25s server-side; Captain sections lazy-load via `/api/captain/<section>` with per-section refresh intervals (hero 5s, workers 5s, queue 8s, audits 60s, lessons 120s).

## Keyboard shortcuts (in browser)

- `R` — force-refresh all Captain sections
- `/` — focus the activity search
- Auto-refresh: page reloads every 30s via meta tag
