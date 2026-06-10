# Designs as first-class spec artifacts in SDD

> Originally drafted as an internal proposal (Author: Lawrence Chan,
> 2026-05-21). Now baked into project-template as a shipped layer —
> `tools/design-sync/`, the `clients/designs/` convention, the
> `G.design-sync` gate, and the optional `designs:` REQ field. This
> document is preserved as the rationale; for the operating manual see
> [`designer-onboarding.md`](designer-onboarding.md).

## TL;DR

Extend the existing spec-driven loop (PRD → REQ predicate → `@req` test → coverage gate) to cover frontend appearance. Add a fourth artifact — `design.yaml` per client surface, synced from Figma via Dev Mode MCP — and a parallel `@design` coverage rule. Same anti-drift property we already enforce for backend behavior, applied to where drift actually bites: designer ships v2, frontend implements v1, nobody notices.

## Problem

Backend specs are checkable: REQ predicates → `@req`-tagged tests → CI fails on uncovered criteria. Frontend has no equivalent. Today designs live in Figma URLs pasted into PRDs; the link rots, the file mutates, and a worker building from the spec six weeks later has no idea whether they're implementing v1 or v7.

## Proposal

Three additions, all small, all mirrored on patterns we already use.

### 1. `clients/designs/<surface>/design.yaml`

Per-surface manifest pinning a Figma file + node ids. Synced via Figma Dev Mode MCP (`pnpm --filter @charliehealth/design-sync sync <surface>`): per node writes `snapshots/<name>.png` (visual evidence) and `snapshots/<name>.structure.xml` (full nested frame tree — diffs cleanly when designs are restructured); per surface writes `tokens.json` (design variables); stamps `last_synced`.

### 2. Bidirectional REQ ↔ design link

REQ frontmatter gains `designs: [{surface, node}]`. `tools/req-coverage/build-catalog.ts` validates both directions. Drift becomes structurally impossible — one side breaks the build.

### 3. `@design` coverage + `G.design-sync` gate

Stories/specs tag visual coverage:
```ts
/** @design <surface-slug>/<node-name> */
export const TicketDetailLoaded: Story = { ... };
```
Coverage check fails if a REQ with `designs:` has no `@design` artifact. `pnpm --filter @charliehealth/design-sync check` wires into `gate-check.sh` as `G.design-sync` — frontend tracks block on it.

## What it costs

- ~1 day to add `designs:` validation to `req-coverage` and the `@design` rule.
- ~30 min per client PRD to author `design.yaml` (humans pick which frames matter).
- One Figma desktop toggle per developer (Dev Mode MCP server).
- Token cost: zero remote dependencies — MCP runs locally, fits the swarm's local-only-mode rule.

## What it gives us

A frontend track can't merge without (a) `@req` tests covering behavior, (b) `@design` stories covering appearance, (c) snapshots and cross-refs resolving. The same gate-check discipline already protecting the backend, extended to the surface where most "spec drift" happens.

## The triangle

```
        PRD (why)
       /        \
   REQ            design.yaml
   predicate     + snapshot + tokens
      |               |
   @req tests     @design stories
      \              /
   coverage + design-sync gates
              |
       track gate opens
```

## Smallest first step

Adopt incrementally: ship the first surface with `designs:` cross-links as WARN-level for two weeks (the `check.ts` tool emits warnings, not errors, for unresolved `maps_to_req: TBD` and missing `last_synced`), then promote to blocking once the pattern is proven on a real frontend track.
