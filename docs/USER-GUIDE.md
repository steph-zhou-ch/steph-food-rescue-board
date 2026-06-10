---
Status: org-canonical
Schema version: 2
Last updated: 2026-05-25
Audience: Captain (human running the swarm) — any team, any stack
Runtime: Scion (container-based manager + workers)
Companion: a per-platform playbook (e.g. `typescript_swarm_playbook.md`) supplies stack-specific commands
---

# Captain's user guide — kick off a swarm with Scion

This is the prescriptive runbook for the **two-layer flow** any team adopting the swarm runs on:

1. **Human-driven planning** — the Captain works in their own Claude
   Code session: author the catalog, run pre-flight, compose the wave,
   stage the handoff bundle.
2. **Manager-driven execution** — the Captain hands the bundle to a
   **Scion manager container**. The manager orchestrates the wave:
   spawns worker containers, runs spec-adherence + integration-coherence
   audits, runs the mechanical gate, merges to trunk, writes the
   closure report.

The Captain stays out of the wave loop while the manager runs it. They
re-engage at wave closure to review, sign off, and plan the next wave.

## Document layering — methodology vs. platform

**This document is platform-agnostic.** It defines the methodology, phases,
roles, dispatch protocol, gates, escalation, and monitoring. Adopt this
as-is regardless of stack — TypeScript, Python, Go, or anything else.

**Stack-specific commands live in a companion playbook** named
`<platform>_swarm_playbook.md` (this engagement ships
`typescript_swarm_playbook.md`). The playbook is a short document that
fills in the concrete invocations for THAT stack: catalog validation,
prompt composition, build & test commands, file/package conventions,
TDD annotation syntax.

When this guide says "run your platform's catalog-validation command,"
your playbook says "for us, that's `pnpm req-lint`" (TypeScript).

See **Appendix B — Onboarding a new platform** at the end of this guide
for the full list of what a per-platform playbook must define.

## The three surfaces

```
┌──────────────────────────────────────────────────────────────┐
│  CAPTAIN SURFACE                                            │
│  Your laptop. Your Claude Code session. You're the human.    │
│  Files you touch: requirements/, prds/, orchestration/...    │
│  Tools you run: req-lint, prompt-composer, scion CLI         │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼  handoff bundle
┌──────────────────────────────────────────────────────────────┐
│  MANAGER SURFACE                                             │
│  Scion container running the `architect-coordinator` agent.  │
│  Reads: handoff bundle + agent-class registry + gates.json   │
│  Spawns: worker containers via `scion create/start/message`  │
│  Writes: status.md, reviews/, reports/, dispatch/            │
└──────────────────────────────────────────────────────────────┘
                            │
                            ▼  worker prompts
┌──────────────────────────────────────────────────────────────┐
│  WORKER SURFACES                                             │
│  One Scion container per track. Isolated worktree per worker.│
│  Worker pushes commits to `swarm/<track-id>` branch.         │
│  Marker on done: `[complete:<track-id>]` commit message.     │
└──────────────────────────────────────────────────────────────┘
```

Companion docs:

- [`README.md`](./README.md) — what this template is
- [`TEMPLATE-USAGE.md`](./TEMPLATE-USAGE.md) — bootstrap recap
- [`RUNTIME.md`](./RUNTIME.md) — the runtime boundary (Scion is "Shape A")
- [`orchestration/HARDENED-SWARM-ORCHESTRATION-DESIGN.md`](../orchestration/HARDENED-SWARM-ORCHESTRATION-DESIGN.md) — design rationale

## Conventions

- `$` = run on your Captain laptop
- `(manager)$` = run inside the manager container (e.g., via `scion exec manager -- bash`)
- `(verify)` = check the expected output before proceeding
- `(decision)` = a choice point — pick before continuing
- `(stop-and-think)` = validate against your team, not just keep going

## Running example throughout

We use **appointments-redesign** as the concrete target — the live engagement this template was distilled from. The reader who's forking for a different service substitutes their own `<your-service>` everywhere.

---

# Phase 0 — Captain prerequisites

## Step 0.1 — Tooling on your Captain laptop

Always required (any platform):

```bash
$ git --version       # ≥ 2.40
$ scion version       # subcommand (NOT --version flag); prints Commit + Build Time
$ podman --version    # or docker; Scion containers run on top of this
```

Plus **your platform's build toolchain** as named by your per-platform playbook. Reference values:

| Platform | Required tools (versions per your playbook) |
|---|---|
| TypeScript / Node | `node` ≥ 20, `pnpm` ≥ 9 |
| Python | `python` ≥ 3.11, `uv` or `poetry` |
| Go | `go` ≥ 1.22 |

### Stack-specific install gotchas

Per-platform playbooks document any platform-specific install caveats
(e.g. `corepack enable` for Node toolchains that ship pnpm via
Corepack). Refer to your platform playbook for the concrete recipe.

For this engagement (TypeScript / Node), the typical pnpm install path
is via Corepack (ships with Node 20):

```bash
$ corepack enable                          # one-time per machine
$ corepack prepare pnpm@latest --activate  # pin a pnpm major
$ pnpm --version                           # confirm ≥ 9
```

(verify) every Phase-0.1 command prints something sensible. If `scion`
is missing or unauthenticated, install + authenticate per your org's
Scion onboarding before continuing. (decision)

## Step 0.2 — Set up the local Scion image repository

Scion agents run inside container images that bundle an LLM harness (Claude
Code, Codex, Gemini, OpenCode) with the Scion runtime tooling. Two facts
about this model that are NOT obvious:

1. **One image per harness, not one image per role.** The manager and
   every worker for a given engagement run the **same** image (this
   engagement runs `scion-claude:latest` for both). The "manager" vs
   "worker" distinction lives in the prompt the container receives, not
   in the image.
2. **There is no `scion image list` command.** Images live in your
   container runtime's store (podman / docker), and Scion's logical
   mapping from harness name to image is exposed via
   `scion harness-config list`.

The image hierarchy:

```
core-base          System dependencies (Go, Node, Python, Git)
  └── scion-base   Adds the sciontool binary + non-root scion user (UID 1000)
        ├── scion-claude     ← THIS engagement uses this for manager + workers
        ├── scion-codex
        ├── scion-gemini
        ├── scion-opencode
        └── scion-hub        (only needed if you self-host the Scion Hub)
```

Pick **one** of the three setup paths below. The local-build paths are
self-contained and don't require a network registry. The registry path is
what you'd use to share pre-built images across a team.

### Path A — Local Podman build (recommended; matches `scion doctor` default on macOS)

