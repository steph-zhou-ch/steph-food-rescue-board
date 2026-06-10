# `orchestration/track-meta/`

Per-track YAML mission files produced at Phase 4 (wave planning) and
consumed by `tools/prompt-composer` to render the composed prompt the
manager pipes to each Scion worker.

## Lifecycle

| Phase | What happens |
|---|---|
| Phase 4 (Captain) | Author one `<track-id>.yaml` per track in the next wave-batch by copying [`_template-track.yaml`](./_template-track.yaml). |
| Phase 4 (Captain) | Run `pnpm compose-prompts --track-meta <path> --validate-only` for every file — must exit 0 before commit. |
| Phase 4 (Captain) | Run `pnpm compose-prompts --track-meta <path>` for every file — writes `orchestration/prompts/composed/<track-id>.md`. |
| Phase 5 (Manager) | Reads the track-metas for the in-scope batch, walks predecessors (DAG), spawns ready workers, polls completion. |
| Phase 8 (Captain) | Closes the wave; track-metas from earlier waves remain in this directory as historical record (do not delete). |

## File naming

`<track-id>.yaml` — same id used as the git branch (`swarm/<track-id>`),
the done marker (`[complete:<track-id>]`), and the worker container
name when the manager calls `scion create <track-id>`.

See [`docs/USER-GUIDE.md` Appendix D](../../docs/USER-GUIDE.md#appendix-d--track-naming-convention)
+ [`docs/typescript-swarm-playbook.md` §"Track naming"](../../docs/typescript-swarm-playbook.md)
for the kebab-case + wave-prefix convention.

## Schema

Every track-meta must declare: `track_id`, `agent_class`, `phase`,
`wave`, `batch`, `track_summary`, `predecessors`, `deliverables`,
`exit_criterion`, `source_of_truth.req_ids`, `execution_mode`. See
[`_template-track.yaml`](./_template-track.yaml) for field-by-field
documentation.

## Validation

```bash
# Validate one
pnpm compose-prompts --track-meta orchestration/track-meta/<id>.yaml --validate-only

# Validate every track-meta in a wave
for tm in orchestration/track-meta/w<N>-*.yaml; do
  pnpm compose-prompts --track-meta "$tm" --validate-only || exit 1
done

# Read-only path-scope gate (called from the unified typecheck chain)
pnpm check-track-meta-paths
```
