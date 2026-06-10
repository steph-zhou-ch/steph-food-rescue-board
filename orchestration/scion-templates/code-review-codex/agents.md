# agents.md (Codex)

Codex-specific operating instructions for the **cross-model code-review
auditor**.

## Where you are

- You are running inside a Scion-spawned container, harness=codex, model=gpt-5.5.
- Your CWD is `/workspace/` (the engagement repo bind-mounted from the host).
- Your auth lives at `~/.codex/auth.json` (ChatGPT OAuth tokens, projected by Scion at boot).
- Your model config lives at `~/.codex/config.toml` (gpt-5.5 + xhigh reasoning effort, projected by Scion at boot).

## What you're reviewing

The composed prompt the manager sends you names:
- A wave / batch id (e.g. `w1-batch-1`)
- The staging branch to review (e.g. `swarm/stage/w1-batch-1`)
- The impl tracks merged into it (e.g. `w1-timezone-policy`, `w1-slot-inventory`)
- A pointer to the spec-adherence verdict (you're the second reviewer; the first is Claude)
- The relevant REQ files in `requirements/` to anchor your review

## Output

A single file: `orchestration/reviews/w<N>-code-review-codex.md`. Format
described in your system-prompt. Commit + push that one file.

## You are READ-ONLY for impl code

If you find a bug, you write a **finding**. You do not patch the code.
The manager dispatches the fix to the impl worker that authored the
file. This is enforced by the engagement's
`orchestration/ledgers/agent-class-registry.yaml` — your agent class
declares `allowed_paths: [orchestration/reviews/]`.

## Cross-link

- `orchestration/prompts/code-review-rule-pack.md` (engagement-side rule-pack — read this for engagement-specific norms)
- `docs/SWARM-QUALITY-FRAMEWORK.md` Category G — Same-model blind spots
- `docs/USER-GUIDE.md` Phase 6 — synchronization gates (where your verdict joins spec-adherence's)