This path requires the CH Scion source repo cloned locally — the canonical location is `~/projects/scion-ch`. The engagement repo's
helper script (`./tools/setup-scion-images/build.sh`, available **after** you've completed Phase 1.1 below) wraps the upstream
command, but you can run the upstream directly here in Phase 0 before any engagement repo exists:

```bash
# One-time: clone the Scion source if it isn't already present
$ git clone https://github.com/CharlieHealth/scion-ch.git ~/projects/scion-ch

# First-time build — builds the full DAG (~15 min, single-arch)
$ ~/projects/scion-ch/image-build/scripts/build-images.sh --builder local-podman --target all

# Subsequent rebuilds (after a Scion source pull) — skips core-base (~5 min)
$ ~/projects/scion-ch/image-build/scripts/build-images.sh --builder local-podman --target common
```

After Phase 1.1 — once you've cloned the engagement repo — the wrapper script becomes
available and is more ergonomic for repeat use:

```bash
$ ./tools/setup-scion-images/build.sh            # equivalent of --target all
$ ./tools/setup-scion-images/build.sh --rebuild  # equivalent of --target common
$ ./tools/setup-scion-images/build.sh --clone    # also git-clones scion source if missing
$ ./tools/setup-scion-images/build.sh --dry-run  # preview
```

See [`tools/setup-scion-images/README.md`](../tools/setup-scion-images/README.md)
for advanced options (custom source path, dry-run, etc.).

### Path B — Local Docker build

If you prefer Docker over Podman, run the upstream builder directly:

```bash
$ cd ~/projects/scion-ch
$ ./image-build/scripts/build-images.sh --target all   # default --builder local-docker
```

### Path C — Pull from a shared registry (team mode)

If your team has already built and pushed Scion images to a private
registry, point Scion at it and let it pull on first agent spawn:

```bash
# One-time configuration
$ scion config set image_registry ghcr.io/<your-github-org>
# or
$ scion config set image_registry us-central1-docker.pkg.dev/<your-gcp-project>/scion

# Verify the rewrite is in effect
$ grep image_registry ~/.scion/settings.yaml
```

`scion config set image_registry` rewrites the registry prefix of every
`scion-<harness>:<tag>` reference. CLI `--image` flags and template
`scion-agent.yaml` values still override it; the upstream Scion
[`custom-images.md`](https://github.com/CharlieHealth/scion-ch/blob/main/docs-site/src/content/docs/advanced-local/custom-images.md)
documents the full override precedence ladder.

### (verify) Phase-0.2 is satisfied

After the build (or registry config) lands:

```bash
# Use --global to query the system-wide harness registry (the bare
# 'scion harness-config list' requires being inside a scion-initialized
# project, which doesn't exist yet in Phase 0).
$ scion harness-config list --global
NAME      HARNESS    IMAGE
claude    claude     scion-claude:latest
codex     codex      scion-codex:latest
gemini    gemini     scion-gemini:latest
opencode  opencode   scion-opencode:latest

$ podman image ls --format '{{.Repository}}:{{.Tag}}' | grep '^scion-claude:latest$'
scion-claude:latest
```

Then re-run `./tools/captain-preflight/check.sh` — the image step should
go green. (The preflight script lives in the engagement repo and is only
available after Phase 1.1.)

### What this engagement actually uses

The Wave-1 dispatch covers:

| Role | Image |
|---|---|
| Manager (`architect-coordinator` prompt) | `scion-claude:latest` |
| Worker — `w1-timezone-policy` | `scion-claude:latest` |
| Worker — `w1-slot-inventory` | `scion-claude:latest` |
| Worker — `w1-spec-adherence` (audit) | `scion-claude:latest` |

Minimum image set needed to boot Wave 1: **`scion-claude:latest`** (plus
its transitive prerequisites `scion-base`, `core-base`). The other
harness images are nice-to-have for cross-engagement parity but not
required.

## Step 0.3 — Host filesystem layout

Scion bind-mounts host directories into containers. The engagement uses a
**sibling-directory** convention (NOT a per-workspace `.scion/`):

```bash
# Engagement workspace (cloned in Phase 1.1):
~/projects/<your-service>/

# Sibling worktrees dir — manager creates one git worktree per worker track:
$ mkdir -p ~/projects/<your-service>-worktrees

# Scion's global state lives outside any engagement repo:
$ ls -la ~/.scion/
agents/             # provisioned agent containers
harness-configs/    # claude/codex/gemini/opencode
templates/          # scion create templates
secrets.env         # harness credentials (mode 600; see Step 0.4)
manager-pat         # the UAT bearer token (mode 600; see Step 0.5b)
```

(verify) `~/projects/<your-service>-worktrees` exists; `~/.scion/` is
present (Scion creates it on first run; if not, `scion init` materialises
it).

## Step 0.4 — Harness credentials and GitHub PAT

There is **no `scion secret` subcommand**. Scion's credential and
auth-token mechanism is file-based.

### Harness API key (Anthropic / Gemini / etc.)

Stored in `~/.scion/secrets.env` as `KEY=VALUE` pairs, sourced by Scion
when it spawns an agent. Set up once per laptop:

```bash
$ cat ~/.scion/secrets.env
# scion harness credentials — sourced before running scion.
# Format: KEY=VALUE
# This file is in ~/.scion (outside any git repo). chmod 600.

ANTHROPIC_API_KEY=<your-key>
# Optional, per the harness you use:
# GEMINI_API_KEY=<your-key>
# OPENAI_API_KEY=<your-key>

$ chmod 600 ~/.scion/secrets.env
$ ls -la ~/.scion/secrets.env   # -rw------- expected
```

### Codex (OpenAI) credentials for the `code-review-codex` agent

The cross-model auditor (`code-review-codex`) runs on the Codex CLI talking to OpenAI. It is NOT optional — the two-vantage merge rule requires both spec-adherence (Claude) AND codex (OpenAI/gpt-5.5) verdicts to gate every wave-batch merge. Without codex credentials registered on the broker, every `scion start <codex-agent>` fails at auth resolution and the wave stalls.

The codex harness-config (`~/.scion/harness-configs/codex/config.yaml`) declares two auth paths via `required_env: [{any_of: [CODEX_API_KEY, OPENAI_API_KEY]}]` (api-key mode) or `required_files: [CODEX_AUTH @ /home/scion/.codex/auth.json]` (auth-file / OAuth mode). The container-side `provision.py` converts whichever the broker provides into `~/.codex/auth.json` inside the agent container before the Codex CLI starts.

In addition, the engagement's `code-review-codex` template prescribes a SECOND companion file secret — `CODEX_CONFIG` mounted at `/home/scion/.codex/config.toml` — that pins the model to `gpt-5.5` with `model_reasoning_effort = "xhigh"`. **Without `CODEX_CONFIG` registered**, the worker silently falls back to the harness-config default model (`gpt-5.4`, `medium` reasoning) and your closure report's "cross-model audit" line is wrong.

#### Path A — API key (recommended; simplest team onboarding)

Mint a key at https://platform.openai.com/api-keys (or your org's OpenAI console), then register at user + project scope:

```bash
# Either env var name works; the codex harness accepts both.
$ scion hub env set OPENAI_API_KEY=<value> --always --secret
$ scion hub env set --project OPENAI_API_KEY=<value> --always --secret
```

OR add the key to `~/.scion/secrets.env` (parallel to `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`):

```bash
$ cat >> ~/.scion/secrets.env <<'EOF'
OPENAI_API_KEY=<your-key>
EOF
$ chmod 600 ~/.scion/secrets.env
```

Then also register the model-config file secret (REQUIRED regardless of which auth path you pick):

```bash
$ cat > ~/.codex/config.toml <<'EOF'
model = "gpt-5.5"
model_reasoning_effort = "xhigh"
EOF
$ scion hub secret set --type file \
    --target /home/scion/.codex/config.toml \
    CODEX_CONFIG @$HOME/.codex/config.toml
$ scion hub secret set --project --type file \
    --target /home/scion/.codex/config.toml \
    CODEX_CONFIG @$HOME/.codex/config.toml
```

(verify both registered):

```bash
$ scion hub env get OPENAI_API_KEY            # → (always, secret) or v1 <timestamp>
$ scion hub env get OPENAI_API_KEY --project    # same
$ scion hub secret list                       # CODEX_CONFIG present
$ scion hub secret list --project               # CODEX_CONFIG present
```

#### Path B — OAuth file (Captain's local ChatGPT login)

If you already log into ChatGPT via the Codex CLI on your laptop, you'll have `~/.codex/auth.json` (~4-5KB). Register it as a file-typed secret:

```bash
# Verify it exists locally first:
$ ls -la ~/.codex/auth.json   # expect a recent timestamp, ~4-5KB

# Register at both scopes (broker mounts the file into worker containers):
$ scion hub secret set --type file \
    --target /home/scion/.codex/auth.json \
    CODEX_AUTH @$HOME/.codex/auth.json
$ scion hub secret set --project --type file \
    --target /home/scion/.codex/auth.json \
    CODEX_AUTH @$HOME/.codex/auth.json

# AND the model-config (same as Path A):
$ scion hub secret set --type file \
    --target /home/scion/.codex/config.toml \
    CODEX_CONFIG @$HOME/.codex/config.toml
$ scion hub secret set --project --type file \
    --target /home/scion/.codex/config.toml \
    CODEX_CONFIG @$HOME/.codex/config.toml
```

(verify):

```bash
$ scion hub secret list           # CODEX_AUTH + CODEX_CONFIG present
$ scion hub secret list --project   # same
```

#### Verifying codex actually starts

The unambiguous check is a Captain-side smoke spawn against any branch:

```bash
$ scion create cr-probe -t code-review-codex --harness codex -b main
$ scion start cr-probe
# If you see "phase: running" within ~30s and `scion look cr-probe` shows the
# codex CLI banner, you're good. Then clean up:
$ scion delete cr-probe
```

If `scion start` errors with `auth resolution failed: codex: no valid auth method found`, see Gotcha 7 below.

#### Why two scopes (`--user` and `--project`)

Belt-and-suspenders. The broker resolves credentials against (user scope ∪ project scope) when spawning a worker; if your engagement has multiple projects or the user scope hasn't fully propagated, the project-scoped registration catches it. Set both unless you have a deliberate reason not to (e.g., multi-engagement laptop sharing a single OpenAI key across separate teams).

#### Fallback policy when codex genuinely won't start

If after multiple troubleshooting passes codex still can't authenticate (auth-file corrupt + API key revoked, broker not propagating the secret, etc.), DO NOT block the wave. Substitute a second Claude Opus 4.7 reviewer running the codex prompt against the codex rule-pack. The closure report names the deviation. Document this as a Captain-side override in the closure-report deviation section so the lesson surfaces at engagement close.

### GitHub PAT (workers push to origin)

In hub_mode (workers push to `swarm/*` branches on `origin`), each worker
needs a PAT with `repo` scope. The PAT is sourced from
`~/.scion/secrets.env` at agent spawn time.

**Shortcut**: if you've already authenticated `gh` against the org, reuse its token — it almost certainly already has `repo` scope:

```bash
# Verify gh has 'repo' scope:
$ gh auth status | grep "Token scopes"
- Token scopes: 'gist', 'read:org', 'repo', 'workflow'

# Append to secrets.env (no token printed to screen):
$ printf "GITHUB_TOKEN=%s\n" "$(gh auth token)" >> ~/.scion/secrets.env
$ chmod 600 ~/.scion/secrets.env
```

**Manual path**: if `gh` isn't authenticated, mint a PAT at
https://github.com/settings/tokens (classic; `repo` scope; 1-year expiry):

```bash
$ echo "GITHUB_TOKEN=<your-PAT-with-repo-scope>" >> ~/.scion/secrets.env
$ chmod 600 ~/.scion/secrets.env
```

Then at spawn time the manager pipes it through:

```bash
$ scion create <agent-name> \
    --harness claude \
    --workspace <path> \
    -b <branch>
# Scion sources ~/.scion/secrets.env automatically; GITHUB_TOKEN
# becomes available inside the container.
```

(verify) `cat ~/.scion/secrets.env` shows both `ANTHROPIC_API_KEY` (or
your harness's API key) AND `GITHUB_TOKEN`; both `ls -la` shows mode 600.

**REQUIRED: also register GITHUB_TOKEN at project scope on the Hub.**
The `secrets.env` path handles the manager container, but workers
spawned BY the manager resolve credentials from the Hub's project-scoped
env. Without project-scope registration, workers cannot push to origin:

```bash
$ scion hub env set GITHUB_TOKEN="$(gh auth token)" --always --secret
$ scion hub env set --project GITHUB_TOKEN="$(gh auth token)" --always --secret
# Verify:
$ scion hub env get GITHUB_TOKEN         # user scope
$ scion hub env get GITHUB_TOKEN --project # project scope
```

This is not belt-and-suspenders — it is required. Workers that cannot
push lose all work on container restart (see Gotcha 16 below).

## Step 0.5a — Hub auth bootstrap (one-time interactive)

The first time you set up Scion on a new laptop, prove your identity
to the Hub via the standard OAuth device-code flow. This is a one-time
step — you will NOT do this daily.

```bash
$ scion hub auth login        # opens browser; OAuth via google or github
                              # (your org IdP — e.g. Okta — gates this)
$ scion hub status --global   # --global required when not inside a scion project
Authenticated as: <your@org.com>
```

> **Note**: `scion` is project-scoped by default. Almost every Hub
> subcommand requires either being inside a scion-initialized project
> (`scion init`) or passing `--global` to operate against the global
> project. The guide adds `--global` in every Phase-0 Hub command for
> clarity.

(verify) authenticated. Providers supported: `google`, `github`. Both
typically federate to your corporate IdP (e.g. Okta) which enforces a
24h max session policy on the OAuth side. Re-authenticating every
24 hours would be a non-starter for a 24/7 swarm — Step 0.5b below
solves that by minting a bearer token that lives outside the OAuth
session lifecycle.

## Step 0.5b — Mint a manager UAT (covers the next 12 months)

A User Access Token (UAT) is a long-lived bearer token, independent of
your OAuth session. The manager container reads it from env on every
call; it does not need a live OAuth session to work. Mint it once;
renew once a year.

```bash
$ scion hub token create \
    --project <your-project> \
    --name "manager-${USER}-<project>" \
    --scopes "agent:create,agent:read,agent:list,agent:start,agent:stop,agent:delete,agent:dispatch,agent:message,project:read" \
    --expires 1y

Created access token: manager-ashok-appointment-swarm
  ID:      9a640536-...
  Expires: 2027-05-21T...
Token: scion_pat_...

This token will not be shown again. Store it securely.
```

Store the token in `~/.scion/manager-pat` with mode 600:

```bash
$ echo -n "scion_pat_..." > ~/.scion/manager-pat
$ chmod 600 ~/.scion/manager-pat
$ ls -la ~/.scion/manager-pat
-rw-------  ...  ~/.scion/manager-pat
```

(verify) file exists, mode 600.

### Why these 9 scopes

Each scope corresponds to one CLI verb the manager uses against
workers across a wave's lifecycle:

| Scope            | Manager uses it for                                  |
|------------------|------------------------------------------------------|
| `agent:create`   | `scion create <worker>` — provision worker container |
| `agent:start`    | `scion start <worker>` — boot the container          |
| `agent:list`     | `scion list` — enumerate worker state                |
| `agent:read`     | `scion logs <worker>`, `scion look <worker>`         |
| `agent:message`  | `scion message <worker> "..."` — dispatch prompts    |
| `agent:dispatch` | `scion dispatch` — create + start in one call        |
| `agent:stop`     | `scion stop <worker>` — pause / end-of-wave          |
| `agent:delete`   | `scion rm <worker>` — cleanup                        |
| `project:read`     | resolve project identity at startup                    |

Note: the `agent:manage` convenience alias resolves to a subset of
these that is missing `agent:message`. The manager needs `agent:message`
to send composed prompts to workers, so list the scopes explicitly
rather than relying on the alias.

### Verify it works

```bash
$ SCION_HUB_TOKEN="$(cat ~/.scion/manager-pat)" scion hub status --global
...
Authentication
--------------
Method:     Bearer token
```

(verify) `Method: Bearer token`. The `User:` field shows the token's
owner in a production-auth Hub; in `--dev-auth` mode it shows
`Development User` — that's expected and doesn't indicate a broken
token.

### Renewal cadence

The token expires in 1 year. Set a calendar reminder a month before
the expiry date (visible in `scion hub token list`) to mint a new
one, swap it into `~/.scion/manager-pat`, and revoke the old one:

```bash
$ scion hub token list
$ scion hub token create --project ... --name ... --scopes ... --expires 1y
$ echo -n "<new>" > ~/.scion/manager-pat
$ scion hub token revoke <old-token-id>
```

### When to use the interactive OAuth flow

After Step 0.5a / 0.5b, you should never need `scion hub auth login`
again unless:

- You're minting a new UAT (the auth session is needed to authorize
  the `scion hub token create` call).
- A teammate's UAT was leaked and revoked; they need to bootstrap a
  replacement.
- You're testing the bootstrap path on a fresh laptop.

The `scion stop manager && scion start manager` restart recipe used
to cover daily hub-auth expiry; with UATs in place that's no longer
the cause of 401 errors. See "Manager returned 401" in the
troubleshooting section for the updated diagnostic hierarchy.

## Step 0.6 — Seed broker harness-configs

```bash
$ scion init --machine --yes
$ scion config set image_registry localhost --global
```

This is the host-level setup that seeds the named `harness-config`
entries (`claude`, `codex`, `gemini`, `opencode`) on the local
runtime broker. The broker resolves the `--harness <named-config>`
flag at agent-create-time against these entries. Without them, every
`scion create … --harness claude` call would return a 500 error from
the broker (the error surfaces as "No harness configurations found.
Run 'scion init --machine'").

The `image_registry localhost` setting ensures the runtime resolves
images from the local container store (where `build.sh` places them)
rather than attempting to pull from a remote registry.

(verify) the named configs and registry are present:

```bash
$ scion harness-config list --global
NAME      HARNESS    IMAGE
claude    claude     scion-claude:latest
codex     codex      scion-codex:latest
gemini    gemini     scion-gemini:latest
opencode  opencode   scion-opencode:latest

$ grep image_registry ~/.scion/settings.yaml
image_registry: localhost
```

If only `claude` and `codex` are critical for your engagement, you
can omit the other two — but the default `init --machine` seeds all
four.

## Step 0.7 — Install the engagement's project-scoped agent templates

Each engagement ships its own template fleet under
`orchestration/scion-templates/` (one directory per class, with
`scion-agent.yaml` + `system-prompt.md` + `agents.md`). Install
them into THIS engagement's project (NOT the global project — keeps
templates isolated per engagement):

```bash
$ scion templates import orchestration/scion-templates/ --all
```

Re-run with `--force` after editing a template's source.

**Template schema (post broker-schema-bump):**

```yaml
schema_version: "1"
description: "<one-liner>"
agent_instructions: agents.md
system_prompt: system-prompt.md
```

The template MUST NOT carry inline `harness:` / `image:` /
`auth_selectedType:` fields — the broker rejects with "'harness'
field is no longer supported in scion-agent.yaml. Remove it and use
--harness-config to specify the harness". Harness selection happens
at `scion create` time via `--harness <named-config>` (Step 0.6).

(verify) templates installed in the current project:

```bash
$ scion templates list
…
Grove:
  NAME                        PATH
  application-services-agent  /Users/<you>/projects/<engagement>/.scion/templates/application-services-agent
  code-review-codex           …
  foundations-agent           …
  spec-adherence-agent        …
  typescript-api-agent        …
  typescript-domain-agent     …
```

(also verify) sync to the Hub so the broker can pull them at agent
provision time:

```bash
$ scion templates sync --all
```

The captain-preflight script verifies both presence on disk + project
install + registry-class-wiring + Hub sync.

## Step 0.8 — Captain/swarm authority hook (policy-as-code)

The methodology has a hard split between **Captain authority** (orchestration
scaffolding: `tools/`, `docs/`, `.claude/`, `infra/`,
`orchestration/dispatch/`, `requirements/` REQ files,
`orchestration/track-meta/`, `orchestration/gates/gates.json`) and **swarm
authority** (everything the workers exist to author: `apps/`, `libs/`,
`clients/`, `migrations/`). Stop-hook pressure during a wave makes it
tempting for a Captain to grab the keyboard and edit application source
directly when a worker is "almost done" or "stuck on something obvious"
— this looks like helpfulness; it is actually a methodology violation.
See Phase 6 §"Captain authority boundaries (do not grab the keyboard)"
for why and the Phase 7 §"Captain merge authority" carve-out for the one
narrow exception.

To make the boundary mechanical rather than aspirational, install a
`PreToolUse` hook in `.claude/settings.local.json` that blocks the
Captain's Claude Code session from issuing `scion message <worker-slug>`
/ `scion start <worker-slug>` / `scion delete <worker-slug>` against any
agent whose name matches the wave-worker pattern (`w[0-9]+-`). Allow
`scion message manager`, `scion list`, `scion look`, `scion logs`. The
effect: nudging the manager and reading swarm state stay frictionless;
talking directly to a worker requires the Captain to consciously
disable the hook, which is the moment of pause that catches the
reflex-bypass.

A reference hook (Claude Code settings format):

```jsonc
// .claude/settings.local.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "tools/captain-authority/check.sh"
          }
        ]
      }
    ]
  }
}
```

Where `tools/captain-authority/check.sh` reads the proposed bash command
from stdin and exits non-zero if it matches `scion (message|start|delete) w[0-9]+-`.
Per-engagement script lives in the engagement repo so updates ship with
methodology updates.

(recipe-lesson) An early Captain shift surfaced this: under
Stop-hook pressure mid-wave, the Captain started authoring
`apps/app/src/database/database.module.ts` directly. The user caught it
("wait are you coding yourself??") and the rule became: any new
application work goes through the manager, no exceptions outside the
narrow Captain-merge carve-out. The hook above is what enforces that
when judgment is fatigued.

---

# Phase 1 — Author the catalog and design (Captain session)

This phase happens in your Claude Code session on your laptop. The
manager does not exist yet.

## Step 1.1 — Clone or fork the engagement repo

Two paths, depending on whether your engagement repo already exists:

**A. Adopting in an existing repo** (most common): `git clone` it.

```bash
$ git clone https://github.com/<org>/<engagement-repo>.git ~/projects/<your-service>
$ cd ~/projects/<your-service>
```

**B. Bootstrapping a fresh engagement from the template**: `cp` the
template and re-initialize git. Use this only if your org has a swarm
template repo (e.g. `~/projects/swarm-template`) and you're starting a
brand-new service.

```bash
$ cp -R ~/projects/swarm-template ~/projects/<your-service>
$ cd ~/projects/<your-service>
$ rm -rf .git
$ git init && git checkout -b <bootstrap-branch>
```

(verify) `ls` shows the engagement scaffolding:
`package.json`, `pnpm-workspace.yaml`, `requirements/`, `orchestration/`,
`tools/` (and the per-platform playbook, e.g. `typescript_swarm_playbook.md`).

## Step 1.2 — Substitute placeholders

Decide your values and run the sed recipe from
[`TEMPLATE-USAGE.md`](./TEMPLATE-USAGE.md) Step 2. For appointments:

```bash
$ LC_ALL=C find . -type f \( -name "*.md" -o -name "*.yaml" -o -name "*.yml" -o -name "*.json" -o -name "*.sh" -o -name "*.ts" -o -name "*.graphql" \) -print0 | \
    xargs -0 sed -i '' \
      -e 's|<YOUR-SERVICE>|Appointments|g' \
      -e 's|<your-service>|appointments|g' \
      -e 's|<DOMAIN>|appointments|g' \
      -e 's|<your-domain>|appointments|g' \
      -e 's|<YOUR-TEAM>|SchedulingTeam|g' \
      -e 's|<your-pm-handle>|@pm-scheduling|g' \
      -e 's|<your-tech-handle>|@tech-application-services|g' \
      -e 's|<your-qa-handle>|@qa-scheduling|g' \
      -e 's|<your-security-handle>|@security-tenant-isolation|g' \
      -e 's|<your-data-handle>|@data-events|g' \
      -e 's|<your-org>|Charlie Health|g' \
      -e 's|<YOUR-ORG-LEGAL>|Charlie Health, Inc.|g' \
      -e 's|<your-service-repo>|appointment-swarm|g' \
      -e 's|<your-github-org>|CharlieHealth|g'
```

(verify) no unexpected placeholders remain in non-template files:

```bash
$ grep -rln '<YOUR-\|<your-' . --include "*.md" --include "*.yaml" --include "*.json" 2>/dev/null | grep -v '_template-' | grep -v '/examples/'
# should print nothing
```

## Step 1.3 — Install tool dependencies

Your platform playbook names the **catalog-validator**, **track-meta
migrator**, and **prompt-composer** invocations. Install whatever they
depend on.

| Platform | Commands |
|---|---|
| TypeScript / Node | `pnpm install` at the repo root (workspace install pulls down dependencies for every `apps/*` and `tools/*` package; idempotent). |

(verify) your playbook's "smoke test" command exits 0. For TypeScript
teams, that's `pnpm req-lint` against an empty-or-existing catalog.

## Step 1.4 — Author the service PRD and design phases

In your Claude Code session, work through:

- `00-overview/vision.md` (from `_template-vision.md`)
- `00-overview/assumptions.md`
- `00-overview/glossary.md`
- `10-discovery/*.md`
- `20-domain/*.md`
- `30-architecture/*.md` + ADRs
- `40-api/*.md`
- `50-agents/*.md`
- `60-rollout/*.md`
- `prds/service-prd.md`

This is product/architecture work — Claude Code helps you draft and
iterate but **you and your team own the content**. Iterate with
stakeholders until the PRD has sign-off.

(stop-and-think) **Do not proceed to Phase 2 until the service PRD is
approved.** Without an anchor, the catalog has nothing to map against.

## Step 1.5 — Author the REQ catalog

Per [`requirements/README.md`](../requirements/README.md):

1. List your capabilities (CAPs), invariants (INVs), integrations (INTs).
2. For each, decide single-file vs directory layout.
3. Copy the template; fill in frontmatter + Product Contract + Policy +
   Technical Contract + Acceptance Criteria (with machine YAML
   predicates).
4. Run `tools/req-lint/` after every 3-5 REQs.

For appointments, the catalog is already authored — 45 v3 worked
examples live at [`requirements/examples/`](../requirements/examples/).
You can copy these directly into `requirements/` as your starting
catalog and adapt:

```bash
$ cp requirements/examples/REQ-CAP-*.md requirements/
$ cp -R requirements/examples/REQ-CAP-BOOK-APPOINTMENT requirements/
$ cp requirements/examples/REQ-INT-*.md requirements/
$ cp requirements/examples/REQ-INV-*.md requirements/
```

(verify) `ls requirements/REQ-*.md requirements/REQ-*/index.md | wc -l`
prints 45.

## Step 1.6 — Commit catalog

```bash
$ git add 00-overview/ 10-discovery/ 20-domain/ 30-architecture/ \
          40-api/ 50-agents/ 60-rollout/ prds/ requirements/
$ git commit -m "Phase 1: design + catalog authored"
$ git tag phase-1-complete
```

---

# Phase 2 — Pre-flight (Claude-driven)

The catalog must be internally consistent and audit-clean before the
manager runs. In max-effort Claude Code, Claude drives the loop: run
`req-lint`, fix mechanical findings, spawn the catalog-readiness
subagent, triage findings, propose fixes. You make judgment calls and
approve the commit.

**Mode of operation.** This phase, and Phases 3 + 4, are run from your
interactive Claude Code session with `/effort max` set. The phase
prompts below are pasted verbatim into Claude. Claude does the work;
you decide and approve.

## What Claude does

- Runs `tools/req-lint`, fixes mechanical findings, re-runs until clean
- Spawns the catalog-readiness subagent via the `Agent` tool and reads its verdict
- Triages findings by `target_role` and applies / surfaces / escalates per the rules below
- Writes a phase report at `orchestration/reports/phase-2-pre-flight.md`

## What you decide

- Accept or reject Claude's proposed fixes for `pm`-routed and `Captain`-routed findings
- Adjudicate semantic disputes (Claude surfaces; you decide)
- Declare `verdict=ready` (or send back for another cycle)
- Approve the commit + tag

## Verify gate

- `orchestration/reviews/catalog-readiness-<TS>.md` exists; verdict block reads `ready`
- `orchestration/reports/phase-2-pre-flight.md` exists
- `tag phase-2-complete` points at the catalog-clean commit

## Escalation

If Claude can't reach `verdict=ready` in 3 cycles, stop and convene
with the PM + tech owner. Don't retry blindly.

## The prompt (paste verbatim into Claude Code; `/effort max` first)

````
You are running Phase 2 (Pre-flight) of the swarm setup for this repo.

MISSION: bring the REQ catalog at `requirements/` to `verdict=ready`
from the catalog-readiness subagent. Use max-effort reasoning.

CONTEXT TO READ FIRST:
- orchestration/HARDENED-SWARM-ORCHESTRATION-DESIGN.md (the methodology)
- requirements/*.md (the full catalog — read every file)
- orchestration/prompts/rule-packs/catalog-readiness-agent.md
- orchestration/track-meta/_template-catalog-readiness.yaml

LOOP (cycle counter starts at 1; cap at 3):

1. Run your platform's catalog-validation command per the per-platform
   playbook. Reference invocations:

   | Platform | Command |
   |---|---|
   | TypeScript / Node | `pnpm req-lint --catalog requirements --output orchestration/reviews/req-lint-$(date -u +%Y-%m-%dT%H-%M-%SZ).json` (validates frontmatter + embedded YAML against REQ Spec v3) |

   If exit=non-zero: fix findings autonomously. Apply any
   `suggested_fix` field where present; author your own fix otherwise.
   Re-run the validator until exit=0. Mechanical fixes do NOT consume a cycle.

2. Spawn the catalog-readiness subagent via the Agent tool. Its prompt
   is the rule pack + the track-meta template + a directive to write
   the report to `orchestration/reviews/catalog-readiness-${TS}.md`.
   Wait for the report.

3. Read the verdict block at the bottom:
   - `verdict: ready` → write the phase report (see below) and PAUSE
     for me to confirm the commit.
   - `verdict: needs-fixes` → triage findings by `target_role`:
     * `pm` — surface to me as a list with proposed PM-readable fixes;
       PAUSE for my decision per cluster.
     * `technical-owner` — apply if mechanical; surface and PAUSE if
       the fix is a semantic judgment call.
     * `spec-curator` — re-run spec-curator-agent on affected REQs and
       merge its proposed fixes.
     * `manager` — fix directly (format, ledger, track-meta issues).
     * `Captain` — surface and PAUSE for my decision.
   - `verdict: not-ready` → systemic issue; STOP and surface everything.

4. Increment cycle counter. If cycle > 3 → STOP and ESCALATE per
   "Escalation" above.

5. Re-run from step 1.

PHASE REPORT (write when reaching `ready` or when escalating):
Create `orchestration/reports/` if it doesn't exist.
Path: `orchestration/reports/phase-2-pre-flight.md`
Sections:
- Cycle count + what changed each cycle
- Final verdict + path to the canonical catalog-readiness-<TS>.md
- Findings applied autonomously vs. surfaced to me
- Open findings I deferred (with rationale)

WHEN DONE: tell me the path to the phase report and the proposed
commit message. Wait for my confirmation before any git operation.
````

## Commit boundary

When verdict=ready and you've reviewed the phase report:

```bash
$ git add requirements/ orchestration/reviews/ orchestration/reports/
$ git commit -m "Phase 2: catalog-readiness verdict=ready"
$ git tag phase-2-complete
```

---

# Phase 3 — Orchestration setup (Claude-driven)

Customize the `orchestration/` folder for your stack, your team, and
your REQ catalog. The methodology survives any stack substitution;
only concrete commands and tool names change.

## What Claude does

- Inventories your stack (reads `package.json`, `pyproject.toml`, `go.mod`, etc.)
- Copies templates and fills in `domain:`, `last_audited_at:`, and stack-specific fields
- Proposes edits to `gate-check.sh` and rule packs against your stack
- Proposes the manager kickoff prompt customizations
- Writes a phase report at `orchestration/reports/phase-3-customization.md`

## What you decide

- Which agent classes to drop from the registry (Claude proposes the keep/drop list)
- Your trunk branch name
- Engagement-specific recipe-lessons to bake into the manager kickoff (note: methodology-wide lessons belong upstream in `project-template/orchestration/prompts/manager-kickoff.md`, not per-repo — see the recipe-lessons section there)
- Approve the commit + tag

## Recommended: delegate the draft to a subagent

Phase 3 produces ~10 files of edits + a closure report. Doing it
inline eats main-thread context. The recommended pattern is to spawn
a subagent that drafts edits + the closure report, then surface
discrete decisions (agent-class drops, gate adaptations, rule-pack
edits, manager-kickoff customizations) as `AskUserQuestion` rounds
to the Captain. The Captain reviews answer-by-answer; the main
thread stays free for git operations + validation.

The "Phase 3 prompt" below is what to send to the subagent. You as
Captain don't paste it into the main session — you ask Claude Code
to "spawn a Phase 3 setup subagent" and let it dispatch with this
prompt and report back.

## Verify gate

- `orchestration/ledgers/agent-class-registry.yaml` parses as YAML
- `orchestration/gates/gates.json` is valid JSON
- `orchestration/gates/gate-check.sh --list` runs without error
- `orchestration/reports/phase-3-customization.md` exists
- `tag phase-3-complete`

## The subagent prompt (`/effort max` recommended)

````
You are running Phase 3 (Orchestration setup) of the swarm setup.

MISSION: customize `orchestration/` for this engagement's stack + team
+ REQ catalog. Use max-effort reasoning.

CONTEXT TO READ FIRST:
- requirements/*.md (the catalog — to know what tracks will exist)
- orchestration/HARDENED-SWARM-ORCHESTRATION-DESIGN.md
- Stack inventory: package.json, pyproject.toml, go.mod, any tooling config
- orchestration/ledgers/_template-*.yaml (templates to copy)
- orchestration/gates/_template-gates.json
- orchestration/gates/gate-check.sh (shipped targeting TS/pnpm)
- orchestration/prompts/rule-packs/*.md (shipped for TS/Drizzle/NestJS/Pothos)
- orchestration/prompts/_template-manager-kickoff.md

WORK:

1. Stack inventory: identify the primary language(s), package
   manager(s), build tool(s), ORM, framework. Surface this as a short
   table.

2. Agent class registry: copy `_template-agent-class-registry.yaml` to
   `agent-class-registry.yaml`. Read the template's full class list
   and PROPOSE which to keep vs. drop based on the REQ catalog.
   Surface the keep/drop list to me; PAUSE for my approval before
   saving.

3. Ledger seeds: copy the three ledger templates (contract-ledger,
   stub-ledger, generated-artifacts-ledger) and the trunk-health
   baseline. Set `domain:` and `last_audited_at:` on each. Leave
   inventories empty.

4. gates.json: copy `_template-gates.json` to `gates.json`. For each
   gate marked `$template: true`, propose `predecessor_tracks` derived
   from the catalog's track structure. Surface the proposed gate set
   to me; PAUSE for my approval. Drop gates that don't apply.

5. gate-check.sh adaptations: if the stack differs from TS/pnpm,
   propose case-dispatch replacements (e.g., `pytest -k` instead of
   `pnpm -r test`). Show me the diff before saving.

6. Rule pack adaptations: grep for `pnpm|Drizzle|NestJS|Pothos` in the
   rule packs; propose stack-specific replacements. Show diffs.

7. Manager kickoff prompt: copy `_template-manager-kickoff.md` to
   `manager-kickoff.md`. Fill in:
   - Workspace path
   - Hub host + auth method (UAT via `SCION_HUB_TOKEN` per Phase 0.5b)
   - Trunk branch name — ASK ME
   - Gate ids the first wave will run (from the gates.json you just
     customized)
   - Recipe-lessons section — ASK ME for any engagement-specific
     lessons to bake in.

PHASE REPORT (write at end):
Path: `orchestration/reports/phase-3-customization.md`
Sections:
- Stack inventory table
- Agent classes kept / dropped (with rationale)
- Gates kept / dropped / added
- Stack-specific replacements in gate-check.sh and rule packs (one
  bullet per change)
- Manager kickoff customizations
- Open items I asked you about + your decisions

WHEN DONE: list the customized file paths and the proposed commit
message. Wait for my confirmation before any git operation.
````

## Commit boundary

After you've reviewed the phase report:

```bash
$ git add orchestration/
$ git commit -m "Phase 3: orchestration customized for <domain> + <stack>"
$ git tag phase-3-complete
```

---

# Phase 4 — Plan the wave (Claude-driven)

Compose the **handoff bundle** the manager will consume to run the
wave. Claude proposes the wave + track set from the catalog; you
confirm; Claude authors and validates every artifact.

> **Read first**: `SWARM-QUALITY-FRAMEWORK.md` — the 5 swarm-mistake
> categories. Three of them (B no-composition-owner, C no-pattern-
> propagation, D drift accumulation) are prevented by reserving capacity
> for the three permanent meta-tracks below in every wave, not just at
> the end.

## Track naming

Every track has an id matching the convention defined in **Appendix D —
Track naming convention**. The eight type prefixes (`domain-`, `app-`,
`service-`, `contract-`, `meta-`, `foundation-`, `helper-`, `integration-`) make
the type self-describing without a registry lookup. Per-wave invocations
carry a wave prefix (`w1-domain-slots`). See Appendix D for the full
table + the `domain` vs `app` distinction explained.

## Track size guidance

**Foundation tracks (single concern, single layer): keep them whole.**
REQ-INV-* and REQ-INT-* style tracks (2-5 TDD pairs, one library)
reliably close in a single harness session.

**Capability tracks (`app-*` ship a complete vertical slice): consider
decomposing.** A `w<N>-app-<capability>` track that spans 5+ layers
(domain validator → application use-case → persistence → resolver →
AppModule wiring → integration test) typically needs 7-12 TDD pairs
across 3+ files per layer. The "explore phase" before authoring
(reading existing W1 substrate) consumes 5-10 min on its own; combined
with TDD execution overhead, these tracks frequently exceed a single
Claude Code harness session and lose state on container restart.

Two ways to handle this:

1. **Decompose** into per-layer sub-tracks:
   `w<N>-app-<capability>-domain` + `-app` + `-persistence` +
   `-resolver-and-wiring`. Domain produces types that downstream
   sub-tracks consume; sub-tracks within a capability run sequentially.
   The four capabilities still parallelize at the DAG layer. Adds DAG
   depth + audit cycles but each sub-track fits in a single session.

2. **Accept the slow path:** large tracks ship over multiple harness
   sessions, with the manager (or Captain) restarting the worker
   between sessions and the worker resuming from its already-pushed
   commits. This is feasible if the worker pushes every TDD pair (see
   Phase 6.4 "Recipe-lesson: workers push every TDD pair, never batch")
   so restarts don't lose work. Multiplies wall-clock by 3-5x but uses
   fewer agent-classes.

Match decomposition decisions to the engagement's wall-clock budget
vs. orchestration overhead trade-off.

## Three permanent meta-tracks (reserve capacity in every wave)

Alongside the capability tracks that deliver REQ-CAP-*.md work, every
wave's manifest should include three **meta-tracks** that run as
permanent residents of the swarm. They're not feature work; they're the
mechanism that keeps the engagement compose-able, gated, and propagated.

| Meta-track | What it owns | Per-wave deliverables |
|---|---|---|
| **`meta-compose`** | The composition root — wiring whatever capability tracks produced into the running application | Wire every new use case's adapter + provider into `apps/app/src/app.module.ts`; add a live-actions smoke that fires one mutation per new use case; re-run the app-module compose-time smoke after merge |
| **`meta-gate`** | The gate set — running all gates against post-merge trunk, authoring new gates as new patterns emerge | Run `pnpm typecheck && pnpm test` + `gate-check.sh` against trunk after each wave merges; author new mechanical gates per `USER-GUIDE.md` Appendix C; maintain the exemption registry (`stub-ledger.yaml` ledger discipline) |
| **`meta-propagate`** | The canonical-patterns registry — propagating proven patterns to sibling surfaces | Maintain `orchestration/CANONICAL-PATTERNS.md` (one entry per pattern: `id`, `introduced-in-wave`, `description`, `applies-to`, `reference-files`); at wave-N+1 planning, open propagation tracks for any pattern with `applies-to` not yet honored |

The manager spawns these three tracks **every wave**, alongside capability
tracks (counting against the `max_parallel_tracks: 4` cap unless your
broker has more capacity). The Wave-1 dispatch brief in this engagement
does NOT yet enumerate meta-compose / meta-gate / meta-propagate as separate
tracks — they're a future-wave addition; for Wave 1 the cap of 4
parallel tracks is filled by 2 impl + 1 audit.

Once a wave starts running these three meta-tracks, the manager's
exit-criterion for the wave becomes:

- All capability tracks `[complete:<id>]`
- meta-compose reports `[compose-clean]` — app boots, smoke fires
- meta-gate reports `[gate-clean]` — all gates green on trunk
- meta-propagate reports `[propagate-clean]` — no pending canonical patterns
- spec-adherence audit `verdict: approved`

## What Claude does

- Proposes a wave (default Wave 0 for first run; in this engagement,
  Wave 0 was skipped — see `orchestration/PHASE-2-CATALOG-DRIVEN-KICKOFF.md`)
  and a track set derived from the catalog plus the three meta-tracks above
- Authors every `track-meta/*.yaml`, fills in fields from the catalog and stack
- Validates prompt composition for every track; auto-fixes failures and re-validates
- Pre-renders composed prompts to `orchestration/prompts/composed/`
- Initializes `orchestration/status.md`
- Authors the wave kickoff brief at `orchestration/dispatch/<wave>-batch-<N>-kickoff.md`
- Writes a phase report at `orchestration/reports/phase-4-wave-<N>-batch-<M>-plan.md`

## What you decide

- Confirm or edit the proposed wave + track set
- Wave-specific recipe-lessons to bake into the kickoff brief (vs. methodology-wide ones that belong in the manager-kickoff template upstream)
- Approve the commit + tag

## Recommended: delegate the draft to a subagent

Like Phase 3, Phase 4 produces many files (one track-meta + one
composed prompt per track + the kickoff brief). For a typical 4-track
batch this is ~5000 lines of generated content. Delegate to a
subagent that:

1. Reads the catalog + service-PRD + Phase 3 outputs.
2. Proposes the track-set — surfaces to Captain via `AskUserQuestion`.
3. Drafts every `track-meta/<track-id>.yaml` per the confirmed set.
4. Runs `pnpm compose-prompts --track-meta <path> --validate-only` on each. Fixes drafts on failure.
5. Drafts the dispatch kickoff brief at `orchestration/dispatch/<wave>-batch-<N>-kickoff.md`.
6. Reports back: file list, validation output, judgment calls, items worth Captain review.

Captain reviews the report, applies any registry/rule-pack edits the
subagent flagged but couldn't make (per the don't-modify-out-of-scope
discipline), runs the actual `pnpm compose-prompts` (without
`--validate-only`) to render composed prompts, then commits + tags.

## Verify gate

- Every `track-meta/<track-id>.yaml` passes `prompt-composer --validate-only` (exit 0)
- `pnpm check-track-meta-paths` exits 0 (every deliverable falls under an agent class's `allowed_paths`)
- One composed prompt per track exists under `orchestration/prompts/composed/`
- Kickoff brief enumerates the same track set as the track-meta files (no drift)
- Phase report exists
- `tag wave-<N>-batch-<M>-bundle`

## Pointer-message dispatch (>40KB threshold)

Composed prompts above roughly 40-50KB risk silent message-truncation
in the scion container-delivery path. This is not a future-problem to
think about — it's the default for any non-trivial track today. An
early Captain shift dispatched W4 at 69KB and W5 at 128KB; both worked
only because their kickoff briefs explicitly required pointer-message
dispatch. Pasting the bodies inline would have lost work.

**The rule.** The kickoff brief must direct the manager to send each
worker a short pointer (~200 bytes) of the form:

> Read `orchestration/prompts/composed/<track-id>.md` for your full
> brief, then begin Phase 1 of your standard workflow.

The composed prompt itself lives on disk inside the worker's worktree
(it was committed as part of the handoff bundle in Phase 4 step 5).
The worker reads the file directly via the harness's `Read` tool —
no truncation, no transport limit, no prompt-engineering on the
manager's side to compress the brief.

**When the threshold is approached.** If `wc -c orchestration/prompts/composed/<track-id>.md`
is over 40KB, pointer-message is mandatory. If under 20KB, inline
paste is fine. In the 20-40KB band, default to pointer-message — the
overhead is one extra `Read` tool call per worker, which is invisible
in wall-clock; the risk of silent truncation in the inline path is not.

**Sanity-check.** After dispatch, confirm the worker actually read
the pointer's target by checking that its first commit references
the track-meta or REQ ids — a worker that received a truncated
prompt typically commits a no-op or a "where do I start?" probe.

## REQ precision: 30 minutes here saves hours of swarm churn

A track's REQ is what the worker AND both auditors see. If it is
loose enough to permit a lazy-half-implementation, the worker can
ship one and both auditors will approve it because each acceptance
criterion is satisfied in isolation. Integration gaps slip through.
An early Captain shift's W4 REQ asked for "HTTP transport +
AppModule wiring." The worker delivered exactly that — but did not
extend the resolver map to the four W2 capability resolvers
(Query.tickets, Query.ticket, Mutation.fileTicket, Mutation.transitionTicket)
because the REQ never said so. Audits passed in isolation; the
service's federation handshake worked but the capabilities were
unreachable. A whole follow-up wave (W5) was needed to close the
gap. Compare W5's REQ: explicit deliverable list, explicit
"resolver classes are NOT modified," explicit "the federation entity
dispatcher and Query.ticket are distinct read paths with distinct
projections" — wording chosen specifically to prevent the
auditor + worker from drifting into ambiguous territory.

**Rule of thumb when authoring a REQ or its track-meta.** Imagine an
auditor who reads ONLY the REQ. Could they catch a lazy-half-implementation?
If not, the criteria are too loose. Sharpen until they could.

Specific patterns that surface this:

- Name every "deliverable that looks like a bug but is actually the spec."
  If `subgraphTypeDefs()` is the canonical predicate name and a
  worker might call it `subgraphSdl()` instead, say so explicitly
  in the REQ's Technical Contract.
- Name every "lazy half" the worker might ship and call it
  out-of-spec. ("HTTP handshake without the four capability
  resolvers being reachable does NOT satisfy AC-3.")
- Name every "policy: do NOT modify X" that prevents a worker from
  helpfully rewriting code outside the track's scope.
- Bake any wave-specific recipe-lesson into the dispatch brief so
  the worker AND both auditors see the same trap call-out.

This 30-minute REQ sharpening pays off as ~3-6 hours saved across
the worker session + audit cycles + (in the worst case) a remedial
follow-up wave.

## The subagent prompt (`/effort max` recommended)

````
You are running Phase 4 (Wave planning) of the swarm setup.

MISSION: stage the complete handoff bundle the manager will consume
to run the next wave. Use max-effort reasoning.

CONTEXT TO READ FIRST:
- orchestration/HARDENED-SWARM-ORCHESTRATION-DESIGN.md (Wave 0/1/2/3+ structure)
- requirements/*.md (the catalog — which REQs the wave's tracks will deliver)
- orchestration/ledgers/agent-class-registry.yaml (from Phase 3)
- orchestration/gates/gates.json (from Phase 3)
- orchestration/track-meta/_template-track.yaml
- orchestration/_template-status.md

WORK:

1. Wave proposal: based on the catalog and the design doc, propose
   which wave we are running. Default for first run is Wave 0.
   Surface the proposal to me; PAUSE for my confirmation.

2. Track proposal: enumerate the tracks for this wave-batch. Cap at
   5–8 tracks per batch. For each, surface:
   - track_id
   - agent_class (from the registry)
   - one-sentence track summary
   - predecessors (likely [] for Wave 0)
   - REQ ids it delivers (or "process-only" if Wave 0/2)
   Surface the proposed track set to me; PAUSE for confirmation or edits.

3. Track-meta authoring: for each confirmed track, copy
   `_template-track.yaml` to `orchestration/track-meta/<track-id>.yaml`
   and fill in every field:
   - track_id, agent_class, phase, wave, batch
   - track_summary (2-4 sentences)
   - predecessors
   - subscribed_contracts (which contract-* contracts the track touches)
   - cross_cutting_packs
   - unblocks (e.g., [G.wave-0-process-hardening])
   - deliverables (file paths the worker will produce)
   - exit_criterion (what "done" looks like)
   - source_of_truth.req_ids
   - execution_mode: hub_mode

3.5. Re-import templates if `agent-class-registry.yaml` was edited.
   If this wave introduces a new `agent_class` (e.g. a frontend-specific
   variant added to `orchestration/ledgers/agent-class-registry.yaml`
   plus a new directory under `orchestration/scion-templates/`), the
   project won't have it yet and `scion create … -t <new-class>` will
   fail. Re-run Step 0.7's import with `--force`:

   ```
   scion templates import orchestration/scion-templates/ --all --force
   ```

   The captain-preflight Step 0.7 enumerates templates from disk
   dynamically — re-running `./tools/captain-preflight/check.sh` after
   the import flips the warning to `[ ok ]`.

4. Prompt composition validation: validate every in-scope track-meta is
   composable. Reference invocations:

   | Platform | Command |
   |---|---|
   | TypeScript / Node | `for tm in orchestration/track-meta/<wave>-*.yaml; do pnpm compose-prompts --track-meta "$tm" --validate-only; done` |

   On any failure, fix the track-meta or the underlying registry/rule-pack
   and re-validate. Loop until every track validates clean.

5. Pre-render composed prompts:

   | Platform | Command |
   |---|---|
   | TypeScript / Node | `mkdir -p orchestration/prompts/composed && for tm in orchestration/track-meta/<wave>-*.yaml; do pnpm compose-prompts --track-meta "$tm"; done` (writes `orchestration/prompts/composed/<track-id>.md`; idempotent) |

   Spot-check one rendered prompt to confirm placeholders resolved
   (no `{{worker_id}}` or `<TODO>` left in the output — those get filled
   in by the manager at spawn time with the actual container id).

6. Status board: copy `_template-status.md` to
   `orchestration/status.md` and fill the header (ISO timestamp,
   phase, wave, batch, current state = "handoff bundle staged").

7. Wave kickoff brief: author at
   `orchestration/dispatch/<wave>-batch-<N>-kickoff.md`. Include:
   - Tracks in this batch (same list from step 2)
   - Pre-composed prompt paths
   - Manager workflow (create + start + message + poll + audit + merge)
   - Hard rules (workers push only to their branch; manager messages
     workers; 3-cycle audit cap; UAT-in-env auth)
   - **Pointer-message dispatch directive**: "When sending a worker
     prompt that exceeds ~40KB, do NOT paste the body into `scion message`.
     Instead, send: `Read 'orchestration/prompts/composed/<track>.md'
     for your full brief, then begin Phase 1 of your standard workflow.`
     Composed prompts above the threshold risk message-truncation in the
     container delivery path; pointer-message dispatch is the default
     for any non-trivial track today." (See Phase 4 §"Pointer-message
     dispatch (>40KB threshold)" below for why.)
   - Status reporting expectation
   - Acknowledge-before-starting marker
   ASK ME for any wave-specific recipe-lessons to include before
   finalizing.

PHASE REPORT (write at end):
Path: `orchestration/reports/phase-4-wave-<N>-batch-<M>-plan.md`
Sections:
- Wave + track set (with rationale)
- Track-meta inventory (one row per track: id, agent_class, predecessors, deliverables)
- Composition validation results
- Kickoff brief path
- Open decisions I asked you about + your answers

WHEN DONE: list the handoff bundle file inventory and the proposed
commit message. Wait for my confirmation before any git operation.
````

## Commit boundary

After you've reviewed the phase report and the kickoff brief:

```bash
$ git add orchestration/track-meta/ orchestration/prompts/composed/ \
          orchestration/dispatch/ orchestration/status.md \
          orchestration/reports/
$ git commit -m "Phase 4: Wave <N> batch <M> handoff bundle staged"
$ git push origin <branch>   # workers will fetch from origin
$ git tag wave-<N>-batch-<M>-bundle
```

---

# Phase 5 — Handoff: boot the manager

You leave your Captain session here in a passive role. The manager
takes over execution.

## Step 5.-1 — Initialize a per-engagement project (one-time per repo)

**Architectural rule**: every engagement is its own project. Don't share a
project across projects.

A Scion **project** is the unit of isolation for agent names, secrets,
templates, permissions, and contributors. Two engagements sharing a
project will collide on agent names (every project tends to call its
manager `manager`), share each other's secrets, and tangle each other's
db state — we hit exactly these issues during this engagement's
bootstrap (the prior NestJS engagement's `manager` agent shadowed our
fresh one, the Hub db retained stale `applied_config`, and `scion delete
+ scion create` resurrected the old config from the soft-deleted record).

Run **once per engagement repo** before any `scion create`:

```bash
$ cd ~/projects/<your-service>
$ scion init
Initializing scion project project...
scion project successfully initialized.
Grove ID: <uuid>
Grove initialized. Link to Hub? (Y/n): Y
Created new project on Hub: <project-name> (ID: <uuid>)
```

After init:
- `.scion/` exists at the repo root (project state; contains `project-id`,
  `agents/`, `templates/`).
- A new project is registered on the Hub.
- Subsequent `scion create / list / start / message` commands operate
  against THIS project by default — **drop the `--global` flag** for
  Steps 5.0–5.5 once you've initialized a project.

### Grove-name gotcha

The project name on the Hub is auto-derived from your **GitHub remote**,
not your local directory name. If your repo is
`github.com/<org>/<remote-name>` and your local clone is at
`~/projects/<local-name>`, the project will be called `<remote-name>`.

Example from this engagement: local dir is `app`,
GitHub remote is `app`, project name is **`app`**.

Cross-reference via `project-id` (in `.scion/project-id`) for unambiguous
identification.

### Re-using an existing project

If a teammate has already initialized the project on the Hub and you're
cloning fresh, `scion init` will detect the existing remote project and
offer to link. Answer `Y` to the link prompt rather than registering a
new one.

If you accidentally use `--global` first and the Hub assigns the agent
to the **Global** project instead of the project, delete the agent
(`scion delete <name> --global`) before running `scion init` — or you
end up with a manager in Global and workers in the project, which
defeats the isolation.

## Step 5.0 — Configure + enable the Hub (one-time per laptop)

Phase-0.5b sets up the UAT but doesn't actually point the local CLI at a
Hub endpoint or flip the integration on. Two extra commands:

```bash
# Point at the local workstation-mode Hub (or your team's shared Hub URL)
$ scion config set hub.endpoint http://127.0.0.1:8080 --global

# Enable Hub-routed agent operations
$ scion hub enable --global
Endpoint: http://127.0.0.1:8080
Hub Status: healthy (version 0.1.0)
Agent operations (create, start, delete) will now be routed through the Hub.

# Confirm
$ scion hub status --global
Hub Integration Status
======================
Scope:      global
Enabled:    true
Endpoint:   http://127.0.0.1:8080
```

If `scion hub enable` errors with `Hub endpoint not configured`, the
`config set hub.endpoint` step is the fix.

If `scion hub status` reports `server unreachable`, start the local Scion
server first (workstation mode binds 127.0.0.1):

```bash
$ scion server start --foreground --enable-hub --enable-runtime-broker \
    --enable-web --dev-auth --auto-provide --host=127.0.0.1
# leave this process running in a dedicated terminal, OR
$ nohup scion server start --enable-hub --enable-runtime-broker \
    --enable-web --dev-auth --auto-provide --host=127.0.0.1 \
    > /tmp/scion-server.log 2>&1 &
```

## Step 5.0b — Link the existing project (one-time interactive)

The first time you run any Hub-aware command after enabling, Scion
detects existing projects on the Hub and asks which one to map to your
local CLI. Run `scion list --global` and answer the prompt with `1` to
link to the default `Global` project:

```bash
$ scion list --global
Found 1 existing project(s) with the name 'global' on the Hub:
  [1] Global (ID: ...)
  [2] Register as a new project (will be created as 'global-1')
Enter choice (or 'c' to cancel): 1
Linked to existing project: Global (ID: ...)
Broker registered: <your-machine> (ID: ...)
No active agents found in the current project.
```

This is a **one-time** pairing — subsequent `--global` commands skip the
prompt.

## Step 5.0c — Known Scion CLI gotchas (this version)

During this engagement's bootstrap we hit several Scion CLI / runtime
bugs that aren't documented upstream yet. Most have surgical
workarounds.

### Gotcha 0 (RESOLVED 2026-05-26): system-prompt shell-parse defect

**Symptom:** worker container starts, `sciontool init` runs the
`sh -c "tmux new-session -d -s scion -n agent claude --no-chrome
--dangerously-skip-permissions --system-prompt \"<full content of
the template's system-prompt.md>\" …"` invocation, and the inner
`sh` fails to parse the command. Container logs show:

```
sh: 1: Syntax error: word unexpected (expecting ")")
[sciontool] INFO: Child exited immediately with code 2
```

The `(` causing the error is in the system-prompt content — e.g.
the literal `(BYPASSRLS)` in `foundations-agent/system-prompt.md`,
or any backticks / dollar signs / parens in the markdown.

**Root cause:** scion's `pkg/runtime/common.go:390-399` builds the
tmux+claude shell command via `fmt.Sprintf("%q", a)` (Go-style
quoting, NOT shell-safe) AND
`strings.ContainsAny(a, " \t\n\"'$")` misses shell metacharacters
like `(`, `)`, backticks, `;`, `&`, `|`. System-prompt content with
those chars trips `sh: Syntax error: word unexpected`.

**Discovered:** 2026-05-26 by the Captain during Wave 0 dispatch
attempt (after fixing Gotcha 5 + Gotcha 6 below).

**Fix:** patch `pkg/runtime/common.go:390-399` to single-quote every
arg using the standard `'\''` trick. Inside single quotes, shell
preserves every character literally; the only special char is `'`
itself, which we escape with the closing-open-close pattern.

```go
// CURRENT (buggy):
var quotedArgs []string
for _, a := range harnessArgs {
    if strings.ContainsAny(a, " \t\n\"'$") {
        quotedArgs = append(quotedArgs, fmt.Sprintf("%q", a))
    } else {
        quotedArgs = append(quotedArgs, a)
    }
}
cmdLine := strings.Join(quotedArgs, " ")

// PATCHED (shell-safe):
var quotedArgs []string
for _, a := range harnessArgs {
    quotedArgs = append(quotedArgs, "'"+strings.ReplaceAll(a, "'", `'\''`)+"'")
}
cmdLine := strings.Join(quotedArgs, " ")
```

**Apply + rebuild:**

```bash
cd ~/projects/scion-ch
# Apply the patch above to pkg/runtime/common.go lines 390-399.
go build -o ./bin/scion ./cmd/scion
# Replace the user-installed scion binary. On macOS, prefer a
# symlink over `cp` — `cp` triggers com.apple.provenance tagging
# that can cause Gatekeeper to SIGKILL the binary on next exec
# (signal 137 exit code):
rm "$(which scion)"
ln -sf "$(pwd)/bin/scion" "$(which scion)"
scion server stop
scion server start
# Smoke-test:
scion create cr-probe -t <a-template> --harness claude -b main
scion start cr-probe   # should reach "Phase: running" without exit-2
scion delete cr-probe --yes
```

**Captain note:** this was applied at 2026-05-26 07:34 EDT during
the autonomous window's follow-up after user authorization.
Captain-side smoke test confirmed: worker container starts cleanly,
no shell-parse error. Wave 0 dispatch resumed immediately after.

**Tracking:** filed as a Captain-level escalation on 2026-05-26 (see
`orchestration/escalations/2026-05-26T05-08-30Z-w0-worker-auth-missing-anthropic-api-key.md`
§Resolution). When this is resolved, the entire 10-wave plan
unblocks.

### Gotcha 5 (RESOLVED): runtime broker rejects template `harness:` field

**Symptom:** `scion start <agent>` returns 500 from the broker:

```
runtime broker returned error 500: {"error":{"code":"runtime_error",
"message":"Failed to provision agent: template … : invalid template:
'harness' field is no longer supported in scion-agent.yaml. Remove
it and use --harness-config to specify the harness"}}
```

**Cause:** The runtime broker on this host was upgraded past the
schema revision that retired the inline `harness:` (and `image:` +
`auth_selectedType:`) fields in `scion-agent.yaml`. Templates
authored against the older schema still carry those fields.

**Fix:** strip the three deprecated lines from each
`orchestration/scion-templates/*/scion-agent.yaml`. The 6 templates
should be in the modern minimal shape:

```yaml
schema_version: "1"
description: "<one-liner>"
agent_instructions: agents.md
system_prompt: system-prompt.md
```

Then `scion templates import orchestration/scion-templates/ --all
--force` to re-import + `scion templates sync --all` to push to the
Hub. Then update manager-kickoff so workers spawn with
`scion create … --harness <named-config> …` (where
`<named-config>` is `claude` for the 5 Claude classes, `codex` for
code-review-codex) — per Step 0.6 + Step 0.7 above.

### Gotcha 6 (RESOLVED): worker container missing ANTHROPIC_API_KEY

**Symptom:** `scion start <claude-worker>` returns 500:

```
runtime broker returned error 500: {"error":{"code":"runtime_error",
"message":"Failed to start agent: auth resolution failed: claude:
no valid auth method found; set ANTHROPIC_API_KEY for direct API
access, …"}}
```

**Cause:** The `claude` harness-config's `api-key` auth type
declares `required_env: [{any_of: [ANTHROPIC_API_KEY]}]`. With the
default `as-needed` env injection mode, the broker only injects the
env var when the harness-config requests it — but the `as-needed`
flag may not propagate when the variable is also `--secret`.

**Fix:** set the env var with explicit `--always` at user OR project
scope:

```bash
$ scion hub env set ANTHROPIC_API_KEY=<value> --always --secret
# or project-scoped:
$ scion hub env set --project ANTHROPIC_API_KEY=<value> --always --secret
```

If `scion hub env get ANTHROPIC_API_KEY` still shows
`(as-needed, secret)` after the `--always` set, that's a CLI
cosmetic — the broker should inject correctly. Captain-side
smoke-test confirms whether injection works:

```bash
$ scion create cr-probe -t foundations-agent --harness claude -b main
$ scion start cr-probe
```

(If `scion start` proceeds past the auth-resolution step — even if
it hits Gotcha 0 downstream — the auth is fixed.)

### Gotcha 7: worker container missing codex credentials (CODEX_AUTH / OPENAI_API_KEY / CODEX_CONFIG)

**Symptom A:** `scion start <codex-worker>` returns 500 with:

```
runtime broker returned error 500: {"error":{"code":"runtime_error",
"message":"Failed to start agent: auth resolution failed: codex:
no valid auth method found; set CODEX_API_KEY or OPENAI_API_KEY,
or provide auth credentials at ~/.codex/auth.json"}}
```

**Symptom B:** codex worker spawns + audits clean, but the closure-report cross-model claim is wrong — the audit ran on `gpt-5.4 / medium` instead of the template's documented `gpt-5.5 / xhigh`. Visible in the codex agent's terminal banner (`scion look <codex-worker>` shows model line at startup) or in the verdict file's frontmatter `model:` field.

**Cause:** Same family as Gotcha 6 (Claude side) but for the Codex harness. Either (a) no `CODEX_API_KEY` / `OPENAI_API_KEY` env was registered on the broker, OR (b) no `CODEX_AUTH` file secret was registered, OR (c) credentials registered but no `CODEX_CONFIG` file secret to pin the model.

**Fix:** complete Step 0.4 §"Codex (OpenAI) credentials for the `code-review-codex` agent". Either Path A (API key) or Path B (OAuth file) PLUS the `CODEX_CONFIG` file secret. Verify with `scion hub env get OPENAI_API_KEY` / `scion hub secret list` at both `--user` and `--project` scope.

This is the third instance of the post-schema-bump credential-seed defect family (`worker-template-rejected`, `worker-auth-missing-anthropic-api-key`, `codex-auth-missing`). `tools/captain-preflight/` Step 0.9 — credential-matrix probe — catches this proactively.

### Gotcha 8: manager can talk to Hub but cannot spawn workers (dev-auth Hub + strict-JWS agent CLI)

**Symptom:** the manager container starts fine, pushes its `[manager-ready]` commit, then halts when it runs `scion create <track-id>` to spawn the first worker:

```
Using hub: http://host.containers.internal:8080
Error: authentication failed, login to hub with 'scion hub auth login'
```

With `--debug` or against `--project <name>`, the underlying error surfaces:

```
unauthorized: invalid agent token: failed to parse token:
go-jose/go-jose: compact JWS format must have three parts (status: 401)
```

The Captain's `scion list` from the laptop works fine. The same UAT used as a raw `Authorization: Bearer` header against the Hub HTTP API also works (`curl … /api/v1/agents` → 200).

**Cause.** The Hub's HTTP middleware has two parsers:
1. A **permissive** path for CLI/user calls — accepts dev-tokens, UATs, OAuth bearer tokens. Used by the Captain's CLI (`scion list`, `scion create`).
2. A **strict-JWS** path for agent self-identification (`SCION_CLI_MODE=agent`, set inside every spawned container).

The in-container scion CLI always hits path 2. It reads `~/.scion/scion-token` as a JWS-format agent identity token, regardless of what's actually in the file. In `--dev-auth` mode (Step 5.0's default workstation server invocation), the broker seeds `~/.scion/scion-token` with a `scion_dev_…` plain-string token instead of a JWS. Result: every `scion create / start / message` call from inside the manager fails at the JWS parse step, before any auth claim is examined.

**This is NOT a missing setup step on the Captain side.** Setting `SCION_HUB_TOKEN` env, copying the manager UAT into `~/.scion/scion-token`, unsetting `SCION_CLI_MODE` — none work. The strict-JWS path is invoked whenever the CLI detects an agent context (a `.scion/` dir in cwd, an in-container env, or other heuristics).

**Workarounds, in order of preference:**

1. **(Preferred when available) Restart the Hub server in production-auth mode.** Drop `--dev-auth` from the `scion server start` invocation:

   ```bash
   scion server stop
   scion server start --enable-hub --enable-runtime-broker \
       --enable-web --auto-provide --host=127.0.0.1
   ```

   In production-auth mode, the broker is supposed to mint a real JWS-format identity token at `scion start <agent>` time and inject it into the container before sciontool init reads it. **CAVEAT:** this hasn't been verified to work end-to-end with the workstation-mode Hub at the time of this writing — production-auth may require a real OIDC issuer, which the local server doesn't ship.

2. **Curl shim from the manager.** The manager's UAT (mounted at `/workspace/manager-pat` inside the container) authenticates fine via raw HTTP Bearer. Have the manager POST directly to `/api/v1/agents` to spawn workers:

   ```bash
   # Manager-side; replace <track-id>, <template>, <branch>, <git-url> as needed.
   curl -s -X POST \
     -H "Authorization: Bearer $(cat /workspace/manager-pat)" \
     -H "Content-Type: application/json" \
     -d '{"name":"<track-id>","template":"<template>","harness":"claude","branch":"swarm/<track-id>","gitClone":"<git-url>"}' \
     http://host.containers.internal:8080/api/v1/agents
   ```

   This bypasses the agent-mode CLI entirely. The manager-kickoff prompt would need a corresponding update so the manager prefers the curl shim over `scion create / start / message` until upstream fixes the dev-auth + agent-CLI gap. The trade-off: sciontool's own Hub channel (heartbeat, notifications) stays broken in dev-auth mode, so the manager has to poll `origin/swarm/<track-id>` for `[complete:<track-id>]` markers manually rather than receiving `--notify` events. (The Captain monitoring §6.1 already polls this way, so it's not a regression.)

3. **Fall back to `--no-hub` local-only mode.** Disables the entire Hub-routed coordination layer; not viable without rewriting the manager-kickoff workflow. Listed for completeness; do not use without scoping the rework.

**Diagnosis path:**
- `podman exec -u scion <manager-container> bash -c 'head -c 30 ~/.scion/scion-token'` — if it starts with `scion_dev_`, you're hitting this.
- `podman exec -u scion <manager-container> bash -c 'env | grep SCION_CLI_MODE'` — confirms agent-mode is set.
- `curl -H "Authorization: Bearer $(cat ~/.scion/manager-pat)" http://127.0.0.1:8080/api/v1/agents | jq .` from the Captain laptop — confirms the UAT itself works against the Hub HTTP API (rules out token-side issues).

**Filed escalations:** prior recurrences live at
`orchestration/escalations/2026-05-27T21-23-15Z-w1-hub-auth-failed.md` and
`orchestration/escalations/2026-05-28T19-02-30Z-w1-hub-auth-failed-recurrence.md`
in the `tickets-subgraph` engagement repo — both diagnose this exact failure shape from the manager-side perspective.

### Gotcha 1: `--workspace` is silently dropped

`scion create --workspace <path>` is documented as "Host path to mount as
`/workspace`" but in this Scion version the flag value never reaches the
Hub call — verified via `scion create --debug`, the workspace string is
absent from every log line in the create flow. The resulting
`scion-agent.json` has no `volumes` field, and the container falls back
to the project default layout described below.

**Workaround**: don't rely on `--workspace` for the manager. Instead,
manually pre-create the worktree (see Gotcha 2's workaround).

### Gotcha 2: `scion create -b <branch>` doesn't actually `git worktree add`

In project mode (after `scion init`), the agent's workspace dir
at `.scion/agents/<name>/workspace/` is supposed to be populated as a
git worktree on the branch specified by `-b`. In this Scion version, the
directory stays empty — `shouldCreateWorktree` either doesn't fire or
the worktree add silently no-ops.

**Workaround**: pre-create the worktree manually BEFORE `scion start`:

```bash
# After scion create (which provisions the agent dir but leaves workspace empty):
$ rmdir .scion/agents/<name>/workspace   # Scion creates the dir as empty
$ git worktree add --detach .scion/agents/<name>/workspace HEAD
# Now the dir contains your project files at the current HEAD.
$ scion start <name>
```

For workers spawned by the manager on a per-track branch, the manager
should follow the same pattern:

```bash
# Manager script (inside its container, for each track):
$ git worktree add /repo-root/.scion/agents/<track-id>/workspace -b swarm/<track-id>
$ scion start <track-id>
```

### Gotcha 9: Worker idle at welcome screen, all `scion message` calls silently drop

**Symptom:** `scion list` shows the worker `running` and the container is up, but `podman exec <container> tmux capture-pane -p -t scion` shows only the Claude Code "Welcome back!" / "Tips for getting started" TUI. `scion message <worker> "<prompt>"` returns "Message sent to agent X via Hub" but the message body never lands in the harness input.

**Cause:** The trust-dialog dismissal step from §Step 5.3 is required on every container start (not just initial spawn). Every `scion start <agent>` after an `Exited (0)` opens a fresh harness session at the welcome screen. Until the screen is dismissed via `scion message --raw <agent> $'\r'`, all subsequent prompt-bearing messages drop in the TUI layer. The Hub side reports success because the API call to the broker succeeded; the broker's notion of "message delivered" doesn't include "harness actually processed it."

**Fix:** ALWAYS run this two-step sequence immediately after any `scion start <agent>`:

```bash
scion message --raw <agent> $'\r'   # dismiss welcome screen
scion message <agent> "<prompt>"     # actual prompt
```

Same applies to the manager (after a Captain restart) and every worker (after a manager restart). The `manager-kickoff.md` §"Spawn ready workers" block bakes this in for the worker-spawn path; Captain-side restarts of the manager itself must follow the same pattern.

**Diagnostic:** if a worker has been "running" for >5 minutes with no commits to its `swarm/<track-id>` branch and no lines in `git log origin/swarm/<track-id> --since="10 min ago"`, run `podman exec <container> tmux capture-pane -p -t scion | tail -20`. If you see the welcome-screen ASCII art instead of tool-use output ("Reading", "Editing", "Bash"), this Gotcha applies.

**Real-world impact:** caused 4 W2 capability-track workers to sit idle at the welcome screen for ~44 minutes despite repeated re-dispatches; the prompts were "delivered" per Hub but the TUI never got them.

### Gotcha 10: Manager-container's git ref desync from origin produces phantom-defect escalations

**Symptom:** Manager files an escalation describing structural git state — "orphan main", "no merge-base", "divergent histories" — that doesn't match what the Captain sees from their laptop.

**Cause:** The manager-container's local copy of `refs/remotes/origin/<branch>` can drift from actual origin if the container was offline during a force-push or rebase, or if a `git fetch` failed silently (network blip during a Hub control-channel hiccup, see Gotcha 11). The manager's diagnosis is sharp but the underlying observation is stale.

**Fix:** Captain verifies state from their own clone before acting. If Captain's `git log` looks healthy, message the manager: `git fetch origin --force && git log --format='%H %s' origin/main | head -3`. The manager re-syncs and the "structural defect" disappears.

**Real-world example from this engagement:** manager filed `w1-merge-conflict-orphan-main` claiming Captain's autonomous patch commit was an orphan-root with no parents. Captain's clone showed `4df422c` properly parented at `95a8a700`. Captain's stage-merge ran cleanly using normal 3-way merge. Manager re-synced and the escalation became invalid.

### Gotcha 11: Hub control-channel hiccup causes simultaneous worker exits

**Symptom:** Multiple worker containers `Exited (0)` simultaneously (within seconds of each other). `scion logs <worker>` shows lines like `runtime broker error 502: control channel request failed: connection closed`.

**Cause:** The Hub-broker control channel had a transient connection failure; the broker disconnected from all agents at once when it lost contact with the Hub.

**Fix:** Just restart the affected workers. No structural action needed.

```bash
for w in <worker-ids>; do
  scion start "$w" --harness claude
  scion message --raw "$w" $'\r'    # see Gotcha 9
  scion message "$w" "<resume-prompt>"
done
```

If cascade exits become frequent (more than once per hour), check `scion server status` and consider restarting the local Scion server (preserve `SCION_DEV_BINARIES` env if patched binary in use).

### Gotcha 12: `scion list` heartbeat staleness ≠ container exit

**Symptom:** `scion list` shows a worker as "offline" or with a stale `Up X minutes` value, but the container is actually still running and making progress.

**Cause:** The heartbeat in `scion list` is the most-recent sciontool ping observed by the Hub. After a Hub control-channel hiccup (Gotcha 11) or transient network blip, the Hub's view of the worker can lag minutes behind reality even though the container never exited and the harness is still issuing tool calls.

**Fix:** Always cross-check via `podman ps --format "{{.Names}} {{.Status}}"` before assuming a worker is dead. If `podman ps` says the container is up, run `podman exec <container> tmux capture-pane -p -t scion | tail -20` to see the actual harness state. Restart only if `podman ps` itself shows `Exited`.

**Diagnostic shortcut:** the git-side signal — actual commits arriving on `origin/swarm/<track-id>` over a 5-10 min window — is more reliable than `scion list` for "is this worker doing real work?". A worker with a stale heartbeat that's still pushing commits doesn't need intervention.

### Gotcha 13: shared component library pinned to a different toolchain than the engagement root

**Symptom:** `pnpm -w typecheck` passes for every workspace package until the day you add a shared FE component library (e.g. `ui-components/`) to `pnpm-workspace.yaml`. Next typecheck fails with:

```
ui-components typecheck: tsconfig.app.json: error TS5023: Unknown compiler
option 'noUncheckedSideEffectImports'.
ui-components typecheck: Failed
```

…or `pnpm install` warns `Unsupported engine: wanted: {"node":"^22.19.0"} (current: {"node":"v20.20.2","pnpm":"9.15.9"})`.

**Cause:** The component library lives in a separate repo or was vendored from one and pins a NEWER toolchain than the engagement root — typically TypeScript ~5.7 (vs root 5.5.3), pnpm 10 (vs 9), or Node 22 (vs 20). When you add it to the workspace, `pnpm -r typecheck` runs *its* `tsc -b` against *its* tsconfig, which uses options the older TS rejects.

**Fix:** Don't add the library to `pnpm-workspace.yaml`. Have the consuming app reference it via `link:`:

```jsonc
// apps/web/package.json
{
  "dependencies": {
    "@your-org/ui": "link:../../ui-components"
  }
}
```

`link:` resolves the import without the recursive `pnpm` typecheck running inside the library. Document the cross-version skew in `pnpm-workspace.yaml` as a comment so future captains don't re-add it. Track unification (upgrade the engagement to match) as a Wave-N candidate.

**Don't** workaround by deleting the library's stricter tsconfig options — those are intentional in the upstream repo and you'll re-export the divergence next sync.

### Gotcha 14: Codex agent exits immediately with "No prompt provided" (non-interactive harness)

**Symptom:** `scion start w6-code-review-codex` succeeds, the container boots, but exits 0 within 1–2 seconds. Logs show `No prompt provided. Either specify one as an argument or pipe the prompt into stdin.` followed by `Child exited immediately with code 0`.

**Cause:** The codex harness is **non-interactive**. Its `command.base` runs `codex exec --sandbox danger-full-access ... -c model=gpt-5.5 -c model_reasoning_effort=xhigh`. Unlike Claude (which starts an interactive REPL and waits for `scion message`), `codex exec` expects a task as a positional argument. If none is provided, it prints the error and exits 0.

`scion message <codex-agent> "<prompt>"` does NOT work because by the time the Hub delivers the message, the `codex exec` process has already exited.

**Fix:** Pass the task as a positional argument to `scion start`:

```bash
scion create w6-code-review-codex -t code-review-codex --harness codex -b swarm/stage/w6-batch-1
scion start w6-code-review-codex "Read orchestration/prompts/composed/w6-code-review-codex.md for your full brief. Review the implementation against the REQ catalog. Write your verdict to orchestration/reviews/w6-code-review-codex.md and push it."
```

The `[task...]` positional argument on `scion start` is what the harness passes to `codex exec` as the prompt. This is documented in `scion start --help` but easy to miss.

**Rule of thumb:** Claude = `start` then `message`; Codex = `start "<task>"` (all-in-one).

**Discovered:** 2026-06-02 during Wave 6 dispatch. Codex exited 0 three times before the timing issue was identified.

### Gotcha 15: Ghost containers from other projects cause `podman exec` exit 125

**Symptom:** `scion look <agent>` returns CLI help text (not terminal output). `scion message <agent>` errors with `exit status 125`. The Hub reports the agent as `running` and heartbeat shows `working`, but you cannot inspect or interact with it. Newly-created agents are affected while older agents from the same session work fine.

**Cause:** Stale/exited containers from a DIFFERENT project (e.g. `users-subgraph--w6-spec-adherence`) remain in `podman ps -a`. The broker's container name resolution collides — when it tries to exec into `tickets-subgraph--w6-spec-adherence`, it may resolve to the wrong container ID from the ghost, or the ghost's presence causes a podman naming conflict that degrades the exec path.

**Fix:**
```bash
# Find and remove ghost containers from other projects
podman ps -a --format "{{.Names}} {{.Status}}" | grep -v "tickets-subgraph"
# Remove any stale containers from other projects
podman rm -f <ghost-container-name>
```

If the problem persists after removing ghosts, restart the scion server:
```bash
pkill -f "scion server"
sleep 2
nohup scion server start --enable-hub --enable-runtime-broker \
    --enable-web --dev-auth --auto-provide --host=127.0.0.1 \
    > /tmp/scion-server.log 2>&1 &
```

**Prevention:** Before starting a new wave, clean all stopped containers from other engagements: `podman ps -a --format "{{.Names}}" | grep -v "<your-project>" | xargs podman rm -f`

**Discovered:** 2026-06-02 during Wave 6. Ghost `users-subgraph--w6-spec-adherence` container (exited, "292 years ago") caused exec 125 on all newly-created tickets-subgraph agents.

### Gotcha 16: GITHUB_TOKEN in env but git push fails (credential helper not configured)

**Symptom:** Worker has `GITHUB_TOKEN` in its environment (`echo $GITHUB_TOKEN` shows a value) but `git push origin <branch>` fails with `fatal: Authentication failed` or prompts for username/password.

**Cause:** The scion container doesn't configure a git credential helper. Having the token in env doesn't mean git knows to use it — git still tries the default auth method (interactive prompt, which fails in a non-TTY container).

**Fix:** Workers must set the remote URL to embed the token:
```bash
git remote set-url origin https://x-access-token:${GITHUB_TOKEN}@github.com/<org>/<repo>.git
```

The manager should include this in every dispatch message and fix-batch sent to workers. Add it to the template system-prompt or agents.md for each agent class so workers always have it.

**Discovered:** 2026-06-02 during Wave 6 cycle 1. Workers completed code but couldn't push to origin despite having the token.

### Gotcha 17: Integration tests pass vacuously against a superuser DB role

**Symptom:** All tenant-isolation integration tests pass, but when you switch to a NOSUPERUSER role they fail (cross-tenant INSERT succeeds, cross-tenant SELECT returns rows it shouldn't). The tests were providing a false sense of security.

**Cause:** PostgreSQL superusers bypass Row Level Security even with `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. The `FORCE` keyword only applies RLS to the TABLE OWNER, not to superusers. If your `DATABASE_URL` connects as a superuser (check: `SELECT rolsuper FROM pg_roles WHERE rolname = current_user`), every RLS policy is a no-op.

**Fix:** Always use a non-superuser, non-bypassrls role for integration testing:
```sql
CREATE ROLE app_user LOGIN PASSWORD 'app_user'
  NOSUPERUSER NOBYPASSRLS CREATEDB;
GRANT ALL ON ALL TABLES IN SCHEMA public TO app_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO app_user;
GRANT CREATE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO app_user;
```

Register this role's connection string as `DATABASE_URL` on the Hub. Tests that fail under this role have a real RLS enforcement issue — do not switch back to superuser to silence them.

**Discovered:** 2026-06-02 during Wave 6 cycle 2. The manager proved it with a live test — cross-tenant INSERT + read leak on a fresh FORCE-RLS table using the `app` superuser role.

### Container filesystem convention (verified)

What you actually see inside a Scion container in this version:

| Path | What it is | Bind-mounted from |
|---|---|---|
| `/repo-root/` | Engagement repo root view | (composite of mounts below) |
| `/repo-root/.git` | Shared git database | `~/projects/<svc>/.git` on host |
| `/repo-root/.scion/agents/<name>/workspace` | This agent's isolated worktree | host's `.scion/agents/<name>/workspace` |
| `/home/scion/` | Agent's home dir | host's `~/.scion/project-configs/.../agents/<name>/home` |
| `/workspace/` | Empty dir (legacy convention — NOT used here) | (not bind-mounted) |
| Container CWD on launch | The agent's isolated worktree | (= `/repo-root/.scion/agents/<name>/workspace`) |

**Env vars Scion injects**:

```
SCION_AGENT_SLUG=<agent-name>
SCION_AGENT_NAME=<agent-name>
SCION_PROJECT=<project-name>
SCION_PROJECT_ID=<uuid>
SCION_HUB_ENDPOINT=http://host.containers.internal:<port>
SCION_TEMPLATE_NAME=default
SCION_HOST_GID=<host-gid>
SCION_KEEPID_UID=1000
```

Workers and the manager find each other by writing to the shared `.git`
(via `git push/fetch` over the `GITHUB_TOKEN` env from `~/.scion/secrets.env`)
and reading the bind-mounted state files at `/repo-root/.scion/`.

## Step 5.1 — Create the manager container

Scion treats every container as an "agent." The manager IS an agent — same
image as the workers, different prompt. Use `scion create <agent-name>
--harness <name>` (the `--harness` flag selects which harness image to
provision the container with; this engagement uses `claude` for all roles
per `agent-class-registry.yaml`).

```bash
$ scion create --global manager \
    --harness claude \
    --workspace ~/projects/<your-service> \
    -b main
Using hub: http://127.0.0.1:8080
Using default broker <your-machine>
Agent 'manager' created via Hub on broker <your-machine>.
Agent Slug: manager
Phase: created
Agent directory: ~/.scion/agents/manager

$ scion list --global
NAME     TEMPLATE  HARNESS-CFG  RUNTIME  GROVE   BROKER          PHASE    CONTAINER  LAST ACTIVITY
manager            claude       podman   Global  <your-machine>  created             -
```

**Why `--global`**: Every Hub-routed `scion` subcommand (`create`, `list`,
`start`, `logs`, `message`) requires either being inside an `scion init`-ed
project (a `.scion/` directory in your working tree) or passing `--global`
to use the system-wide project. The wave-1 dispatch uses `--global` per
the recipe-lessons accumulated to date.

If you have a `--image` override you want to apply (e.g. a pinned SHA tag),
pass `--image <fully-qualified-ref>` after `--harness`. Otherwise the
default `scion-claude:latest` from your local store (or registry
configured via `scion config set image_registry --global`) is used.

(verify) manager container exists in `Phase: created`.

## Step 5.2 — Start the manager

The manager needs `SCION_HUB_TOKEN` in its env to authenticate against
the Hub. Source it from the UAT you minted in Step 0.5b.

```bash
$ export SCION_HUB_TOKEN="$(cat ~/.scion/manager-pat)"
$ scion start manager --global
$ scion list --global | grep manager
manager  claude  Up
```

(verify) state is `Up`. If it fails, check `scion logs manager --global`.

Tip: stash the `export SCION_HUB_TOKEN=...` line in `~/.zshrc` /
`~/.bashrc` (or your shell secrets-loader) so you don't have to think
about it each session. The token file is mode 600 so disk exposure is
bounded.

### Step 5.2b — Smoke-test the manager's GitHub token before sending the kickoff brief

The manager pushes a `[manager-ready]` commit as its first action; if
its `GITHUB_TOKEN` lacks repo write-access, this fails silently from
the Captain's perspective and the manager spends ~5 minutes
re-diagnosing inside its container before stalling. Run this
smoke-test **before** sending Step 5.4:

```bash
# Inside the manager container (via scion exec / scion message).
# Adapt <owner>/<repo> to the engagement.
$ scion message manager 'curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/repos/<owner>/<repo>'
```

Expected: `200`. If `404`, the token can read `/user` but cannot see
the engagement repo — fix the token scope (Contents: Read+Write on
the specific repo) and `scion stop manager && scion start manager`
to pick up the new env. **Scion env vars are baked at agent-start
time and do NOT refresh live**, so a Hub-side secret update after
`scion start` requires a stop/start cycle.

(recipe-lesson)

## Step 5.3 — Dismiss any trust dialog (Scion-specific)

When the manager first boots, the Claude agent inside the container
may surface a "trust this workspace" dialog. Dismiss it programmatically:

```bash
$ scion message --raw manager --global $'\r'
```

This sends a carriage return; the dialog accepts and proceeds. Without
this, the manager session waits forever for input. (recipe-lesson)

**This step is required on every container start, not just first boot.**
Every `scion start <agent>` after an `Exited (0)` brings up a fresh
harness session that opens at the welcome screen. Until you dismiss it,
subsequent `scion message <agent> "..."` calls return Hub-success but
their bodies never reach the prompt input. The worker terminal will
show "Welcome back!" indefinitely. The manager spawn loop in §5.6 — and
any Captain-side restart — must run `scion message --raw <name> $'\r'`
immediately after every `scion start <name>` and before any
prompt-bearing message. See Troubleshooting → Gotcha 9 for the symptom
profile and diagnostic.

## Step 5.4 — Send the manager kickoff prompt

```bash
$ scion message manager "$(cat orchestration/prompts/manager-kickoff.md)"
```

The manager reads its system-prompt frame.

## Step 5.5 — Send the wave kickoff brief

```bash
$ scion message manager "$(cat orchestration/dispatch/w0-batch-1-kickoff.md)"
```

The manager acknowledges with `[manager-ready] <ISO>`. Poll for it:

```bash
$ git fetch origin
$ git log origin/main --since "5 min ago" --grep '\[manager-ready\]' --format='%h %s'
```

(verify) marker present. If not within 5 minutes, check `scion logs
manager` for errors.

## Step 5.6 — Manager is now driving the wave

You can step away from the keyboard. The manager will:

1. Read every track-meta in the batch
2. Compute the DAG; pick a track with all predecessors complete
3. `scion create <track-id> --harness claude --workspace <worktree-path> -b swarm/<track-id>`
4. `scion start <track-id>` (if not auto-started by `scion create`)
5. `scion message --raw <track-id> $'\r'` (dismiss trust dialog)
6. `scion message <track-id> "<composed prompt>"`

**The `--raw \r` dismissal is REQUIRED before every prompt-bearing
message, on every restart of an agent's container — not just initial
spawn.** Skipping it silently drops all subsequent `scion message`
deliveries. See Troubleshooting → Gotcha 9.
7. Poll `origin/swarm/<track-id>` for `[complete:<track-id>]` commits
8. On complete: continue down the DAG, eventually batch-complete
9. Spawn `spec-adherence-agent` as another scion worker
10. Read verdict; dispatch fixes if rejected; loop ≤ 3 cycles
11. Manually merge to staging branch; spawn `integration-coherence-agent`
12. On approved: run `orchestration/gates/gate-check.sh G.wave-0-process-hardening`
13. On gate green: merge staging to trunk; rerun gate-check on trunk
14. Write `orchestration/reports/w0-closure.md`
15. Update `orchestration/status.md` to `wave-0-batch-1: closed`

---

# Phase 6 — Captain monitoring (while the manager runs)

You're not idle; you're watching for trouble. Use **external /loop
polling** rather than `--notify` (recipe-lesson: `--notify` alone fails
when the manager is stuck).

## Captain authority boundaries (do not grab the keyboard)

Before reading the monitoring steps below, internalize the rule that
governs every Captain reflex during a wave: **all application code
goes through the swarm**. Stop-hook pressure ("the goal isn't met,
the wave hasn't closed") is not authorization to grab the keyboard.

**The split.**

| Authority | Surface |
|---|---|
| **Captain** | `tools/`, `docs/`, `.claude/`, `infra/`, `orchestration/dispatch/`, `requirements/` (REQ files), `orchestration/track-meta/` (track YAML), `orchestration/gates/gates.json` |
| **Swarm** | `apps/`, `libs/`, `clients/`, `migrations/`, and any application source |

The line: **scaffolding the swarm is Captain; authoring what the
swarm is meant to author is swarm.**

**Why grabbing the keyboard is tempting and why it is wrong.** When a
worker is stuck on what looks like a 30-minute edit and the swarm path
would take 3 hours, the obvious thing to do is open the file and fix
it. Don't. (a) It breaks the orchestration model the methodology
exists to validate. (b) It duplicates the manager's autonomous
restart-and-poll work — the manager already has authority and a plan.
(c) It makes the Captain a single point of failure: future Captains
can't reproduce the shortcut. (d) It defeats the audit cross-check
— there's no spec-adherence + code-review-codex verdict on
Captain-authored code, so the bug class the audits exist to catch
ships unreviewed.

An early Captain shift caught itself authoring
`apps/app/src/database/database.module.ts` directly under stop-hook
pressure. The user intervened ("wait are you coding yourself??") and
the rule crystallized: any new application work must be done through
the manager.

**Earlier "Captain-direct backstop" precedents do NOT generalize.**
The Phase 6.4 §"dual-track Captain backstop with a `general-purpose`
subagent" recipe and the Phase 7 §"Captain merge authority" carve-out
are narrow, named exceptions explicitly authorized at-the-time. The
default is always: through the swarm.

**The hook from Phase 0.8 is what enforces this when judgment is
fatigued.** If you find yourself reaching for `scion message <worker-slug>`
or directly editing `apps/` or `libs/`, and the Phase 0.8 PreToolUse
hook is what stops you — that's working as designed. Re-route through
the manager.

## Step 6.0 — Live dashboard (recommended)

The engagement ships a self-hosted Captain dashboard at `tools/swarm-dashboard/`. It renders a KPI strip + wave-grid + project burndown + gantt + tracks/activity 2-col + container snapshot + click-to-drill-down drawer, and layers Captain extensions on top (queue of decisions owed, stall detector, audit findings explorer, REQ coverage matrix, recipe lessons). One-time setup:

```bash
$ cd ~/projects/<your-service>/tools/swarm-dashboard
$ pnpm install
$ PORT=4318 pnpm serve > /tmp/captain-dash.log 2>&1 &
$ open http://127.0.0.1:4318/captain
```

Routes available once serving:

| Route | Purpose |
|---|---|
| `/` and `/captain` | Full dashboard (designer template + Captain extensions; default home) |
| `/legacy` | Original designer template, no Captain extensions |
| `/skeleton` | Lightweight dark-mode skeleton for debugging the per-section endpoints |
| `/api/captain/<section>` | JSON for individual sections (`hero`, `queue`, `stalls`, `timeline`, `activity`, `audits`, `workers`, `coverage`, `lessons`) |
| `/api/snapshot` | Full legacy JSON snapshot |
| `/api/invalidate` | Force re-read of all sections on next fetch |
| `/healthz` | Liveness |

Architecture notes:

- Legacy template HTML is cached server-side for 25s; Captain extensions lazy-load via `/api/captain/<section>` on page load + auto-refresh per section (hero 5s, workers 5s, queue 8s, audits 60s, lessons 120s).
- Cold load ~4–5s (first git-show of every track-meta + verdict file); warm load ~200ms.
- Press `R` in the page to force-refresh all Captain sections; `/` to focus the activity search.
- Auto-refresh meta tag refreshes the whole page every 30s; lazy-section polls happen between page refreshes.
- The data sources are READ-ONLY (git show against `origin/main` + audit branches + `scion list`). The dashboard cannot modify anything.

**Template setup**: the dashboard injects data into a designer-authored HTML template at `tools/swarm-dashboard/template/Phase-2 Swarm Dashboard.html`. If the file is missing (`Template not found at …` error on `pnpm render`), copy it from the design handoff folder into `tools/swarm-dashboard/template/`. The template is binary-equivalent across engagements — once you have a copy, save it somewhere durable for future engagements.

The dashboard is OPTIONAL — you can still run a Captain session purely on `/loop` polling (Step 6.1) and `scion look <agent>`. But the dashboard is the at-a-glance "what's going on" view: drill-down into individual audit findings, see the live activity stream interpreted, see which decisions you owe right now. Especially valuable during overnight autonomous windows when you check in periodically.

## Step 6.1 — Set up a polling loop

In your Captain session, kick off a `/loop` skill on an interval:

```
/loop 5m git fetch origin --quiet && \
        scion list && \
        git log origin/main --since "30 min ago" --format='%h %s' | head -20
```

This prints, every 5 minutes:

- Scion container states (manager + workers)
- Recent commits on your main branch
- (You'll see `[complete:<track-id>]` and `[fix-complete:<track-id>]`
  markers as they land)

## Step 6.2 — Read status.md periodically

```bash
$ git fetch origin
$ git show origin/main:orchestration/status.md | head -80
```

The manager updates this; it's your read-only window into the wave's
state. Look for:

- Current track running
- Audit cycle number
- Open escalations
- Recipe lessons being accumulated

## Step 6.3 — Watch for manager stalls

If the manager goes silent for > 30 minutes with no `status.md` update
or worker activity:

1. `scion logs manager --tail 100` — read the last log
2. If 401 / auth error: diagnose per the "Manager returned 401"
   troubleshooting hierarchy. With UAT in env this is rare; usually a
   missing/expired/revoked token or a Hub server down.
3. If hung on an unrelated reason: `scion message manager "Are you
   stalled? Reply with current state."`
4. If still stuck after another 10 minutes: stop and re-spawn from the
   last `status.md` snapshot

**`scion list` phase column is descriptive, not authoritative.** The
phase/state column shows container lifecycle + most-recent sciontool
heartbeat. A `running, executing, just now` worker may be making real
progress OR may be re-invoking a no-op tool in a loop OR may be sitting
at an unread welcome screen (Gotcha 9). To verify productive work, run
`podman exec <container> tmux capture-pane -p -t scion | tail -20`
directly. Look for tool-use output (`Reading`, `Editing`, `Bash(...)`),
task-list progression, or commit subjects. The git-side signal — actual
commits on `origin/swarm/<track-id>` — is the authoritative measure of
forward motion.

### Active monitoring beats passive polling — stall heuristics + responses

The /loop's stall detection only works if a Captain stays in the
loop interpreting the signal and nudging the manager. Auto-restarting
the manager is a sledgehammer; a checklist-style nudge is the right
tool 80% of the time. An early Captain shift's W4 manager stalled
twice — once after audit verdicts on the merge step, once on the
staging→main step. Both unblocked within minutes after a Captain-side
nudge of the form `scion message manager "Captain check-in: both
audits APPROVED 15m ago. Please proceed with merge..."`.

| Heuristic | What it says | Right response |
|---|---|---|
| Both audits APPROVED for 15+ min, no merge commits | Manager hasn't picked up the post-audit merge step | Nudge: `scion message manager "Captain check-in: both audits APPROVED at <ts>; please proceed with stage-merge per kickoff brief."` |
| Stage-merge complete for 15+ min, no `[wave-N-batch-M-closed]` tag | Manager hasn't promoted staging→main | Nudge: `scion message manager "Captain check-in: stage-merge complete at <sha>; please run gate-check on trunk and tag the wave."` |
| Worker `[complete:<id>]` for 30+ min, no spec-adherence dispatch | Manager hasn't spawned the audit | Nudge: `scion message manager "Worker <id> completed at <ts>; please spawn spec-adherence + code-review-codex now."` |
| Manager log silent for 30+ min, no status.md update | Manager genuinely stuck / harness exited | Read logs (Step 6.3 above); restart only if logs confirm exit — see "Last resort" in Troubleshooting → Manager 401. |
| Same escalation pattern fires 3+ times AND fixes don't work | Genuine deadlock | File Captain meta-escalation and IDLE — but verify forward motion first (per Step 6.5 §recurrence). |

**The discipline: nudge before restart.** A nudge costs ~30 seconds
and preserves the manager's in-context state. A restart costs ~5
minutes (re-read kickoff brief, re-fetch origin, re-poll workers) and
flushes the manager's working memory of in-flight cycles. Reach for
nudge first; reach for restart only when a nudge has been tried + 10
minutes have elapsed + logs confirm no progress.

## Step 6.4 — Watch for worker stalls

Workers can stall too. Symptoms:

- Container `Up` for hours but no commits on its branch
- `scion logs <worker> --tail 50` shows no recent activity

Manager handles most worker stalls (it has the dispatch/restart
authority). Only intervene if the manager itself is unable to:

1. Read manager's logs to see if it's already noticed the stall
2. If not: send a message via manager — "the w0-typecheck-baseline
   worker has been Up 6 hours with no commits; please investigate"
3. If manager isn't responding: see Step 6.3

**Recipe-lesson: workers push every TDD pair, never batch.** Claude
Code harness sessions end periodically — after ~5-30 min of work or on
API socket close. The worker's container then `Exited (0)`. If the
worker authored multiple TDD pairs locally (`git commit`) but didn't
push them to origin between commits, the unpushed work may be lost on
the next `scion start` (the bind-mounted workspace state is sometimes
reset). Workers must push every TDD pair to their `swarm/<track-id>`
branch immediately, not batch a whole track and push at the end:

```bash
git push https://x-access-token:$GITHUB_TOKEN@github.com/<owner>/<repo>.git \
    HEAD:refs/heads/swarm/<track-id>
```

The composed worker prompt should explicitly instruct push-every-pair;
the manager should re-emphasize this when restarting a worker via
`scion message <worker> "Resume — push every TDD pair as you go, don't
batch."`. A stalled worker whose `git log` shows local commits absent
from `origin/swarm/<track-id>` is the signature of a batched push that
got cut off mid-track.

**Recipe-lesson: `--depth=1` shallow clone forces re-explore on every
restart.** Workers re-clone the repo with `--depth=1` on every `scion
start`. Consequences:

- Workers cannot see prior `swarm/*` commits without an explicit `git
  fetch origin swarm/<branch>` + `git checkout swarm/<branch>` step
- Each session loses local working state; only origin-pushed commits
  survive
- Pointer-prompts MUST instruct workers to `git fetch origin
  swarm/<branch> && git checkout swarm/<branch>` before they read the
  composed prompt or start TDD work

Workers that can't see their own prior commits restart their TDD plan
from scratch and waste ~5-10 min per restart re-exploring the substrate.
Bake the fetch-then-checkout step into both the manager kickoff brief
and the per-worker pointer-prompt template.

**Recipe-lesson: per-pair worker churn rate (capacity planning).**
Empirical numbers from this engagement on capability tracks:

- Each TDD pair takes a worker ~10-20 min (test-fail commit + impl-pass
  commit + push for both)
- A track with 8 acceptance criteria → ~1.5-2.5 hours if the worker
  doesn't exit; 2-4 hours if the worker exits and restarts 2-3x
- Workers tend to exit after every ~1-2 successful pairs OR after long
  deep-think cycles (~15-20 min of harness silence)
- Restart loop wall-clock: worker exit → manager/Captain restart → ~30s
  container init → `scion message --raw <agent> $'\r'` → pointer-prompt
  → ~5 min worker re-explore → next pair

A 4-track wave realistically takes 3-5 hours wall-clock if workers are
healthy. A manager-only restart loop on a 10-min poll cycle is too slow
during active waves; the Captain should restart workers within 1-2 min
of exit when commits are flowing.

**Recipe-lesson: dual-track Captain backstop with a `general-purpose`
subagent.** When a worker container is stuck (no commits in 15+ min)
but its TUI shows visible TODO progress, spawn a Captain-side
`general-purpose` subagent in the background and let it race the
worker. The subagent reliably outpaces a stuck worker because it runs
on the Captain's host with full repo state and no harness-restart tax.

The subagent prompt should include:

- Pointer to the track-meta + composed prompt + REQ doc
- Instructions to `git checkout origin/swarm/<branch>`, write TDD
  pairs, push every pair to `origin/swarm/<branch>`
- Reference to existing completed tracks (e.g. the file-ticket pattern)
  for guidance on naming + commit subjects
- Final step: push the `[complete:<branch>]` verdict commit so the
  manager-side gate logic recognizes the track as done

Whichever finishes first lands the marker. On this engagement, the
backstop subagent took ~30 min for `view-ticket` (6 pairs + complete
marker) where the in-container worker had been stalled ~45 min.

**Trade-off:** the subagent runs locally and doesn't go through Hub
heartbeat — it's slightly outside the swarm orchestration model and
won't show up in `scion list`. Use it as a backstop, not as a
replacement for healthy worker containers. Document its use in
`status.md` so the manager knows the marker came from a Captain-side
push, not a worker session.

**Recipe-lesson: pre-existing local commits on the Captain's host.**
When taking over a Captain shift, immediately check for local-only
commits on the host's checkout before assuming origin is the source of
truth:

```bash
$ git status                                          # uncommitted work
$ git log origin/swarm/<branch>..HEAD                 # unpushed commits
```

A prior Captain or manager may have done TDD work locally that never
reached origin. Real example from this engagement: `transition-ticket`
had 4 unpushed commits on the host's checkout that I had to push
manually before the manager would even see them. Always sync local →
origin before assuming the in-container worker is at a lower commit
count than the host.

## Step 6.5 — Watch for escalations

The manager files escalations to
`orchestration/escalations/<ISO>-<id>.md` when it can't decide
unilaterally. These need Captain response:

```bash
$ git fetch origin
$ git log --since "1 hour ago" --diff-filter=A --name-only --format='' | \
    grep '^orchestration/escalations/' | sort -u
```

For each new escalation:

1. Read it: `git show origin/...:orchestration/escalations/<file>`
2. Decide: pick an option or write a new one in the "Captain decision"
   block
3. Reply: `scion message manager "Escalation <id> resolved: <decision>. Continue."`

**Verify the manager's git observations from the Captain clone.** When
the manager files an escalation citing structural git state (orphan
refs, missing parents, divergent histories), don't act on the
manager's recommended fix until you've verified the same observation
from your own laptop's clone. The manager-container's
`origin/<branch>` ref can drift from actual origin if it was offline
during a force-push, or if `git fetch` failed silently. A `git fetch
origin` inside the manager container often resolves what looked like a
structural defect. See Troubleshooting → Gotcha 10 for the full
diagnostic.

Diagnostic: in your Captain shell, `git log --reverse --format='%H %s'
origin/main | head -3` and `git merge-base origin/main
origin/swarm/<some-branch>`. If your view differs from the manager's
escalation, the manager's container ref is stale — message it `git
fetch origin && git log --format='%H' origin/main | head -1` and
compare to your view.

**Recipe-lesson: don't skip audits "because the worker's tests are
green."** The cross-model audit (`spec-adherence-agent` on Claude +
`code-review-codex` on OpenAI gpt-5.5) catches REAL bugs, not just
style nits. An early Captain shift's W4 cross-model audit caught a
REQ predicate misnaming — `subgraphTypeDefs()` vs `subgraphSdl()` —
exactly the kind of subtle drift that escapes spec-author + worker
but two cross-model auditors catch via different vantages. The two
audit cycles cost ~20 min wall-clock; the bug would have shipped
without them. The Phase 0.4 §"Codex (OpenAI) credentials" step exists
specifically to keep this two-vantage merge rule in force; the
fallback policy there ("substitute a second Claude Opus 4.7 reviewer
running the codex prompt against the codex rule-pack") preserves the
two-vantage requirement when codex itself is unavailable. Don't
collapse it to a single-vantage audit because the worker's tests
look green.

**Recipe-lesson: recurrence guidance is a soft signal, not a hard
stop.** The manager-kickoff rule "if the same escalation pattern fires
3+ times AND your fixes aren't working, file a Captain-level
meta-escalation and IDLE" sounds clean but is easy to mis-trigger. On
this engagement, a Captain-v2 meta-escalation was filed at 16:25Z
prematurely — workers were genuinely making progress, just slowly,
because each TDD pair takes 10-20 min on capability tracks (see Phase
6.4 per-pair churn rate).

Before filing a meta-escalation, verify *forward motion* — not just
status-label repetition:

1. Compare ahead-counts (`git rev-list --count
   origin/main..origin/swarm/<branch>`) across at least 3 polling
   loops, not 1
2. `scion look <worker>` (or `podman exec ... tmux capture-pane`) to
   confirm the TUI shows active token usage —
   "Evaporating/Marinating/Sock-hopping" is Claude Code's animated
   working indicator, not a deadlock symptom
3. Distinguish "workers exit before pushing" (real stall, file
   meta-escalation) from "workers think for 15 min then push" (slow
   but progressing, do not file)

A pattern that mimics deadlock isn't deadlock if commit counts are
advancing across 30-min windows. When in doubt, cross-check the git
side first.

---

# Phase 7 — Wave closure (Captain session)

Manager signals completion by writing to `orchestration/reports/w<N>-closure.md`
and updating `status.md` to `wave-<N>-batch-<M>: closed`.

## Step 7.1 — Pull the latest state

```bash
$ cd ~/projects/<your-service>
$ git fetch origin
$ git checkout main
$ git pull
```

## Step 7.2 — Read the closure report

```bash
$ cat orchestration/reports/w0-closure.md
```

Confirm:

- REQs closed (typically none for w0)
- Tracks completed with shas
- Commands run with exit codes
- Baseline deltas
- Recipe-lessons for next wave

The closure report is the manager's account of what happened. It is
NOT the verification that the service does what its SDL / contracts
claim — that's Step 7.3.5 below. Read the report, then verify
against running code.

## Step 7.3 — Verify trunk state

```bash
$ git log main --oneline -10
$ orchestration/gates/gate-check.sh G.wave-0-process-hardening
# exit 0 expected
```

(verify) gate-check passes on trunk. If not, the manager merged in a
broken state — file an escalation and roll back.

## Step 7.3.5 — Verify against running code, not against the tag

A green wave-closed tag tells you the gates passed. It does NOT tell
you the service does what its SDL / contracts / acceptance criteria
say it does. An early Captain shift was asked "does the service
work?" and reported W4 closed (true) by reading the tag. When the
Captain then actually built and booted the worker branch and probed
it, the four W2 capability resolvers (Query.tickets, Query.ticket,
Mutation.fileTicket, Mutation.transitionTicket) were NOT wired into
the schema — a real W4-worker-scope-gap that the audits had missed
because the worker's tests asserted byte-equal SDL but did not assert
"every declared field has a resolver in the map." Memory + tag said
"Wave 4 done"; reality said "federation handshake done, capabilities
not reachable."

**The discipline.** Every wave closure includes a boot-and-probe
against the running service — not a re-read of the closure report.
Run the Phase 9 verification suite (`pnpm typecheck && pnpm test`,
`rover supergraph compose`, `pnpm --filter app start` + `curl /health`,
+ wave-specific probes per the Phase 9 milestone table). For a
graphql/federation service, additionally probe the live SDL and run a
real query for every capability the wave was supposed to ship:

```bash
# Boot the service from the closed wave's main:
pnpm --filter app start > /tmp/app.log 2>&1 &
APP_PID=$!
sleep 15

# Probe the SDL contains every capability the wave promised:
curl -s -X POST -H 'content-type: application/json' \
  -d '{"query":"{ __schema { queryType { fields { name } } mutationType { fields { name } } } }"}' \
  http://localhost:3000/graphql | jq

# Fire one real query per capability the wave shipped (the kickoff
# brief should enumerate the expected probe set; if it doesn't, that's
# a Phase 4 REQ-precision gap — see Phase 4 §"REQ precision").
curl -s -X POST -H 'content-type: application/json' \
  -d '{"query":"<wave-specific probe>"}' \
  http://localhost:3000/graphql | jq

kill $APP_PID
```

If a probe fails — capability declared but unreachable, mutation
returns "not implemented," resolver missing — that is a worker-scope
gap for a remedial wave. Tag-only closure is the failure mode this
step exists to catch.

## When the manager halts on a stage-merge: Captain merge authority

The manager's worker-spawn flow is the cheapest way to do anything
inside the swarm, but the Captain has direct git access to the
engagement repo and can run a stage-merge faster than authoring a
fix-track when the manager halts mid-merge. This is appropriate when:

- All worker tracks are `[complete:<id>]` and audit verdicts are
  `approved`
- Manager files an escalation on a merge-blocked condition
- Captain has verified the merge-blocked claim from their own clone
  (per Troubleshooting → Gotcha 10)

The Captain merge sequence:

```bash
# 1. Sync local main
git fetch origin && git checkout main && git pull --ff-only

# 2. Stage branch
git checkout -b swarm/stage/w<N>-batch-<M> origin/main

# 3. Merge worker branches in DAG order, resolving textual-additive
#    conflicts (barrel files, app.module imports) by union; treat all
#    other conflicts as findings (file an escalation).
for t in <track-ids-in-DAG-order>; do
    git merge origin/swarm/$t --no-edit
    # resolve any conflicts; git commit
done

# 4. Build dist/ for workspace packages (typecheck depends on .d.ts files)
pnpm -r --filter './libs/*' --filter './contracts' build

# 5. Run gate-check
./orchestration/gates/gate-check.sh G.wave-<N>-<gate-name>

# 6. If gate-check passes, merge to main and re-run on trunk
git checkout main && git merge swarm/stage/w<N>-batch-<M> --no-edit
./orchestration/gates/gate-check.sh G.wave-<N>-<gate-name>

# 7. Tag + push
git tag wave-<N>-batch-<M>-closed
git push origin main && git push --tags origin

# 8. Author closure report
# write orchestration/reports/w<N>-closure.md
# update orchestration/status.md
# commit + push
```

Use this when the manager has halted on a misdiagnosed structural
condition (Gotcha 10) or any other escalation where the Captain can
reach `gate-check passes` faster than re-dispatching workers. The
closure report should document that Captain executed the merge and
why (which escalation halted the manager).

## Step 7.4 — Sign off or reject

(decision) Did the wave meet your bar?

- **Yes** — tag the wave: `git tag wave-0-batch-1-closed`.
- **No** — file findings in `orchestration/escalations/<ISO>-w0-batch-1-rejected.md`,
  send to manager via `scion message`, manager addresses in a follow-up batch.

## Step 7.5 — Tear down the wave's worker containers (optional)

The manager keeps workers around in case of dispatched fixes. After
closure, they can be removed:

```bash
$ scion list | grep -E '^w0-'
$ for w in $(scion list --quiet | grep -E '^w0-'); do
    scion stop "$w"
    scion rm "$w"
  done
```

Leave the manager `Up` if you're planning the next batch immediately;
stop it otherwise:

```bash
$ scion stop manager   # idle the manager between waves
```

---

# Phase 8 — Next wave

Loop back to Phase 4. For each subsequent wave:

1. Plan the wave (track-meta YAMLs)
2. Validate prompt composition
3. Pre-render prompts
4. Update status.md to new wave/batch
5. Author wave kickoff brief
6. Stage the handoff bundle (commit + push)
7. Start the manager (or re-use the stopped one)
8. Send kickoff
9. Monitor
10. Close

Repeat through Wave 1 (spec normalization), Wave 2 (platform health),
Wave 3+ (capability waves).

---

# Captain daily / per-wave cadence

## Daily (during a running wave)

- Pull `origin/main` and read `status.md`.
- Check `orchestration/escalations/` for new entries; respond.
- Check `scion list` for unhealthy containers.
- Look at `orchestration/reviews/` for new audit verdicts.

## Per wave

- Sign off on closure report before next wave.
- Update `orchestration/baselines/trunk-health.yaml` if new baselines
  were accepted.

## Per fortnight

- PM + tech owner curate new / revised REQs.
- Re-run spec-curator-agent (or its mechanical replacement
  `tools/req-lint/`) on the catalog.

## Per quarter

- Review baselines: still owned? expiry passed?
- Review stub-ledger: same.
- Review pain-points / risk-register / open-questions.

---

# Troubleshooting

## "Manager won't accept the kickoff message"

Likely the trust dialog wasn't dismissed. Run:

```bash
$ scion message --raw manager --global $'\r'
$ scion message manager "$(cat orchestration/dispatch/w0-batch-1-kickoff.md)"
```

## "Manager returned 401 from the Hub"

With a UAT in env this should be rare. Diagnose in order:

1. **Check `SCION_HUB_TOKEN` is set in the manager's env**:

   ```bash
   $ scion exec manager env | grep SCION_HUB_TOKEN
   ```

   If empty, the manager was started without the token. Stop it,
   export the token, restart:

   ```bash
   $ scion stop manager
   $ export SCION_HUB_TOKEN="$(cat ~/.scion/manager-pat)"
   $ scion start manager
   $ scion message --raw manager --global $'\r'
   $ scion message manager "Resume from current state in orchestration/status.md."
   ```

2. **Check the token isn't expired or revoked**:

   ```bash
   $ scion hub token list
   ```

   If expired (rare — 1y default), re-mint per Step 0.5b. If revoked,
   mint a fresh one.

3. **Check the Hub server is up**:

   ```bash
   $ scion hub status --global
   Hub Integration Status
   ======================
   Scope:      global
   Enabled:    true
   Endpoint:   <your-hub-endpoint>
   ```

   If `Connection: failed`, restart the Hub server before the manager
   (`scion server start --foreground --enable-hub --enable-runtime-broker
   --enable-web ...`).

4. **Last resort — container restart**. With UAT in env this used to
   be the daily fix; it's now applicable only when the manager itself
   has gotten into a stuck state unrelated to auth:

   ```bash
   $ scion stop manager && scion start manager
   $ scion message --raw manager --global $'\r'
   $ scion message manager "Resume from current state in orchestration/status.md."
   ```

## "Worker stuck at the same spec-adherence finding 3 cycles"

Either the worker is misreading the predicate, or the predicate is
ambiguous. Captain decision:

1. Pause: `scion stop <worker>`
2. Read the predicate yourself. Can you assert it unambiguously?
3. If yes: rewrite the dispatch with concrete guidance; send to manager
4. If no: mark the predicate as `catalog_defect`; route to spec-curator;
   PM + tech owner clarify; predicate gets updated in the catalog

## "Manager merged staging to trunk but trunk gate-check fails"

Trunk diverged from staging due to concurrent merges. The hardened
design doc anticipates this (§"End-to-End Flow §10"). Manager should
re-enter integration staging. If it doesn't on its own:

```bash
$ scion message manager "Trunk gate-check failed post-merge. Re-enter
integration staging per design doc §End-to-End Flow §10."
```

## "I want to abort a wave mid-flight"

1. `scion message manager "Abort wave 0 batch 1. Stop spawning new
   workers; let in-flight workers complete; do not merge staging."`
2. Wait for manager acknowledgement.
3. Discard the staging branch (only if NOT merged to trunk):
   `git branch -D swarm/stage/w0-batch-1`
4. Document in `orchestration/escalations/<ISO>-w0-batch-1-aborted.md`.

## "External polling shows no progress for 1 hour"

In order:

1. `scion list` — are containers up?
2. `scion logs manager --tail 50` — is the manager alive?
3. `git fetch origin` — has anything pushed?
4. `cat orchestration/status.md` — does it show `running` somewhere?

If all four say "yes, alive" but no progress, message the manager
asking for a state dump. If 1-3 are negative, restart per the relevant
troubleshooting entry.

## "Worker pushed but manager didn't notice"

`--notify` alone is unreliable. Confirm the polling loop is running on
the Captain side and that the manager's own polling cadence (per the
manager-kickoff prompt) is ≤ 10 minutes. If both are running and the
push truly went unnoticed, send the manager an explicit nudge:

```bash
$ scion message manager "swarm/<track-id> shows [complete:<track-id>]
at <sha>. Please process."
```

---

# Phase 9 — Goal 1 verification suite

Once Wave 1 closes (Phase 7), and again at any point you want to assert
that the engagement is healthy, run the six-check verification suite
against the engagement repo. Each check is a concrete command with a
predictable output. Run from `~/projects/<your-service>`.

The checks intentionally span the full vertical: catalog → build → tests
→ federation → contracts → events → runtime. A clean run means the
swarm's produced state actually composes into a service.

> **Cross-link to Phase 7.3.5.** This suite is also the substrate for
> the per-wave boot-and-probe in Step 7.3.5. The "did the wave actually
> work?" question is answered by running the suite, not by reading the
> closure report. A green tag + a passing Phase 9 run is the joint
> condition for a wave being legitimately closed.

### Check 1 — `build`

```bash
$ pnpm typecheck && pnpm req-lint && pnpm check-track-meta-paths
```

**Expected** (after Wave 1 closes):

```
> tsc --noEmit  (every package)
> req-lint: catalog OK (N files)
> check-track-meta-paths: track-meta paths OK (M files)

✓ all checks passed
```

**Expected on a freshly-cloned engagement repo with no waves run yet:**
identical to above, since these checks exercise catalog +
track-meta gates + TypeScript compile against the bootstrap
scaffolding. **If it fails, the catalog or track-metas have drifted —
fix before proceeding.**

### Check 2 — `test`

```bash
$ pnpm test
```

**Expected before any wave has run:** vitest reports no test files
matched (exit 0 — an empty test suite passes vacuously).

**Expected after Wave 1 closes:** every `@req`/`@criterion`-tagged
vitest test for the wave's REQs runs and passes. Manager refuses to
merge a wave whose `[complete:<track-id>]` branch fails this check.

### Check 3 — `federation compose`

```bash
$ rover supergraph compose --config supergraph.yaml
```

**Expected before any wave has run:** `supergraph.yaml` does not exist;
`rover supergraph compose` exits non-zero with
`error: file 'supergraph.yaml' not found`. This is the **gap signal**
that the API track (`foundation-federation` + the resolver-bearing app tracks) hasn't
run yet.

**Expected after the federation track closes:** rover produces a
fully-composed supergraph SDL on stdout (or to the file named in the
config). Failure indicates SDL drift between subgraphs.

### Check 4 — `Pact`

```bash
$ pnpm test --filter "*pact*"
```

**Expected before any wave has run:** vitest reports no test files
matched. Exit 0 (vacuous).

**Expected after the integration tracks close** (Wave 9 ships REQ-INT-*
Pact contracts): the Pact verifier runs against each tagged contract;
exit 0 only when every consumer's expected interactions match the
provider's actual responses.

### Check 5 — `event verify`

```bash
$ pnpm test --filter "*event*" --filter "*outbox*"
```

**Expected before any wave has run:** vitest reports no test files
matched. Exit 0 (vacuous).

**Expected after foundation-event-bus + the first capability that emits events**
(`REQ-CAP-MANAGE-SLOTS` emits `SlotMaterialized` etc.): each emitted
event's contract is exercised against `orchestration/contracts/events/schemas/<EventName>.json`.
Exit 0 only when every emission matches the schema and the outbox
transaction discipline holds.

### Check 6 — `healthcheck`

```bash
$ pnpm --filter app start &
$ APP_PID=$!
$ sleep 15   # NestJS cold start
$ curl -fsS http://localhost:3000/health
{"status":"UP"}
$ kill $APP_PID
```

**Expected before any wave has run:** `pnpm --filter app start`
may fail because the NestJS `AppModule` isn't wired against a Drizzle
DataSource yet — the slot service is the first track that brings up the
Postgres layer. If start succeeds but `/health` returns 404, the
`HealthController` (Terminus indicator) hasn't been authored — likely a
`foundation-observability` gap.

**Expected after Wave 1 closes:** `pnpm --filter app start`
boots NestJS; `/health` returns
`{"status":"UP","components":{"db":"UP","...":"..."}}`.

### Running the suite as one command

```bash
$ ./tools/captain-preflight/check.sh        # pre-wave: Phase-0 readiness
$ pnpm typecheck && pnpm req-lint && pnpm check-track-meta-paths   # check 1
$ pnpm test                                  # check 2: tests
$ rover supergraph compose --config supergraph.yaml 2>&1 | head -5   # check 3
$ pnpm test --filter "*pact*"                # check 4
$ pnpm test --filter "*event*" --filter "*outbox*"   # check 5
$ pnpm --filter app start > /tmp/app.log 2>&1 &
$ sleep 15 && curl -fsS http://localhost:3000/health && kill %1   # check 6
```

The captain-preflight script is the Phase-0 gate; the six pnpm/rover
commands are the Phase-9 gate. A truly-healthy engagement passes both.

### What "passes" means at each wave milestone

| Wave milestone | Check 1 build | Check 2 test | Check 3 federation | Check 4 Pact | Check 5 events | Check 6 healthcheck |
|---|---|---|---|---|---|---|
| Bootstrap (no waves yet) | ✓ (scaffolding only) | ✓ vacuous | ✗ no SDL | ✓ vacuous | ✓ vacuous | ✗ no app |
| After Wave 1 closes | ✓ | ✓ (slot tests) | ✓ slot SDL | ✓ vacuous | ✓ slot events | ✓ healthcheck up |
| After Wave 9 closes | ✓ | ✓ (full suite) | ✓ supergraph | ✓ (all integrations) | ✓ full event surface | ✓ |

The two ✗ entries on the bootstrap row are the **expected** state
before any wave runs. The guide does NOT claim they should pass at
bootstrap — failure there is a signal to dispatch the relevant wave,
not a sign of broken setup.

---

# Appendix A — Tooling matrix (agnostic capability → per-platform command)

The methodology in Phases 1–8 names abstract capabilities. The
per-platform playbook resolves each to a concrete invocation. This
matrix is the authoritative map for this engagement (TypeScript). New
platforms onboard by adding a column.

| Capability | Why it exists | TypeScript / Node |
|---|---|---|
| **Catalog validation** | Asserts every REQ has correct REQ-Spec-v3 frontmatter (id matches filename, schema_version: 3, owners triad, invariants_respected references resolve, embedded YAML criterion blocks parse). Fails the build if any REQ is malformed. | `pnpm req-lint` (wraps `tsx tools/req-lint/src/lint.ts --catalog requirements --output orchestration/reviews/req-lint-<ts>.json`) |
| **Catalog test-coverage** | Asserts every critical/high acceptance criterion has at least one `describe('@req <REQ-ID> @criterion <id>', …)`-tagged vitest test under `apps/`, `libs/`, or `contracts/`. Also surfaces tag drift (tests referencing renamed/removed REQs). | `pnpm req-coverage` (wraps `tsx tools/req-coverage/src/coverage.ts`; `--soft` for advisory mode; `--gate-severity critical` to narrow the gate) |
| **Track-meta path check** | Read-only gate that fails the build if any track-meta references a foreign stack's path conventions. Wired into the unified typecheck/test target. | `pnpm check-track-meta-paths` (validates that every track-meta's `deliverables:` paths fall under `apps/` / `libs/` / `migrations/` / `tools/` / `orchestration/`) |
| **Prompt composition** | Stitches together base rule-pack + agent-class authority + track-meta mission + inlined REQ excerpts + operational protocol into `orchestration/prompts/composed/<track-id>.md`. The composed prompt is what the manager pipes to a worker via `scion message`. | `pnpm compose-prompts --wave <N>` (wraps `tsx tools/prompt-composer/src/compose.ts --track-meta orchestration/track-meta/<track-id>.yaml`) |
| **Prompt composition validation** | Read-only structural check that every in-scope track-meta is composable (required fields present, REQ paths resolve, agent_class is registered). | `pnpm validate-prompt-composition --wave <N>` (wraps `tsx tools/prompt-composer/src/compose.ts --track-meta ... --validate-only`) |
| **Build + test gate** | The unified target the manager runs at every merge. Composes: catalog validation, track-meta path check, compile, lint, unit tests. | `pnpm typecheck && pnpm test` (or `pnpm -r build && pnpm -r test`) |
| **Wave gate-check** | The synchronization gate the manager runs before merging staging → trunk. Reads `orchestration/gates/gates.json`, dispatches the named gate's command list. | `./orchestration/gates/gate-check.sh <gate-id>` (wraps `pnpm` calls) |

The gate-check script itself is stack-agnostic — it reads `gates.json`
and shells out to whatever `commands:` array the gate declares. Authors
in `gates.json` choose the stack-specific commands at gate-definition time.

# Appendix B — Onboarding a new platform

To adopt this swarm methodology for a new stack (e.g. Python, Go, Rust), a
**per-platform playbook** must define the following. Use this checklist as
the table of contents for your new `<platform>_swarm_playbook.md`.

## Required

1. **Build/test commands** — the concrete invocations for "compile,"
   "test," and "lint" in your stack. The manager calls these via the
   gate-check script.
2. **Catalog-validator command** — replaces `pnpm req-lint`
   (TypeScript reference). MUST parse every `requirements/REQ-*.md` and
   fail on malformed REQ-Spec-v3 frontmatter.
3. **Track-meta path conventions** — how you map the V2 monorepo's
   TypeScript paths (`libs/domain/src/<x>.ts`, `apps/app/src/<x>.ts`)
   to your stack's idiomatic layout. Document the mapping table.
4. **Prompt-composer command** — replaces `pnpm compose-prompts`
   (TypeScript reference). MUST produce one self-contained markdown file
   per track at `orchestration/prompts/composed/<track-id>.md`,
   structured per Phase 4 §3 of this guide.
5. **File/package conventions** — how tests are named (e.g. `*.spec.ts`),
   how production code is packaged, how tagged-test annotations work
   (e.g. `describe('@req REQ-X @criterion <id>', () => ...)` in a vitest
   spec for TypeScript).
6. **TDD annotation syntax** — how a worker tags `[test] <criterion-id> failing` →
   `[impl] <criterion-id> passing` so the manager's audit can verify
   ordering at the commit graph.
7. **Stub-ledger registration syntax** — how a worker registers an
   allowed stub in `orchestration/ledgers/stub-ledger.yaml`. The schema
   is stack-agnostic; only the `path:` strings differ.
8. **Composer scope under `agent-class-registry.yaml`** — the
   `allowed_paths` and `forbidden_patterns` for each agent class your
   stack uses. This engagement uses `typescript-domain-agent`,
   `typescript-api-agent`, `application-services-agent`,
   `foundations-agent`, `spec-adherence-agent`, and `code-review-codex`
   (cross-model auditor).

## Optional

9. **CI integration** — how the unified typecheck/test gate is run in
   CI (GitHub Actions, etc.). Manager runs it locally pre-merge; CI is
   a backstop.
10. **Migration tool** — if your template repo is in a different stack
    than your target, ship a one-shot path migrator. Engagements that
    bootstrap directly into a known stack layout (like this TypeScript
    V2 monorepo) can skip this.

## Cross-link discipline

Both this guide AND your per-platform playbook should cross-link each
other. Captains adopting the swarm should be able to navigate methodology
↔ stack-commands in one click.

# Appendix C — Mechanical gates a Captain should consider

A Captain adopting the swarm should ensure each of these six gate
categories is enforced by their build / CI / audit pipeline before the
first capability wave dispatches. These categories come from the
hardened-swarm design rationale (see
`SWARM-QUALITY-FRAMEWORK.md` for the failure modes each gate prevents).

This repo's TypeScript engagement targets implementing **6 of 6** of these
(carrying over the gate suite proven out in the prior V2 NestJS
engagement at `~/projects/appointment-swarm/`); ⏸ entries below name
the gates not yet wired into this fresh-start engagement.

| # | Gate | What it does | TypeScript / Node implementation (this engagement) | Kotlin / JVM implementation (reference) |
|---|---|---|---|---|
| 1 | **`ci-typecheck`** | Hard gate: every package's `tsc --noEmit` (or stack equivalent) exits 0. A track can only claim "pre-existing failure" if the exact failure signature is recorded in a baseline ledger with owner + expiry-wave. | ✅ `pnpm typecheck` runs `tsc --noEmit` across every workspace package under TS strict mode. | `./gradlew check` runs `compileKotlin` as a strict typecheck. |
| 2 | **`no-new-baseline-regressions`** | Compares current gate output to a baseline ledger. Fails if a new package starts failing, a failure signature broadens, a failure count increases, or an ownerless baseline is referenced. | ⏸ **future** — would need `orchestration/baselines/trunk-health.yaml` + a pnpm script that diffs current `pnpm typecheck` errors against the baseline. The prior V2 engagement at `~/projects/appointment-swarm/` ships a reference `tools/build-checks/baseline-regression-gate.ts` that can be ported. | Would need a Gradle task that diffs `./gradlew check` errors against a baseline ledger. |
| 3 | **`root-module-wiring`** | Checks that new use cases / resolvers / controllers are actually imported into an application module (NestJS `@Module` providers chain), not just authored as floating files. | ⏸ **future** — needs a pnpm script that walks `apps/app/src/` and asserts every new resolver has a corresponding NestJS provider wired into the relevant `@Module()`. meta-compose meta-track (Phase 4) makes this a per-wave responsibility instead of a per-track one. Reference impl: `tools/build-checks/app-module-wiring-gate.ts` in the V2 engagement. | A Gradle task that walks `src/main/kotlin/.../api/` and asserts every new resolver has a corresponding Micronaut bean wired into `Application.kt`. |
| 4 | **`package-boundary-check`** | Asserts module/package imports cross declared boundaries only. Forbids infrastructure imports inside `domain/`. | ✅ Partially — `agent-class-registry.yaml` declares `allowed_paths` + `forbidden_patterns` per agent class (e.g. `libs/domain/` forbids `from 'pg'` / `from 'drizzle-orm'` / `from '@nestjs/...'`). The audit catches violations at PR review. **Future-extension**: a pnpm script that mechanically enforces TS-package-level layering at build time (a layered-architecture-gate equivalent; reference impl in V2 engagement). | `agent-class-registry.yaml` declares `allowed_paths` + JVM `forbidden_patterns`; the audit enforces at PR review. |
| 5 | **`generated-artifacts-current`** | Re-runs codegen at build time and fails if any generated GraphQL SDL / OpenAPI / type files would change. Catches stale generated artifacts before they ship. | ✅ `pnpm compose-prompts` is idempotent — re-running shows 0 changes if everything is current. `pnpm validate-prompt-composition` proves track-meta is composable. **Partial**: no equivalent yet for GraphQL SDL generation (Wave-1 will introduce SDL files; the gate becomes meaningful then — typically `pnpm codegen --check`). | `composePrompts` Gradle task is idempotent; `validatePromptComposition` proves composability. |
| 6 | **`no-production-stubs`** | Searches production code for `TODO`, `throw new Error("not implemented")`, `noop`, `stub`, `fake`, always-allow auth policies. Only entries registered in the stub-ledger with owner + expiry are exempted. | ✅ `orchestration/ledgers/stub-ledger.yaml` is the registry. Audit cycles (spec-adherence) check whether expired stubs have been replaced. **Future-extension**: a pnpm script that mechanically greps `apps/*/src/` and `libs/*/src/` for the forbidden patterns and cross-checks with the ledger; reference impl `tools/build-checks/no-production-stubs.ts` in the V2 engagement. | `orchestration/ledgers/stub-ledger.yaml` is the registry; audit cycles catch expired stubs. |

## Acceptance for a healthy gate set

Per `SWARM-QUALITY-FRAMEWORK.md`:

- Every gate names its **false-negative profile**: what it will MISS,
  not just what it will catch.
- Every gate is **mechanically enforced**: it runs in `pnpm typecheck && pnpm test`
  / the manager's audit cycle / CI on every push. A gate documented only
  in a `README.md` or `// rule:` comment is not a gate.
- Every gate's exemption file (if it has one) has **owner + ticket +
  expiry-wave** on every row. Ownerless exemptions count as failures.

If you can answer "yes" to all three for each of the six gates, your
engagement is in good shape for capability waves. If you have ⏸ entries
above, those represent real-mistakes-the-swarm-could-make until the
gate exists.

# Reference card

| Need | Path (this repo) |
|---|---|
| This guide | `USER-GUIDE.md` (org-canonical, agnostic) |
| TypeScript platform playbook | `typescript_swarm_playbook.md` |
| Wave plan / track inventory | `orchestration/PHASE-2-CATALOG-DRIVEN-KICKOFF.md` |
| Execution graph (domain → contract → foundation → meta + app + helper + integration) | `EXECUTION-GRAPH.md` |
| Author REQs | `requirements/` (45 v3 REQs in this repo as worked examples) |
| Catalog validator | `pnpm req-lint` (script in root `package.json`; impl at `tools/req-lint/`) |
| Track-meta migrator | n/a — engagement bootstraps directly into the TypeScript V2 monorepo layout |
| Prompt composer | `pnpm compose-prompts` (script in root `package.json`); docs at `tools/prompt-composer/README.md` |
| Agent class registry | `orchestration/ledgers/agent-class-registry.yaml` |
| Contract ledger | `orchestration/ledgers/contract-ledger.yaml` |
| Stub ledger | `orchestration/ledgers/stub-ledger.yaml` |
| Manager kickoff prompt | `orchestration/prompts/manager-kickoff.md` |
| Worker base prompt | `orchestration/prompts/base.md` |
| Composed worker prompts | `orchestration/prompts/composed/<track-id>.md` |
| Wave kickoff briefs | `orchestration/dispatch/w<N>-batch-<M>-kickoff.md` |
| Gate definitions | `orchestration/gates/gates.json` |
| Gate runner | `orchestration/gates/gate-check.sh` |
| Wave status board | `orchestration/status.md` |
| Closure reports | `orchestration/reports/w<N>-closure.md` |
| Spec-adherence reviews | `orchestration/reviews/<wave>-spec-adherence.md` |
| Escalations | `orchestration/escalations/<ISO>-<short-id>.md` |
| Captain/swarm authority hook | `tools/captain-authority/check.sh` (Phase 0.8 PreToolUse hook) |

## Quick Scion command reference

```bash
# Appendix D — Track naming convention

Track IDs are read by humans dozens of times per wave (in `git log`, in
status reports, in escalations, in PR descriptions). The naming
convention below gives every track-id a **self-describing type prefix**
+ a **descriptive body** so the type is visible at a glance without
looking up a registry.

## The eight type prefixes

| Prefix | Meaning | Lives in (TypeScript / Node monorepo) | Body convention | Example |
|---|---|---|---|---|
| **`domain-`** | Pure business logic. Domain entities, state machines, business rules, invariants, port interfaces. | `libs/domain/src/` | **plural entity noun** | `domain-slots`, `domain-appointments`, `domain-care-plans` |
| **`app-`** | Runnable application slice composing domain logic with infrastructure. Controllers, resolvers, NestJS modules, request handlers. | `apps/<service>/src/` | **verb-noun capability phrase** | `app-cancel-appointment`, `app-book-appointment`, `app-record-no-show` |
| **`service-`** | Per-service-type rule pack that plugs into a generic capability (e.g. booking). Encapsulates service-specific invariants, allowed modalities, credential rules, lifecycle quirks. | `libs/domain/src/services/<service>/` (rules) + `libs/outbound-adapters/src/integrations/services/<service>/` (any adapters) | **service identifier** (abbreviation OK if canonical) | `service-bps`, `service-individual-therapy`, `service-group-therapy`, `service-psychiatry` |
| **`contract-`** | A versioned cross-track contract (events, GraphQL SDL, OpenAPI, message envelopes). Other tracks subscribe to it via `subscribed_contracts:` in their track-meta. | `contracts/src/` | **noun + `@v<x.y.z>`** suffix | `contract-events@v1.1.0`, `contract-graphql-sdl@v1.0.0` |
| **`meta-`** | Cross-cutting infrastructure roles that span EVERY wave. The three permanent meta-tracks: composition (wiring), gates (mechanical enforcement), pattern propagation. | varies (orchestration / `apps/<service>/src/` for compose; `tools/` for gate; `orchestration/` for propagate) | **short role name** | `meta-compose`, `meta-gate`, `meta-propagate` |
| **`foundation-`** | One-time platform-foundation work for a specific cross-cutting concern. Less general than `meta-*`. | varies (`migrations/`, `libs/outbound-adapters/src/persistence/`, `libs/shared-kernel/src/`) | **plural noun for the foundation area** | `foundation-database`, `foundation-timezone`, `foundation-tenant-isolation` |
| **`helper-`** | Auxiliary supporting work for a capability — state-machine extraction, cascade handlers, validators. Same agent class as the parent `app-*` track but distinct deliverable. | varies; mirrors the parent app-track's tree | **descriptive phrase** | `helper-checkin-state-machine`, `helper-cascade-attribution`, `helper-cancel-validations` |
| **`integration-`** | Integration with an external system: event publishers, gRPC clients, EHR adapters. Adapters living behind a domain port. | `libs/outbound-adapters/src/integrations/<target>/` | **target-system identifier** | `integration-world-model`, `integration-elation-ehr`, `integration-iterable` |

## Domain vs app — the key distinction

The most common confusion is between `domain-*` and `app-*`. In one sentence:

> **`domain-*` owns "what's true and what's allowed"; `app-*` owns "who can ask, how, and what happens after."**

In hexagonal-architecture terms:

| Aspect | `domain-*` | `app-*` |
|---|---|---|
| Layer | The hexagon (domain core) | Adapter shell (composition + delivery) |
| Imports allowed | Standard library only | NestJS, Apollo, Drizzle, `pg`, `jose`, `zod`, etc. |
| Imports forbidden | `pg`, `drizzle-orm`, `@nestjs/*`, `jose`, anything network/IO | (none forbidden — this is where the infra lives) |
| Test style | Pure unit (vitest, no DB, no app boot) | Integration (Testcontainers Postgres) + e2e (boot NestJS, fire real mutations) |
| Replaceable | Yes — `libs/domain` could be reused if you built a second app on the same domain | No — coupled to NestJS + the chosen API surface |
| Example deliverable | `Slot` entity + `SlotStatus` enum + `SlotGrid` + the rules that say "FREE → PENDING → BOOKED is legal; FREE → BOOKED is not" | The `cancelAppointment` GraphQL mutation + resolver + service that loads the appointment via Drizzle, calls `domain-appointments`'s `cancel()` rule, persists the state transition, fires the outbox event |

If a track touches both domain rules AND adapter code, **split it**: a
`domain-*` track for the rule + a sibling `app-*` track for the adapter
that orchestrates it. Workers in different agent classes pick up the
two tracks; the manager merges them in order (`domain-*` first, then
`app-*` depending on the produced domain types).

## Execution graph order

The dependency order across types — what merges before what:

```
domain → contract → foundation → meta + app + service + helper + integration
        (each level depends on everything to its left)
```

In plain English:
1. **`domain-*`** ships first. Pure types + rules. No infra dependencies. Every other type depends on the produced domain types.
2. **`contract-*`** ships second. Versioned events / SDLs / envelopes. May reference domain types in the contract shapes.
3. **`foundation-*`** ships third. One-time platform setup (DB schema, datasource wiring, timezone helpers). May import from `domain` for type signatures; doesn't yet wire into `app`.
4. **`meta-*` + `app-*` + `service-*` + `helper-*` + `integration-*`** ship in parallel. They all consume `domain` + `contract` + `foundation`. Their internal ordering is by `predecessors:` in each track-meta.

## Wave-scoped naming

Per-wave tracks prefix the wave number for traceability:
- `w1-domain-slots` (wave 1's domain-slots delivery)
- `w2-app-cancel-appointment`
- `w1-foundation-database`

The wave prefix isolates per-wave dispatch. A track that ships once
across the engagement (the three permanent meta-tracks) carries the
wave prefix only when invoked: e.g. `w1-meta-compose` is the wave-1
invocation of `meta-compose`.

## Per-engagement overrides

This convention is methodology-level. A per-platform playbook MAY add
stack-specific naming guidance (e.g., suffixes for monorepo packages,
hyphen vs. underscore preference). The body convention (plural noun vs.
verb-noun-phrase) is fixed at the methodology level so multi-stack
engagements stay legible across stacks.

See `typescript_swarm_playbook.md` § Track naming (this engagement) for
the TypeScript-specific additions.

---

# Captain setup
scion harness-config list                       # confirm harness images mapped
podman image ls | grep scion-                   # confirm images in local store
scion secret list                               # confirm secrets
scion hub status                                # confirm Hub auth
scion doctor                                    # confirm runtime + binfmt

# Spawn manager
export SCION_HUB_TOKEN="$(cat ~/.scion/manager-pat)"   # from Step 0.5b
scion create manager --harness claude --workspace ~/projects/<your-service> -b main
scion start manager
scion message --raw manager $'\r'              # dismiss trust dialog
scion message manager "<kickoff prompt>"

# Spawn worker (manager does this; Captain only intervenes)
scion create <track-id> --harness claude --workspace <worktree-path> -b swarm/<track-id>
scion start <track-id>
scion message --raw <track-id> $'\r'
scion message <track-id> "<composed prompt>"

# Status checks
scion list                                      # container states
scion logs manager --tail 100                  # manager log tail
scion logs <track-id> --tail 100               # worker log tail

# Lifecycle
scion stop <worker>                            # idle
scion start <worker>                           # resume
scion rm <worker>                              # destroy
```
