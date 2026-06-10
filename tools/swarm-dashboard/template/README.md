# Handoff: Phase-2 Swarm Dashboard

## Overview

A single-page operator dashboard for **Phase-2 Swarm** — a multi-agent code-generation system that organizes work into 10 sequential waves, each containing one or more tracks. Each track is executed by a containerized LLM "worker" agent, audited by a separate audit agent, then merged to trunk by a manager agent. The dashboard is a **read-only operator view**: a static page refreshed by a script (`pnpm render`) — no auth, no backend, no live updates.

**Audience:** technical operator (primary) + occasional PM/stakeholder (secondary). Optimized for data density and at-a-glance scanning. Dev-tool aesthetic — monospace for SHAs/track IDs, sans-serif for prose, status colors that read instantly.

## About the Design Files

`Phase-2 Swarm Dashboard.html` is a **design reference** — a working HTML prototype that demonstrates the intended visual style, layout, and behavior. It is not production code to ship as-is. The task is to **recreate this design in the target codebase's existing environment**, using its established patterns:

- If the codebase is a React/Vue/Svelte app, build it with the existing component library and routing.
- If the codebase is a Node script that emits static HTML (likely, given `pnpm render`), build a single-file renderer (e.g., template + data) and ship that.
- If no environment exists yet, choose the simplest tool that produces a single self-contained `.html` from a JSON snapshot. The reference does this in vanilla HTML/CSS/JS — that's a reasonable target shape.

The HTML inlines its sample data inside a `<script id="swarm-data" type="application/json">` block. In production, the render script should serialize the real snapshot into that same block.

## Fidelity

**High-fidelity.** All colors, type sizes, spacing, radii, shadows, animations, and interactions in the reference are intentional and final. Match them.

## Page structure (top → bottom)

1. **Phase ribbon** — 3px sticky bar; 10 segments colored by status.
2. **Header** — title, mono kicker (`swarm-execution-v2 · trunk`), generated timestamp, refresh hint, manager-status pill with pulsing dot, light/dark toggle.
3. **KPI strip** — 5 stat cards.
4. **Wave overview** — 10 wave cards in a 5-column grid; each carries duration + agent count inline alongside trk/audit/find/fix.
5. **Project burndown chart** — full-width line chart; actual cumulative deliveries, projected trajectory from current velocity, plan-target reference, dashed ETA marker.
6. **Wave timeline (Gantt)** — proportional bars per wave on a real time axis; hover any bar to reveal a popover listing the tracks in that wave.
7. **Per-wave cumulative chart** — stepped lines, one per wave, showing each wave's internal burndown.
8. **Two-column section** — sortable Track table (rows are clickable; open a right-side detail drawer) on the left; Recent activity feed on the right.
9. **Container snapshot** — pre-formatted CLI table.
10. **Track-detail drawer** — slide-in panel showing summary, acceptance criteria, findings & resolutions, audit history.

## Screens / Views

This dashboard is a single page with one overlay (the track-detail drawer). Detailed component spec follows.

### 1. Phase ribbon

- `position: sticky; top: 0; z-index: 10;` across full viewport width. Height 3px.
- CSS Grid, `grid-template-columns: repeat(10, 1fr)`.
- Fills by status: closed → `#0a7f29`; in-flight → diagonal-stripe gradient of `#0066cc` w/ 60% alpha alternation; pending → `#dbdee5`.
- Native `title="Wave N — status"` on each segment.

### 2. Header

- Flex row, `justify-content: space-between`, `align-items: flex-start`, 24px gap, 28px bottom margin.
- **Kicker:** mono 11px uppercase, letter-spacing 0.12em, `#8a8d96`. Includes `trunk` chip: `background: #eef0f4; padding: 1px 6px; border-radius: 3px`.
- **Title:** 28px / 600 / `-0.02em`, `#15151c` (light) / `#e8eaef` (dark).
- **Subtitle:** 13px, `#666`. Includes generated timestamp + inline `<code>` chip showing `pnpm render`.
- **Manager pill:** pulsing 7px green dot + `manager · running` in Geist Mono 12px. Dot has `box-shadow` pulse keyframe over 2s.
- **Theme toggle:** 28px pill, `Dark` / `Light` label, `◐` / `◑` glyph. Persists to `localStorage["phase2-theme"]`.

