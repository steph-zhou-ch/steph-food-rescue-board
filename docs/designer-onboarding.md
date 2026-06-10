# Designer onboarding — Designs as first-class spec artifacts

**Audience:** Product designers joining a swarm engagement that has a
frontend track. **Read first:**
[`pm-techlead-tag-team.md`](pm-techlead-tag-team.md) (the tag-team
operating model you're joining as a third role) and
[`design-in-sdd.md`](design-in-sdd.md) (the rationale for this layer).

## What you own

A swarm engagement has three spec artifacts the worker fleet treats as
the source of truth. You own the third.

| Artifact | Owner | What it pins |
|---|---|---|
| **PRD** | PM | The "why" — user problem, business outcome, non-goals |
| **REQ** | PM (Product Contract) + Tech Lead (Technical Contract) | The "what" — testable predicates, acceptance criteria |
| **`design.yaml`** | **You** (with PM) | The "how it looks" — pinned Figma frames + tokens + snapshots |

Designs in this swarm are not a Figma URL pasted into a PRD. They are
**version-pinned manifests in `clients/designs/<surface>/design.yaml`**
that workers consume the same way they consume REQs and PRDs. Without
this artifact, frontend tracks have no anti-drift protection — the
designer ships v2, the worker implements v1, nobody notices until UAT.

## The four-step loop

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

You operate on the right arm of the triangle. The PM/Tech Lead pair
operates on the left. The two arms meet at the gate.

## Setup

1. **Install Figma desktop** and toggle on the local MCP server:
   Figma → Preferences → "Enable local MCP Server". Default endpoint is
   `http://127.0.0.1:3845/mcp`.
2. **Clone the engagement repo** and run `pnpm install` from root.
3. **Verify the design-sync tool is reachable:**
   ```
   pnpm --filter @charliehealth/design-sync check
   ```
   With no surfaces yet, it should print `design-sync check: no design
   surfaces found` and exit 0.

## Authoring a new surface

The unit of design ownership is a **surface** — usually one PRD, one
flow, several Figma frames. (`booking-funnel`, `ticket-detail`,
`onboarding-survey` are typical surface names.)

### 1. Pick the frames

In Figma desktop: right-click the frame → "Copy link to selection". The
URL has a `node-id=<id>` query param. The id `0-6034` in a URL becomes
`0:6034` in YAML.

Pick frames that map to **one PRD section or one REQ**. Not the whole
file, not every variant — just the frames a worker would need to
implement that capability. If a designer reorganizes the file, the
specific node ids you've pinned are what the manifest tracks.

### 2. Create the surface directory

```
clients/designs/<surface-slug>/
├── design.yaml
└── snapshots/   ← created on first sync
```

### 3. Author `design.yaml`

```yaml
prd: docs/prds/<surface>.md           # optional; omit if no PRD yet
figma:
  file_url: https://www.figma.com/design/<key>/<name>
  file_key: <key>
  file_name: <name>
  file_version: TBD                   # populated by sync once REST pin lands
  last_synced: TBD
  last_synced_by: TBD
  synced_via: figma-mcp
nodes:
  - id: "0:6034"
    name: ticket-detail-empty-state
    snapshot: snapshots/ticket-detail-empty-state.png
    maps_to_req: REQ-CAP-TICKET-VIEW    # or TBD until walked through with PM
  - id: "0:6042"
    name: ticket-detail-loaded
    snapshot: snapshots/ticket-detail-loaded.png
    maps_to_req: REQ-CAP-TICKET-VIEW
```

`maps_to_req: TBD` is acceptable in early authoring — the
`G.design-sync` gate emits a warning, not an error. Resolve to a real
REQ id before the frontend track that consumes the surface ships.

### 4. Sync

```
pnpm --filter @charliehealth/design-sync sync <surface-slug>
```

This calls Figma MCP per node and writes:

- `snapshots/<name>.png` — visual evidence (binary, but human-reviewable
  in PR diffs).
- `snapshots/<name>.structure.xml` — the full nested frame tree from
  `get_metadata`. **This is the diff-friendly artifact.** When you
  restructure a frame, `git diff` on the XML shows exactly which nodes
  moved, were renamed, or changed bounds — far more reviewable than a
  binary PNG.
- `tokens.json` — file-level design variables from `get_variable_defs`.
  Workers reference this for spacing, color, typography tokens without
  needing live Figma access.

It also stamps `last_synced` + `last_synced_by` in `design.yaml`.

### 5. Cross-link to the REQ

Once the design has been walked through with the PM, the corresponding
REQ frontmatter gains a `designs:` entry:

```yaml
designs:
  - surface: <surface-slug>
    node: "0:6034"
```

The `req-lint` tool validates this bidirectionally — the listed surface
must exist; the node id must appear in `design.yaml`. Drift becomes a
build failure on either side.

## When you change the design

1. Make the edit in Figma.
2. Re-run `pnpm --filter @charliehealth/design-sync sync <surface>`.
3. `git diff` shows what moved. If only the snapshot bytes changed, the
   visual changed but structure didn't (re-color, re-text, etc.). If
   the structure XML changed, the layout moved — flag it to the
   frontend track owner.
4. If a node was renamed or removed, update `design.yaml` accordingly
   and re-sync. Workers will fail their `@design` story if a node
   they're implementing is no longer in the manifest.

## How frontend tracks consume your work

When a worker implements a frontend criterion, they:

1. Read `clients/designs/<surface>/design.yaml` to find the pinned node
   id.
2. Open the snapshot and structure XML for human reference.
3. Call Figma MCP `get_design_context` on the node id for live
   extraction — generated styles, component structure, copy.
4. Tag their Storybook (or equivalent) story with
   `@design <surface>/<node-name>`. The `G.design-sync` gate verifies
   that every `designs:`-bearing REQ has at least one matching
   `@design` tag.

You don't write the worker's code. You define the contract they
implement against.

## What you don't own

- **Behavior contracts.** REQ predicates, acceptance criteria, error
  states, idempotency — those are the PM + Tech Lead's domain. Flag
  ambiguities, but the REQ catalog is theirs to amend.
- **Technical implementation.** Whether the frontend uses CSS modules
  vs. vanilla-extract, whether tokens are pulled at build time or
  runtime — Tech Lead decides.
- **Merge gates.** You can run `pnpm --filter @charliehealth/design-sync
  check` to see what state the manifests are in, but the manager runs
  `G.design-sync` as part of the merge gate; you don't merge directly.

## Common pitfalls

- **Pasting the Figma URL into a PRD instead of authoring `design.yaml`.**
  The URL goes stale; `design.yaml` is the only thing workers can rely
  on.
- **Letting `last_synced` go stale.** The check tool warns when
  `last_synced` is `TBD`. After any meaningful Figma edit, re-sync.
- **Picking too-large frames.** A node id pointing at the whole canvas
  isn't useful — workers need the specific frame for the criterion
  they're implementing. One node ≈ one component ≈ one Story.
- **Not committing snapshots.** PNG + XML files are part of the spec.
  Don't `.gitignore` them; PR review needs them.

## Where to look next

- [`../clients/designs/README.md`](../clients/designs/README.md) — the
  per-surface directory contract.
- [`design-in-sdd.md`](design-in-sdd.md) — the original proposal that
  motivated this artifact.
- [`pm-techlead-tag-team.md`](pm-techlead-tag-team.md) — how PM + Tech
  Lead operate; you slot in alongside them.
- [`USER-GUIDE.md` §Phase 1.4](USER-GUIDE.md) — the design-doc
  authoring phase you'll join during.
