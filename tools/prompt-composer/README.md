# `tools/prompt-composer/`

Stitches the worker-ready prompt the Scion manager pipes to each
worker container. Driven by per-track YAML files under
`orchestration/track-meta/` plus engagement-side rule packs and the
REQ catalog. See [`docs/USER-GUIDE.md` §Appendix A](../../docs/USER-GUIDE.md#appendix-a--tooling-matrix-agnostic-capability--per-platform-command)
("Prompt composition" + "Prompt composition validation") and the
Phase 4 prompt in [`docs/USER-GUIDE.md` §Phase 4](../../docs/USER-GUIDE.md#phase-4--plan-the-wave-claude-driven).

## What it composes

For each track-meta, the output at
`orchestration/prompts/composed/<track-id>.md` carries five sections:

1. **Engagement rule pack(s)** — `orchestration/prompts/base.md` for impl
   workers; `orchestration/prompts/code-review-rule-pack.md` for the
   `code-review-codex` auditor. Plus any
   `cross_cutting_packs:` declared in the track-meta.
2. **Agent-class authority** — the `allowed_paths`,
   `forbidden_patterns`, and one-line description from
   `orchestration/ledgers/agent-class-registry.yaml`.
3. **Mission** — `track_id`, `track_summary`, `predecessors`,
   `subscribed_contracts`, `deliverables`, `exit_criterion`, `unblocks`.
4. **REQs you implement** — each REQ in `source_of_truth.req_ids`
   inlined verbatim from `requirements/REQ-*.md`.
5. **Operational protocol** — branch convention
   (`swarm/<track-id>`), TDD commit pairs, the `[complete:<id>]`
   done marker, push policy, escalation procedure.

The output is what `scion message <track-id> "$(cat …)"` pipes to the
worker. The worker's Scion-template system-prompt (delivered at
container spawn) carries the generic harness rules; this composed
prompt carries the engagement-specific ones.

## CLI

```bash
# Validate one track-meta is composable (no output written)
pnpm compose-prompts --track-meta orchestration/track-meta/w1-domain-slots.yaml --validate-only

# Render the composed prompt (writes orchestration/prompts/composed/<track-id>.md)
pnpm compose-prompts --track-meta orchestration/track-meta/w1-domain-slots.yaml

# Convenience aliases (root package.json)
pnpm validate-prompt-composition --track-meta <path>   # alias for --validate-only
```

Useful for Phase 4 batch validation:

```bash
for tm in orchestration/track-meta/w1-*.yaml; do
  pnpm compose-prompts --track-meta "$tm" --validate-only || exit 1
done
```

## Validation rules

| Rule | Description |
|---|---|
| `track-meta-track-id-missing` | `track_id` required |
| `track-meta-agent-class-missing` | `agent_class` required |
| `track-meta-agent-class-unknown` | `agent_class` must resolve in the registry |
| `track-meta-summary-missing` | `track_summary` required |
| `track-meta-deliverables-empty` | At least one deliverable required |
| `track-meta-req-ids-empty` | At least one `source_of_truth.req_ids` entry required |
| `track-meta-req-unresolved` | Every REQ id must resolve to a file under `requirements/` |
| `track-meta-exit-criterion-missing` | `exit_criterion` required |
| `track-meta-execution-mode-missing` | `execution_mode` required |
| `track-meta-execution-mode-unknown` | (warning) only `hub_mode` supported today |

Exit 0 on a clean validate; exit 1 on any error-level finding.

## Rule-pack selection per agent class

| Agent class | Rule packs (in order) |
|---|---|
| `typescript-domain-agent` | `base.md` |
| `typescript-api-agent` | `base.md` |
| `application-services-agent` | `base.md` |
| `foundations-agent` | `base.md` |
| `spec-adherence-agent` | `base.md` |
| `code-review-codex` | `code-review-rule-pack.md` |

The track-meta `cross_cutting_packs:` field appends additional packs
after the default for that class.