### 3. KPI strip

- `display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px;`
- **Card:** white surface, 1px `#e5e7eb` border, 8px radius, `padding: 14px 16px`, shadow `0 1px 2px rgba(15,18,30,0.04), 0 1px 1px rgba(15,18,30,0.03)`.
- **Anatomy:** mono label with 5px category dot · 32px mono value (tabular-nums) · 11.5px meta with `<b>` highlight · optional 3px micro-bar.
- **Cards (in order):**
  1. `Waves closed` — kind `success`. Value `4 / 10`. Meta `<b>6</b> remaining`. Bar `40%`.
  2. `Criteria delivered` — kind `primary`. Value `181 / 361`. Meta `<b>50%</b> of plan`. Bar `50%`.
  3. `Audit cycles` — kind `purple`. Value `12`. No bar.
  4. `Findings ever` — kind `warning`. Value `17`. No bar.
  5. `Fix cycles` — kind `danger`. Value `2`. No bar.

### 4. Wave overview

- `display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px;`, 10 cards.
- **Card base:** white surface, 1px solid `#e5e7eb`, 8px radius, `padding: 14px 16px 16px`.
- **Status variants:**
  - `closed`: `border-top: 2px solid #0a7f29; padding-top: 13px;`
  - `in-flight`: `border-top: 2px solid #0066cc; padding-top: 13px;`
  - `pending`: `background: transparent; border-style: dashed;`; numbers in `#8a8d96`.
- **Anatomy:**
  - Row 1: `WAVE <b>NN</b>` (mono 10.5px, letter-spacing 0.1em) + status pill.
  - Big sub: `${delivered}` mono 22px / 500, with ` / ${total}` denom in 16px / 400 / `#8a8d96`.
  - **Stats line (single flex-wrap row, mono 11px, 10px gap):** `N trk · N agt · N audit · N find · N fix · 4h 02m`. Value `<b>` foreground, label `<span class="k">` in `#8a8d96`.
    - The duration token is the wave's wall-clock elapsed (start → end, or start → now for the in-flight wave).
    - On the in-flight wave the duration value is followed by a tiny blinking primary-blue dot (`width: 5px; height: 5px; animation: blink 1.2s steps(2, start) infinite`).
    - Pending waves hide the `agt` and duration stats with `visibility: hidden` to preserve grid alignment.
  - Progress bar: 3px, `#eef0f4` track. Closed: solid green fill. In-flight: diagonal-stripe blue fill. `transition: width .6s ease` for initial paint.
- **Status pill (small):** 11px / 500, `padding: 2px 8px`, fully rounded, 5px colored glyph dot. Same palette as track-status pills (see §8).

### 5. Project burndown chart

- White card, 1px border, 8px radius, padding `14px 18px 16px`.
- **Head:** title `Project burndown — criteria delivered` (14px / 600). Sub-line: `<b>N</b> / 361 delivered (P%) · velocity X.X criteria/hr · eta YYYY-MM-DD HH:mmZ (~Nh)`. Right side has 3-item legend.
- **Chart:** Chart.js v4, type `line`, fixed wrap height 240px.
- **Three datasets:**
  - **Actual** — `stepped: true`, fill `'origin'` w/ `rgba(0,102,204,0.10)`, borderColor `#0066cc`, borderWidth 2. Data: cumulative-merged at each track-merge timestamp; extended to `generatedAt` at the current cumulative.
  - **Projected** — straight line from `(generatedAt, currentCum)` to `(ETA, criteriaTotal)`. borderColor `#9aa0ac`, borderWidth 1.5, `borderDash: [6, 4]`. Single visible point at the ETA endpoint.
  - **Plan target** — straight reference line `(startTs, 0)` → `(ETA, criteriaTotal)`. borderColor `#0a7f29`, borderWidth 1.5, `borderDash: [3, 5]`. No points.
