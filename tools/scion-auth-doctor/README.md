# scion-auth-doctor

Verifies **every harness credential the swarm needs**, at both **user and project**
scope, and asserts the codex auditor resolves **gpt-5.5/xhigh** (not a silent
fallback to a weaker model).

```bash
pnpm auth-doctor            # verify all creds (fast, read-only)
pnpm auth-doctor --fix      # + auto-re-register drifted codex secrets from local files
pnpm auth-doctor --probe    # + live codex spawn; assert the gpt-5.5 banner (~30s)
pnpm auth-doctor -v
```

## Why it exists
Auth/credential drift was the **#1 failure class** in the appointment-service
engagement (~9 of 22 escalations). Two specific traps it closes:

1. **Codex silent model fallback.** Without `CODEX_CONFIG` registered, the codex
   agent quietly runs the harness-default model (gpt-5.4/medium) instead of the
   intended gpt-5.5/xhigh — so the "cross-model audit" line in closure reports is
   wrong and reviews are weaker than believed. The doctor asserts both the
   registered secret **and** the local `~/.codex/config.toml` model pin.
2. **Scope drift.** Credentials registered at user scope but not project (or vice
   versa) fail at worker spawn. The doctor checks both scopes.

## What it checks
- Hub reachable + correct project
- `~/.scion/secrets.env` (mode 600, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`)
- `ANTHROPIC_API_KEY` at user + project
- Codex auth present via **either** path: `OPENAI_API_KEY` (api-key) **or**
  `CODEX_AUTH` file secret (oauth)
- `CODEX_CONFIG` registered **and** `~/.codex/config.toml` pins `gpt-5.5` + `xhigh`
- Manager UAT (`~/.scion/manager-pat`, mode 600)
- `--probe`: spawns a throwaway `code-review-codex` agent and reads its banner for
  the resolved model, then deletes it

## Auto-heal (`--fix`)
Re-registers `CODEX_AUTH` / `CODEX_CONFIG` from the local `~/.codex/*` files at
both scopes, and rewrites `config.toml` to `gpt-5.5`/`xhigh` if the pin drifted.
Never mints new keys — only re-registers what's already on disk.

Exit: `0` healthy · `1` failures (action items printed) · `2` bad invocation.
Maps to `docs/USER-GUIDE.md` §0.4 and the retrospective P0 #1.
