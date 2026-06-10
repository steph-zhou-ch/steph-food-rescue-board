# captain-preflight

Verifies every Phase-0 prerequisite from `docs/USER-GUIDE.md` before the Captain
attempts to boot the Scion manager. Run before every wave dispatch — fast,
idempotent, no side effects.

## Invocation

```bash
./tools/captain-preflight/check.sh             # default — pass/fail one-liner per check
./tools/captain-preflight/check.sh -v          # also print diagnostic command output
./tools/captain-preflight/check.sh --help
```

## What it checks

Mirrors `docs/USER-GUIDE.md` §"Phase 0" 1:1 — one section per USER-GUIDE step:

| Step | Check |
|---|---|
| 0.1 — Captain laptop tooling | `git` ≥ 2.40, `scion` CLI on PATH, container runtime (podman or docker), `gh` CLI (optional but recommended), Node ≥ 20, pnpm ≥ 9, `yq` on PATH |
| 0.2 — Scion images | `claude` harness registered in `scion harness-config list --global` AND `scion-claude:latest` present in the local `podman image ls` / `docker image ls`. `scion doctor` reports a healthy container runtime. |
| 0.3 — Filesystem layout | Workspace dir exists (with `package.json` + `pnpm-workspace.yaml`), worktree parent dir (`<workspace>-worktrees/`), `~/.scion/` dir |
| 0.4 — Harness credentials and GitHub PAT | `~/.scion/secrets.env` exists, mode 600, contains `ANTHROPIC_API_KEY` AND `GITHUB_TOKEN`. **Codex (OpenAI) credentials**: at least one auth path (`OPENAI_API_KEY` / `CODEX_API_KEY` env or `CODEX_AUTH` file secret) registered on the Hub in user OR project scope, AND the `CODEX_CONFIG` file secret registered (pins gpt-5.5/xhigh — without it the codex worker silently falls back to gpt-5.4/medium). |
| 0.5a — Hub auth bootstrap | Local Scion server reachable via `scion hub status --global`; Hub Integration `Enabled: true`. |
| 0.5b — Manager UAT | `~/.scion/manager-pat` exists, mode 600, non-empty, and `SCION_HUB_TOKEN="$(cat …)" scion hub status --global` returns `Method: Bearer token` (or `Dev auth` in workstation mode). |
| 0.6 — Broker harness-configs | `claude` and `codex` harness-configs registered (REQUIRED — fail); `gemini` and `opencode` (warn-only — only needed if engagement uses them). Remediation: `scion init --machine --yes`. |
| 0.7 — Engagement templates | The 6 project-scoped templates exist on disk under `orchestration/scion-templates/`, each has its trio of files (`scion-agent.yaml` + `system-prompt.md` + `agents.md`), the `agent-class-registry.yaml` references each by name, and each is installed in the current project (`scion templates list`). |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | All checks passed (warnings allowed); proceed to Phase 5 dispatch |
| 1 | One or more blocking failures; resolve before dispatching |
| 2 | Bad invocation (unknown flag) |

## When to run

- **Before every wave dispatch** — even if Phase 0 has been done before, the Hub UAT may have been revoked, the codex `CODEX_CONFIG` secret may have been rotated, agent images may have rolled, or a teammate may have rebuilt a secret.
- **After laptop changes** — new machine, fresh `~/.scion`, OS upgrade.
- **After a long pause** between waves (UAT expires in 1 year by default — see `docs/USER-GUIDE.md` §Step 0.5b on renewal).

## Platform note

Step 0.1 is **TypeScript-specific** (checks `node` + `pnpm`). The other
checks are platform-agnostic and follow the org-canonical USER-GUIDE
verbatim. If your org adopts the swarm for another stack, fork the
Step 0.1 block and replace the Node + pnpm checks with your stack's
equivalents (e.g. `java`/`./gradlew` for Kotlin, `python`/`uv` for
Python). The non-stack checks (`scion`, UAT, Hub bootstrap, codex
credentials, harness-configs, secrets, filesystem, templates) carry
over verbatim.

See `docs/USER-GUIDE.md` §Appendix B for the full list of capabilities a
per-platform playbook must define.