- **Annotation plugin (`chartjs-plugin-annotation@3.0.1`):**
  - Dashed vertical line at the ETA timestamp, with a top-left label `ETA MM-DD HH:mm` in Geist Mono 10px.
  - Dashed horizontal line at `y = criteriaTotal` in `#0a7f29`.
- **Velocity calc:** `cumulativeDelivered / (generatedAt - startTs)`. `ETA = generatedAt + remaining / velocity`. (This is overall-average velocity; document a tighter recency window as a future tweak.)
- **Axes:** X is `type: 'time'`, unit `hour`. Y range `[0, ceil(total * 1.05)]`, stepSize 50. Grid `rgba(15,18,30,0.06)` light / `rgba(255,255,255,0.06)` dark. Mono 10px ticks.
- **Tooltip:** dark `rgba(15,18,30,0.92)`; title is `YYYY-MM-DD HH:mmZ`; body is `<label> · <y> / <total>`.

### 6. Wave timeline (Gantt)

- White card, same chrome as charts. Padding `14px 18px 16px`.
- **Head:** title `Wave timeline` (14px / 600). Right meta (mono 11px): `N closed · avg Xh XXm · WN running Yh ZZm`.
- **Body grid:** `display: grid; grid-template-columns: 60px 1fr; column-gap: 12px; row-gap: 4px;` — 10 rows, one per wave.
- **Row label (`.lbl`):** right-aligned mono 11px, `<b>W{n}</b>` with `letter-spacing: 0.04em`.
- **Row track (`.gantt-row`):** 22px tall, with subtle hour-tick striping via two layered backgrounds:
  ```css
  background:
    linear-gradient(to right, transparent 0, transparent calc(100% - 1px), var(--border) calc(100% - 1px), var(--border) 100%),
    repeating-linear-gradient(to right, var(--surface-2) 0, var(--surface-2) 1px, transparent 1px, transparent 10%);
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  ```
- **Bar (`.gantt-bar`):** absolutely positioned within row using percent left/width from `(start, end)` mapped against `(minMs, maxMs)` where `minMs = first start − 30m` and `maxMs = last end (or now) + 30m`. `top: 3px; bottom: 3px; border-radius: 2px`. Content: `W{n}` + small `.dur` opacity-0.8 label. Background per wave: W1 `#0a7f29`, W2 `#0066cc`, W3 `#7700cc`, W4 `#ffaa00`, W5 (in-flight) diagonal-stripe of `#cc0033`. In-flight bar gets a 2px primary-blue glow on its right edge with `animation: blink 1.2s steps(2, start) infinite`.
- **Axis (`.gantt-axis`):** 18px tall, margin-left 72px (= label col + gap). Hourly ticks at even hours showing `HH:00` (mono 10px `#8a8d96`); 1px tall tick marks above each label. Day boundaries get a vertical dashed separator with `May D` label in foreground.
- **Pending waves** (no `start`): show empty row at `opacity: 0.4`, no bar.

#### Bar hover popover (`.gantt-pop`)

A single shared element pinned to `position: fixed; z-index: 80`. Min-width 260px, max-width 340px. White surface, 1px border, 6px radius, `box-shadow: 0 6px 24px rgba(0,0,0,0.18)`. Padding `10px 12px 8px`. Mono font, 11.5px.

- Hidden by default (`opacity: 0; transform: translateY(2px); pointer-events: none`). `.open` toggles `opacity: 1; transform: translateY(0); pointer-events: auto`. Transition 120ms.
- **Head:** `WAVE NN · <status>` (500, letter-spacing 0.04em) + sub-line `HH:mm → HH:mm · dur · N agt` in 10.5px `#8a8d96`. Bottom hairline.
- **Track list (`<ul>`):** one row per track in the wave. Grid `10px 1fr auto`, 8px gap, 3px padding. Hover bg `#fafafc`, cursor pointer.
  - 7px dot, colored by status: merged → green, audited → purple, in-flight → primary (blinking), complete → warning.
  - Track id with `w{n}-` prefix stripped (`slot-inventory` rather than `w1-slot-inventory`).
  - Meta: `12c` (criteria count) plus optional `<span class="f">2f</span>` in danger color if findings > 0.
