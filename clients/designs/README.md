# Client designs

The fourth spec artifact, alongside `PRD → REQ → @req test`. Source-of-truth
wiring between Figma frames and the REQ catalog so that frontend tracks
have the same anti-drift property the backend already enforces: a track
can't merge without (a) `@req` tests covering behavior, (b) `@design`
stories covering appearance, (c) snapshots and cross-refs resolving.

This directory is **empty by default**. Backend-only adoptions of
project-template can ignore it; the `G.design-sync` gate is a no-op when
no surfaces exist.

Each subdirectory hosts one logical surface (one PRD, often many frames):

```
clients/designs/
└── <surface-slug>/
    ├── design.yaml                     ← pinned Figma file + per-node manifest
    ├── tokens.json                     ← Figma MCP get_variable_defs (file-level)
    └── snapshots/
        ├── <node-name>.png             ← frozen visual export
        └── <node-name>.structure.xml   ← frame tree (ids, names, bounds)
```

Per node we capture **three** artifacts: the PNG (visual evidence), the
structure XML (the full nested frame tree from `get_metadata` — diff-friendly
when designs are restructured), and the file-level `tokens.json` (shared
across all nodes).

## Adding a new surface

1. **Pick the Figma frames** that map to PRD sections. In Figma desktop:
   right-click the frame → "Copy link to selection". The URL contains a
   `node-id=<id>` query param (e.g. `0-6034`, used as `0:6034` below).
2. **Create the directory** `clients/designs/<surface-slug>/snapshots/`.
3. **Author `design.yaml`** by hand. Minimum frontmatter:
   ```yaml
   prd: docs/prds/<surface>.md           # optional; omit if no PRD yet
   figma:
     file_url: https://www.figma.com/design/<key>/<name>
     file_key: <key>
     file_name: <name>
     file_version: TBD
     last_synced: TBD
     last_synced_by: TBD
     synced_via: figma-mcp
   nodes:
     - id: "0:6034"
       name: <human-slug>
       snapshot: snapshots/<human-slug>.png
       maps_to_req: REQ-CAP-...        # or TBD
   ```
4. **Sync via Figma Dev Mode MCP** (Figma desktop → Preferences → Enable
   local MCP Server), then run:
   ```
   pnpm --filter @charliehealth/design-sync sync <surface-slug>
   ```
   This pulls per-node `get_screenshot` → `<name>.png`, `get_metadata` →
   `<name>.structure.xml`, and file-level `get_variable_defs` →
   `tokens.json`. It also stamps `last_synced` + `last_synced_by` in
   `design.yaml`. Run it whenever the Figma file changes.
5. **Cross-link `maps_to_req`** to the relevant `REQ-*` file under
   `requirements/` once the design has been walked through with the PRD
   owner. Optionally, mirror the link from the REQ side by adding a
   `designs:` entry to the REQ frontmatter (see `requirements/_template.md`).

## Why this shape

- `figma.file_version` + `last_synced` are the freshness anchor. A worker
  reading `design.yaml` six weeks from now can tell whether the spec is
  current or stale.
- `snapshots/<name>.png` is the human review artifact — code review sees
  what the design looked like at sync time without opening Figma.
- `snapshots/<name>.structure.xml` is the machine review artifact — when a
  designer restructures a frame, `git diff` on the XML shows exactly which
  nodes moved, were renamed, or changed bounds. Far more reviewable than a
  binary PNG diff.
- `tokens.json` lets workers pull design tokens without an MCP call,
  which matters for tracks running in worktrees that don't have Figma
  access.
- The MCP itself is the **canonical extraction surface** for live work:
  call `get_design_context` on a node id when actually implementing a
  component, not the snapshot.

## Drift detection

`tools/design-sync/check.ts` verifies, for each `design.yaml`: PRD target
exists (when set), every snapshot file exists, every non-`TBD`
`maps_to_req` resolves to a real REQ file, and `last_synced` is set.
Wired into `orchestration/gates/gate-check.sh` as `G.design-sync` —
frontend tracks block on it.

For the rationale, see [`docs/design-in-sdd.md`](../../docs/design-in-sdd.md).

## Optional: `code_connect:` — local Figma → component map

Add this block to a surface's `design.yaml` when you want a
**local-to-the-repo** map from Figma instance node-ids to your
component library. Use this when the Figma file's published Code
Connect map points at a different repo (or when you don't want to
mutate the Figma file at all).

```yaml
code_connect:
  package: "@your-org/ui"
  root: ui-components/src/components/ui      # repo-relative dir each
                                              # `component:` resolves under
  mappings:
    "48:3800":                                # Figma instance node id
      component: top-bar                       # → root/top-bar/ must exist
      figma_name: Sidebar / Top Bar
    "48:1789":
      component: button
      props: { size: icon, variant: ghost }   # advisory; not enforced
    "48:1827":
      external: "@phosphor-icons/react#CalendarBlank"   # 3rd-party; skipped by check
    "30:1631":                                # planned but not built yet
      pending: REQ-CAP-FE-01-RENDER-PROVIDER-WEEK   # must resolve to a REQ file
      planned_component: appointment-tile
      figma_name: Appointment
```

Each mapping must set exactly one of `component:`, `external:`, or
`pending:`. Use a YAML anchor (`&name` / `*name`) when many instances
share the same definition (e.g. 28 Appointment tiles).

**What `G.design-sync` validates:**
- `code_connect.root` exists when mappings are present.
- Every `component:` resolves to a real directory under `root`.
- Every `pending:` resolves to a real REQ file under `requirements/`.
- `external:` entries are skipped (they target third-party packages).
- A warning is emitted for any `<instance>` in a `structure:` xml that
  has no mapping — points at unmapped Figma nodes a worker would
  otherwise re-implement.

**Wave discipline.** When the wave that owns a `pending:` REQ ships
the component, swap `pending: <REQ-id>` → `component: <slug>` in the
manifest. The check enforces both halves.

**Why local, not Figma-published?** Mutating the Figma file requires
seat-holder permission, may collide with another consumer's Code
Connect map, and is slower to iterate on. The local map is committed
alongside the snapshots and reviewable in PR. Cross-reference the
matching guidance in [`requirements/_template.md`](../../requirements/_template.md)
under §Technical Contract → "Components — reuse map".
