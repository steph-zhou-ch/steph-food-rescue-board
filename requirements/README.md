---
Status: catalog
Schema version: 2
Format: REQ Spec v4
---

# Requirements catalog

This directory holds the REQ catalog — the source of truth for what
every wave's tracks must implement and what the spec-adherence +
code-review audits verify against. Authored in **REQ Spec v4** format.

For the authoring template, see [`_template.md`](./_template.md).
For the domain file template, see [`domains/_template.md`](./domains/_template.md).

## What's different in v4 (from v3)

REQ Spec v3 was optimized for machine traceability but produced
large, repetitive files where cross-capability context was duplicated
in every participating REQ. Diffs were hard to read because a design
change (e.g., "assignee resolution moves from write-time to
read-time") touched 3–4 REQ files with ~200 lines of redundant
prose.

**v4 solves this by separating WHAT from HOW-THEY-INTERACT:**

- **REQ files** (thin) answer: "what does THIS code path accept,
  reject, and produce?" — boundary, input schema, acceptance criteria.
- **Domain files** (shared) answer: "how do these capabilities
  interact?" — data model, protocols, cache rules, state machines.

This cuts total lines by ~60% while preserving full machine-
readability (req-lint, req-coverage, spec-adherence-agent all work
unchanged on the criteria YAML blocks).

## Directory structure

```
requirements/
  domains/
    _template.md              # template for new domain files
    <context>.md              # one per bounded context (e.g., ticketing.md)
  _template.md                # template for new REQ files
  README.md                   # this file
  REQ-CAP-*.md                # capability REQs (thin)
  REQ-INT-*.md                # integration REQs (thin)
  REQ-INV-*.md                # invariant REQs (thin)
```

## Categories

| Prefix | Category | What it answers |
|---|---|---|
| `REQ-CAP-*` | Capability | What can an actor or system DO at this boundary? |
| `REQ-INT-*` | Integration | What contract do we hold with an external system? |
| `REQ-INV-*` | Invariant | What cross-cutting rule must EVERY capability respect? |

## How REQs and domain files relate

```
┌─────────────────────────────────────────────────────┐
│  domains/<context>.md                                │
│                                                     │
│  • Data model (shared tables/types)                 │
│  • Protocols (cross-CAP interaction contracts)      │
│  • Cache/state rules                                │
│  • Component reuse rules                            │
│  • Auth contract                                    │
│  • Figma surface index                              │
└────────────┬───────────────────────────┬────────────┘
             │ protocols:                │ protocols:
             │ - assignee-resolution     │ - status-lifecycle
             ▼                           ▼
┌────────────────────────┐  ┌────────────────────────┐
│  REQ-CAP-FILE-TICKET   │  │  REQ-CAP-TRANSITION    │
│                        │  │                        │
│  boundary: mutation    │  │  boundary: mutation    │
│  fileTicket            │  │  transitionTicket      │
│                        │  │                        │
│  criteria:             │  │  criteria:             │
│  - accepts-valid-input │  │  - legal-transition    │
│  - idempotent-replay   │  │  - file-then-transition│
│  - malformed-assignee  │  │  - status-filter       │
└────────────────────────┘  └────────────────────────┘
```

**Key rules:**

1. A REQ file only describes behavior owned by the code path in its
   `boundary:` field. If it needs to reference behavior in another
   boundary, it links to a domain protocol with a one-line
   cross-reference.

2. A domain file holds the "world model" — shared state, interaction
   protocols, design decisions. It names its participants (REQ ids)
   so the graph is navigable in both directions.

3. `protocols:` in REQ frontmatter creates a machine-checkable link
   from a REQ to the domain sections it participates in.

4. Acceptance criteria are YAML-only (no prose/YAML duplication).
   The `predicate` IS the spec; `negative_cases` cover failure modes.
   If an engineer needs context on WHY, the domain file has it.

## Authoring a new REQ

1. **Pick a category prefix** (`CAP`, `INT`, `INV`) and a kebab-case
   slug.
2. **Identify the domain.** Does a `domains/<context>.md` exist? If
   not, create one from `domains/_template.md`.
3. **Copy** [`_template.md`](./_template.md) to your REQ id.
4. **Fill in** the frontmatter (especially `boundary:` and
   `protocols:`), the summary sentence, and the acceptance criteria.
5. **Update the domain file** if your REQ introduces a new protocol
   or modifies an existing one.
6. **Validate:**
   ```bash
   pnpm req-lint
   pnpm req-coverage --soft
   ```

## Authoring a new domain file

1. **One file per bounded context** (e.g., `ticketing.md`,
   `provider-calendar.md`, `billing.md`).
2. Copy `domains/_template.md` and fill in:
   - Frontmatter: `domain`, `bounded_context`, `participants`
   - Sections: data model, protocols, component/cache rules
3. Each protocol section names its participants and describes the
   interaction contract in ≤20 lines.
4. Keep design decision rationale here (not in individual REQs).

## REQ file structure (v4)

Every REQ has:

- **Frontmatter** — `id`, `schema_version: 4`, `name`, `category`,
  `severity`, `status`, `boundary` (the code path this REQ owns),
  `owners`, `tags`, `invariants_respected`, `domain` (points to
  domain file), `protocols` (list of domain protocol sections this
  REQ participates in), optional `designs`, `consumes`,
  `events_emitted`.
- **Summary** — 2-3 sentences max. What this code path does. Link to
  domain protocol for cross-CAP context.
- **Input** (optional) — the GraphQL operation or API shape, as a
  fenced code block.
- **Acceptance Criteria** — one `### <criterion-id>` section per
  criterion, each containing a single fenced `yaml` block with `id`,
  `severity`, `verification` (level + required_tags), `predicate`,
  `negative_cases`, optional `linked_invariants`.

That's it. No Product Contract section, no Technical Contract
section, no Traceability section. The domain file carries shared
context; the criteria carry the gate.

## Validation tooling

| Tool | Purpose |
|------|---------|
| `req-lint` | Frontmatter shape, criterion-id integrity, invariants_respected resolution, embedded YAML parseability |
| `req-coverage` | Every critical/high criterion has a `@req <REQ-ID> @criterion <id>`-tagged test |
| `req-protocols` (proposed) | Validates `protocols:` entries resolve to headings in the domain file |

## Comparison: v3 vs v4

| Aspect | v3 | v4 |
|--------|----|----|
| Cross-CAP protocols | Inlined in every participating CAP | `domains/<context>.md` |
| Average CAP file | 250–400 lines | 70–150 lines |
| Prose duplication | Product + Technical + criterion prose + YAML | Criteria YAML-only; narrative in domain file |
| `boundary:` field | Absent | Required |
| `protocols:` field | Absent | Required |
| `domain:` field | Absent | Required |
| Product Contract | Full PM prose (7 subsections) | 2-3 sentence summary |
| Technical Contract | 8 subsections | Moved to domain file or expressed in criteria |
| Traceability section | Manual | Dropped (tooling populates automatically) |

## Cross-references

- [`docs/USER-GUIDE.md`](../docs/USER-GUIDE.md) — methodology.
- [`docs/SWARM-QUALITY-FRAMEWORK.md`](../docs/SWARM-QUALITY-FRAMEWORK.md) — quality categories.
- [`docs/typescript-swarm-playbook.md`](../docs/typescript-swarm-playbook.md) — test tag conventions.