- **Foot:** dashed-top hint `click a track for full detail →` in mono 10px `#8a8d96`.
- **Positioning:** on bar `mouseenter`, populate then measure popover, center it horizontally over the bar, place 10px above. If `top < 12` flip below the bar. Clamp left to `[12, viewport - width - 12]`.
- **Hide:** `mouseleave` on bar starts a 180ms timer; `mouseenter` on the popover cancels it. Click any row → open the track-detail drawer for that track id.

### 7. Per-wave cumulative chart

- White card. Head title `Cumulative criteria merged over time` (14px / 600) + custom legend right-aligned (10×2px swatch + `Wave N`, mono 11px `#666`).
- Chart.js v4 line chart, `stepped: true, tension: 0, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5`. Wrap height 280px.
- One dataset per wave; points come from `DATA.burndown.waves[].points = [[ISO, cumulative], ...]`.
- Axes/tooltip styled identically to the project burndown.
- Wave colors same as Gantt (W1 green, W2 blue, W3 purple, W4 amber, W5 red).

### 8. Track table (left of two-column)

- White panel, 1px border, 8px radius, `overflow: hidden`.
- Head: 12px/16px padding, bottom hairline, title `Tracks` (13px / 600), right-aligned `{N} rows` in mono 11px `#8a8d96`.
- Headers: sticky top, `#fafafc` bg, mono 11px uppercase, letter-spacing 0.06em, `#8a8d96`. `cursor: pointer; user-select: none;` with `↑`/`↓` arrow; active sort header has primary-blue arrow.
- Cells: 9px/12px padding, 1px bottom border, 13px sans, nowrap. Mono columns: track id, REQ, criteria count, audits, findings, merged timestamp. Findings > 0 amber `#ffaa00`. Null merged → `— not merged` italic `#8a8d96`.
- **Wave cell:** 22×22px chip, `background: #eef0f4`, mono 11px, `W{n}`.
- **Row hover:** `background: #fafafc`. Each row has `cursor: pointer; tabindex="0"`. The track-id cell has class `id-cell` with `padding-right: 22px` and a `›` chevron at right that fades in on hover.
- **Sort:** click a header to set key; clicking again flips direction. `merged: null` sorts last in asc (treat as `9999`).
- **Click / Enter / Space on a row** opens the track-detail drawer (§10) for that track id.

### 9. Activity feed (right of two-column)

- Same panel chrome.
- Body: `max-height: 480px; overflow-y: auto;` with custom 8px scrollbar in `#d4d7df`.
- Day separator row inserted before the first item of each new day: single-column `background: #fafafc; padding: 6px 16px;`, mono 11px `#666` showing `YYYY-MM-DD`.
- Item row: `display: grid; grid-template-columns: 64px 92px 1fr; gap: 10px; padding: 8px 16px; border-bottom: 1px solid #e5e7eb;`. Reverse-chronological.
- Timestamp column: mono 11.5px `#8a8d96`, `HH:mmZ`.
- Kind badge column (centered): 10.5px mono, `padding: 1px 6px`, 3px radius. Kinds: `commit` (neutral), `audit_complete` (purple), `fix_dispatch` (danger), `track_complete` (warning), `wave_outcome` (success).
- Description column: 12.5px sans. Inline treatments: SHA (8 hex) in mono `#666`; `[bracketed-tag]` → small mono chip; `verdict: approved` → `.verdict-ok` (green / 500); `verdict: rejected` → `.verdict-rej` (red / 500).
- Content: 60 most-recent events.

### 10. Track-detail drawer

A right-edge slide-in panel that opens when a track row (in the table) or a track row (in the Gantt popover) is clicked.

- **Backdrop (`.drawer-backdrop`):** `position: fixed; inset: 0;` `background: rgba(0,0,0,0.35); backdrop-filter: blur(2px);`. Opacity-toggled with 180ms ease.
- **Drawer (`.drawer`):** `position: fixed; top: 0; right: 0; bottom: 0; width: min(680px, 92vw);`. White surface, left border 1px, `box-shadow: -8px 0 32px rgba(0,0,0,0.18)`. Transform `translateX(100%)` → `translateX(0)` over 220ms cubic-bezier `(.2,.7,.2,1)`. `z-index: 101`.
- **Close:** Esc key, click backdrop, or 28×28px × button at top-right of drawer head.

**Drawer head (`.drawer-head`)** — fixed, 18px/22px padding, bottom hairline:
- Crumbs (mono 10.5px `#8a8d96`, 0.05em letter-spacing): `swarm-execution-v2 › Wave N · <status> › <track-id-bold>`.
- Title (mono 18px / 500): the track id.
- REQ (mono 12px `#666`): the REQ-… id.
- Row (`.row`): status pill + 4 inline stats (mono 12px) — `<passing>/<total> criteria · <N> findings (M open | all resolved) · <N> audits · merged <ts>` (last only if merged).

**Drawer body (`.drawer-body`)** — scrollable, 18px/22px padding, four sections, each with a tiny uppercase mono header (11px / 600 / 0.08em / `#8a8d96`) followed by an inline count:

1. **Summary** — short prose paragraph (`.summary`, 13.5px / 1.55, `max-width: 62ch`, `#666`).
2. **Acceptance criteria** — `<ul class="crit-list">` with `grid-template-columns: 70px 22px 1fr auto`. Each `<li>` has:
   - Mono 11px CRIT-NNN id (`#8a8d96`, 0.04em letter-spacing).
   - 12px circular `.glyph`: green for pass; red for fail; neutral for pending; green with warning ring (`box-shadow: 0 0 0 2px rgba(255,170,0,0.35)`) for "fixed".
   - 13px sans desc (line-height 1.45).
   - Tiny mono 10px tag chip (`PASS` / `FAIL` / `PEND` / `FIXED`) — colored per state, `background: #fafafc; padding: 2px 5px; border-radius: 3px`.
3. **Findings & resolutions** — one `.finding` card per finding, 1px border, 3px left accent (red if open, green if resolved), 4px radius, 10px/12px padding, 8px margin-bottom.
   - Top row: mono 11px `FND-…` id (`#666`) + verdict tag (`OPEN` red / `RESOLVED` green, mono 10px uppercase, 14% tint background).
   - `.what` paragraph (13.5px / 1.5).
   - `.fix` paragraph (12.5px / 1.5, `#666`, 14px left padding, 1px left border). Prefixed with mono 11px green `<b>FIX</b>`. If unresolved: italic `Resolution pending — no fix dispatched yet.` in faint color.
   - If track has no findings, show italic `No audit findings recorded for this track.`
4. **Audit history** — `<ul class="audit-log">` as a vertical dashed-left timeline (`border-left: 1px dashed`, 16px padding-left, 6px margin-left). Each `<li>` has a 9px circular bullet at left (`::before`) — color by kind: `.ok` green, `.rej` red, `.fix` warning. Content: mono 12px, with a faint `HH:mm:Z` timestamp prefix then the event description (description colored danger for `.rej`, warning for `.fix`).

**Detail data:** the prototype carries hand-written detail for 6 representative tracks (`w1-slot-inventory`, `w1-provider-schedule`, `w2-book-appointment`, `w4-reschedule-appointment`, `w5-materialize-care-plan`, `w5-spec-adherence-batch-1`) and a generated fallback for the rest. See `TRACK_DETAILS` in the prototype for the canonical shape:

```ts
type TrackDetails = {
  summary: string;
  criteria: Array<[id: string, desc: string, status: 'pass'|'fail'|'pending'|'fixed']>;
  findings: Array<{
    fid: string;
    what: string;
    fix: string | null;
    resolved: boolean;
    resolvedAt?: string; // ISO
  }>;
  audit: Array<[ts: string, kind: 'ok'|'rej'|'fix', what: string]>;
};
```

### 11. Container snapshot

- Same card chrome. Head: title `Container snapshot` + right meta `scion list · 11 containers` (mono 11px).
- `<pre>` body: mono 12px, line-height 1.55, `padding: 14px 16px 18px`, `white-space: pre`, `overflow-x: auto`. Color tokens applied via regex on the raw string:
  - Header line → `#8a8d96`
  - `running (...)` → green `#0a7f29`
  - `completed (...)` → amber `#ffaa00`
  - `stalled (...)` → red `#cc0033`
  - `merged (...)` → muted `#666`

## Interactions & Behavior

- **Theme toggle:** swaps `data-theme="dark"` on `<html>`, persists to `localStorage["phase2-theme"]`. Charts re-theme grid/tick/annotation colors via `chart.update('none')`. No layout reflow.
- **Sortable table:** click any header to sort; clicking the active header flips direction.
- **Row click → drawer:** clicking (or Enter/Space on focused) a track row opens the slide-in drawer with that track's detail.
- **Gantt hover → popover:** mouseenter on a Gantt bar opens the wave's track list. Hovering the popover cancels its 180ms hide timer. Clicking a row in the popover opens the drawer.
- **Drawer close:** Esc, backdrop click, or × button.
- **Animations:** chart load 500ms; progress-bar paint `width .6s ease`; manager-pill pulse 2s infinite; drawer slide 220ms cubic-bezier `(.2,.7,.2,1)`; backdrop fade 180ms; in-flight blinking dots `blink 1.2s steps(2, start) infinite`.
- **Responsive breakpoints:**
  - `≤ 1180px`: KPI strip → 3 columns; wave grid → 4 columns; two-col section collapses to single column (table above feed).
  - `≤ 760px`: KPI strip → 2 columns; wave grid → 2 columns; header stacks vertically; table cells reduce padding.

## State / Data model

The render script consumes a JSON snapshot (the prototype inlines a sample in `<script id="swarm-data">`):

```ts
type Snapshot = {
  generatedAt: string; // ISO-8601
  kpis: {
    wavesClosed: number; wavesTotal: number;
    criteriaDelivered: number; criteriaTotal: number;
    auditCycles: number; findings: number; fixCycles: number;
  };
  waves: Array<{
    n: number;
    status: 'closed' | 'in-flight' | 'pending';
    delivered: number; total: number;
    tracks: number; audits: number; findings: number; fixCycles: number;
    agents: number;
    start: string | null;  // ISO-8601 (when first dispatch landed)
    end: string | null;    // ISO-8601 (when the wave was closed)
  }>;
  tracks: Array<{
    wave: number;
    id: string;     // e.g. "w2-book-appointment"
    req: string;    // e.g. "REQ-CAP-BOOK-APPOINTMENT"
    criteria: number;
    status: 'merged' | 'complete' | 'audited' | 'in-flight' | 'pending';
    audits: number; findings: number;
    merged: string | null; // ISO-8601 of merge to trunk
  }>;
  burndown: {
    waves: Array<{
      n: number; color: string;
      points: Array<[string, number]>; // [ISO, cumulative]
    }>;
  };
  containers: string; // raw multi-line CLI output
};

// Separate, optional in v1:
type Activity = Array<[
  ts: string,
  kind: 'commit'|'audit_complete'|'fix_dispatch'|'track_complete'|'wave_outcome',
  sha: string | null,
  desc: string,
  verdict: 'ok'|'rej' | null
]>;

type TrackDetails = { /* see §10 above */ };
type TrackDetailsMap = Record<string, TrackDetails>;
```

In production, fold `activity` and `trackDetails` into the snapshot under their own keys; same row shapes.

## Design tokens

### Colors (light mode)

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#f7f7fb` | Page background |
| `--surface` | `#ffffff` | Cards, panels, drawer |
| `--surface-2` | `#fafafc` | Sticky table headers, hover rows, day separators |
| `--border` | `#e5e7eb` | Hairlines |
| `--border-strong` | `#d4d7df` | Scrollbar thumb |
| `--fg` | `#15151c` | Primary text |
| `--fg-muted` | `#666` | Secondary text |
| `--fg-faint` | `#8a8d96` | Tertiary text, mono labels |
| `--primary` | `#0066cc` | In-flight, primary actions |
| `--primary-100` | `#e6efff` | In-flight pill fill |
| `--success` | `#0a7f29` | Closed / merged / approved |
| `--success-100` | `#dff5e4` | Success pill fill |
| `--warning` | `#ffaa00` | Findings, complete (awaiting audit) |
| `--warning-100` | `#fff2d6` | Warning pill fill |
| `--danger` | `#cc0033` | Rejected, fix dispatch, stalled |
| `--danger-100` | `#ffe1e8` | Danger pill fill |
| `--purple` | `#7700cc` | Audited |
| `--purple-100` | `#f1e2ff` | Purple pill fill |
| `--neutral-100` | `#eef0f4` | Track progress bg, chips |
| `--neutral-200` | `#dbdee5` | Pending state, empty progress |
| `--neutral-300` | `#c4c8d0` | Pending criteria dot |

### Colors (dark mode overrides)

| Token | Hex |
|---|---|
| `--bg` | `#0e0f13` |
| `--surface` | `#16181d` |
| `--surface-2` | `#1b1d23` |
| `--border` | `#272a31` |
| `--fg` | `#e8eaef` |
| `--fg-muted` | `#9aa0ac` |
| `--fg-faint` | `#6c7280` |
| `--primary` | `#4d9bff` |
| `--success` | `#4ec76d` |
| `--warning` | `#ffbf3d` |
| `--danger` | `#ff5577` |
| `--purple` | `#b97aff` |

### Typography

- **Sans:** Geist (300/400/500/600/700) via Google Fonts.
- **Mono:** Geist Mono (300/400/500/600) via Google Fonts.
- Body 14px / 1.5. H1 28px / 600 / `-0.02em`. KPI value 32px Geist Mono 500. Wave delivered 22px Geist Mono 500. Drawer title 18px Geist Mono 500. Section eyebrows 10.5–11px uppercase, letter-spacing 0.08–0.12em.

### Spacing

- 4px scale: 4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 96.
- Card padding: 14px/16px. Panel head padding: 12px/16px. Drawer head 18px/22px. Section spacing: 32px between sections.

### Radii

- 8px (cards, panels, drawer corners aren't rounded — full-height edge)
- 6px (hover popover, drawer body inner cards)
- 4px (small panels, findings)
- 3px (chips, kind badges)
- 999px (pills)

### Shadows

- `--shadow-card`: `0 1px 2px rgba(15,18,30,0.04), 0 1px 1px rgba(15,18,30,0.03)`
- Drawer: `-8px 0 32px rgba(0,0,0,0.18)`
- Hover popover: `0 6px 24px rgba(0,0,0,0.18)`

### Background grid

- 32×32px faint grid behind everything: two linear-gradients at `rgba(15,18,30,0.025)` (light) / `rgba(255,255,255,0.03)` (dark). Decorative.

## External assets

- **Chart.js v4.4.1** — `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js`
- **chartjs-adapter-date-fns 3.0.0** — `https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0/dist/chartjs-adapter-date-fns.bundle.min.js`
- **chartjs-plugin-annotation 3.0.1** — `https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js`
- **Geist + Geist Mono** — Google Fonts.

No images, no icons, no custom assets. The dashboard is text + CSS + Chart.js only.

## Files

- `Phase-2 Swarm Dashboard.html` — the design reference. Open in any modern browser. Inspect with devtools to confirm any styling detail not covered here.

## Notes for implementation

- The reference uses CSS custom properties (`--success`, `--primary`, …); your codebase likely has its own token names — map by **semantic role**, not by name.
- The `manager · running` pulse, in-flight blinking dots, and diagonal-stripe in-flight progress fills are deliberate touches that signal liveness without animating constantly. Keep them.
- Don't introduce icons. Status is conveyed by color + position + monospaced labels.
- Velocity / ETA: the reference uses average velocity since `startTs`, which is the conservative choice (in-flight zero-delivery window drags ETA later). If product wants a more optimistic projection, swap to a rolling window — e.g. last 6h of merge events — and document the choice.
- Render is server-side (`pnpm render`) into a fully self-contained HTML. Hydration is unnecessary; client-side behaviors are: theme toggle, table sort, Gantt hover popover, drawer open/close, and chart render. Vanilla JS or a tiny framework footprint is appropriate.
- The track-detail drawer is the main read-after-scan affordance. Make sure it's keyboard-accessible (Esc to close; row Enter/Space to open). Focus trap inside the drawer is nice-to-have but not required for v1.
