#!/usr/bin/env bash
#
# Phase-0 Captain preflight — verifies every prerequisite required to boot
# the Scion manager and dispatch a wave.
#
# Mirrors docs/USER-GUIDE.md §"Phase 0 — Captain prerequisites" 1:1,
# plus additional readiness checks for Phase 4/5 dispatch:
#   0.1  Tooling on your Captain laptop
#   0.2  Local Scion image repository + container runtime health
#   0.3  Host filesystem layout
#   0.4  Harness credentials and GitHub PAT (Anthropic + Codex/OpenAI + GITHUB_TOKEN)
#   0.5a Hub auth bootstrap (server reachable + Hub Integration Enabled)
#   0.5b Manager UAT (file + Bearer-token check)
#   0.6  Broker harness-configs seeded (claude/codex/gemini/opencode)
#   0.7  Engagement project-scoped agent templates
#   1.3  Dependencies installed (pnpm install)
#   5.0  Hub runtime readiness (grove linked, env pushed, default harness)
#   5.1  Phase 4 artifacts present (track-meta, composed prompts, kickoff brief)
#
# Usage:
#   ./tools/captain-preflight/check.sh           # run all checks
#   ./tools/captain-preflight/check.sh -v        # show diagnostic command output
#   ./tools/captain-preflight/check.sh --help
#
# Exit codes:
#   0 = all prerequisites satisfied; Captain can proceed to Phase 5 dispatch
#   1 = one or more prerequisites failed; see output for the action items
#   2 = bad invocation
#
# Platform: this script's Step 0.1 includes a TypeScript-specific check
# (node + pnpm). Other stacks should fork that block; the rest of the
# checks are platform-agnostic and mirror the org-canonical USER-GUIDE.

set -uo pipefail

VERBOSE=0
case "${1:-}" in
  ""|--run|run) ;;
  -v|--verbose) VERBOSE=1 ;;
  -h|--help|help)
    sed -n '3,28p' "$0" | sed 's/^# //; s/^#//'
    exit 0
    ;;
  *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
esac

PASS=0
FAIL=0
WARN=0
FAILURES=()

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKTREES_DIR="${PROJECT_ROOT}-worktrees"

ok()   { printf "  [ ok ] %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  [warn] %s\n         → %s\n" "$1" "$2"; WARN=$((WARN+1)); }
fail() {
  printf "  [fail] %s\n         → %s\n" "$1" "$2"
  FAIL=$((FAIL+1))
  FAILURES+=("$1")
}
diag() { [[ $VERBOSE -eq 1 ]] && printf "         $ %s\n" "$1" || true; }

header() { printf "\n── %s ──────────────────────────────────────────\n" "$1"; }

#############################################################################
# Step 0.1 — Tooling on your Captain laptop (docs/USER-GUIDE.md §Step 0.1)
#############################################################################
header "Step 0.1 — Captain laptop tooling"

if command -v git >/dev/null 2>&1; then
  GIT_VER="$(git --version | awk '{print $3}')"
  GIT_MAJOR="$(echo "$GIT_VER" | cut -d. -f1)"
  GIT_MINOR="$(echo "$GIT_VER" | cut -d. -f2)"
  if [[ $GIT_MAJOR -gt 2 ]] || { [[ $GIT_MAJOR -eq 2 ]] && [[ $GIT_MINOR -ge 40 ]]; }; then
    ok "git ≥ 2.40 ($GIT_VER)"
  else
    fail "git ≥ 2.40 required (have $GIT_VER)" "Upgrade git: brew install git"
  fi
else
  fail "git not on PATH" "Install: brew install git"
fi

if command -v scion >/dev/null 2>&1; then
  SCION_PATH="$(command -v scion)"
  ok "scion CLI on PATH ($SCION_PATH)"
  diag "scion --version"
  [[ $VERBOSE -eq 1 ]] && scion --version 2>&1 | sed 's/^/         /' || true
else
  fail "scion CLI not on PATH" "Install per your org's Scion onboarding"
fi

if command -v podman >/dev/null 2>&1; then
  ok "container runtime: podman ($(command -v podman))"
elif command -v docker >/dev/null 2>&1; then
  ok "container runtime: docker ($(command -v docker))"
else
  fail "no container runtime (podman or docker) on PATH" "Install one: brew install podman OR brew install --cask docker"
fi

if command -v gh >/dev/null 2>&1; then
  if gh auth status >/dev/null 2>&1; then
    GH_USER="$(gh api user --jq .login 2>/dev/null || echo unknown)"
    ok "gh CLI authenticated as $GH_USER"
  else
    warn "gh CLI installed but not authenticated" "gh auth login"
  fi
else
  warn "gh CLI not installed (optional but recommended)" "brew install gh"
fi

# TypeScript-specific: Node 20 + pnpm 9
if command -v node >/dev/null 2>&1; then
  NODE_VER_LINE="$(node --version)"   # e.g. "v20.11.0"
  if echo "$NODE_VER_LINE" | grep -qE '^v(2[0-9]|[3-9][0-9])\.'; then
    ok "Node ≥ 20 ($NODE_VER_LINE)"
    diag "$(command -v node)"
  else
    fail "Node 20 required (detected '$NODE_VER_LINE')" \
         "brew install node@20 && brew link --force --overwrite node@20  (or use nvm: 'nvm install 20 && nvm use 20')"
  fi
else
  fail "node not on PATH" \
       "brew install node@20 && brew link --force --overwrite node@20  (or use nvm: 'nvm install 20 && nvm use 20')"
fi

if command -v pnpm >/dev/null 2>&1; then
  PNPM_VER="$(pnpm --version)"        # e.g. "9.4.0"
  PNPM_MAJOR="$(echo "$PNPM_VER" | cut -d. -f1)"
  if [[ "${PNPM_MAJOR:-0}" -ge 9 ]] 2>/dev/null; then
    ok "pnpm ≥ 9 ($PNPM_VER)"
    diag "$(command -v pnpm)"
  else
    fail "pnpm ≥ 9 required (have $PNPM_VER)" "corepack enable && corepack prepare pnpm@latest --activate"
  fi
else
  fail "pnpm not on PATH" "corepack enable && corepack prepare pnpm@latest --activate  (or 'npm install -g pnpm@latest')"
fi

if command -v yq >/dev/null 2>&1; then
  ok "yq on PATH ($(command -v yq))"
else
  fail "yq not on PATH" "brew install yq  (the manager uses 'yq' to read agent-class-registry.yaml during worker spawn)"
fi

#############################################################################
# Step 0.2 — Local Scion image repository (docs/USER-GUIDE.md §Step 0.2)
#
# One container image per harness (scion-claude, scion-codex, scion-gemini,
# scion-opencode). Manager + workers all run the same image; the mapping
# from harness name → image is exposed via `scion harness-config list`.
#############################################################################
header "Step 0.2 — Scion images (harness model)"

if command -v scion >/dev/null 2>&1; then
  HARNESS_LIST="$(scion harness-config list --global 2>/dev/null || scion harness-config list 2>/dev/null || true)"
  if echo "$HARNESS_LIST" | grep -qE '^claude[[:space:]]'; then
    ok "scion harness 'claude' registered (→ scion-claude:latest)"
    [[ $VERBOSE -eq 1 ]] && echo "$HARNESS_LIST" | sed 's/^/         /' || true
  else
    fail "scion harness 'claude' not in 'scion harness-config list --global'" \
         "scion init --machine --yes  (seeds the named harness configs; see Step 0.6)"
  fi
else
  fail "cannot check harnesses — scion CLI unavailable" "see Step 0.1 above"
fi

# Determine container runtime
if command -v podman >/dev/null 2>&1; then
  RUNTIME_BIN=podman
elif command -v docker >/dev/null 2>&1; then
  RUNTIME_BIN=docker
else
  RUNTIME_BIN=""
fi

if [[ -n "$RUNTIME_BIN" ]]; then
  IMG_LIST="$("$RUNTIME_BIN" image ls --format '{{.Repository}}:{{.Tag}}' 2>/dev/null | sort -u || true)"
  if echo "$IMG_LIST" | grep -qE '^(localhost/)?scion-claude:latest$'; then
    ok "scion-claude:latest in local $RUNTIME_BIN store"
  else
    fail "scion-claude:latest not in local $RUNTIME_BIN store" \
         "./tools/setup-scion-images/build.sh --clone   (builds the full image set; see docs/USER-GUIDE.md §Step 0.2)"
  fi
  if echo "$IMG_LIST" | grep -qE '^(localhost/)?scion-base:latest$'; then
    ok "scion-base:latest present (transitive base layer)"
  fi
  [[ $VERBOSE -eq 1 ]] && echo "$IMG_LIST" | grep scion- | sed 's/^/         /' || true
else
  fail "cannot check images — no podman or docker on PATH" "see Step 0.1 above"
fi

# scion doctor — runtime sanity check
if command -v scion >/dev/null 2>&1; then
  DOCTOR_OUT="$(scion doctor 2>&1 || true)"
  if echo "$DOCTOR_OUT" | grep -q '✓.*runtime:'; then
    ok "scion doctor: container runtime healthy"
    [[ $VERBOSE -eq 1 ]] && echo "$DOCTOR_OUT" | sed 's/^/         /' || true
  else
    warn "scion doctor reports runtime issues" "Run 'scion doctor' for details"
  fi
fi

# Podman machine health (macOS only — podman uses a Linux VM)
if [[ "$RUNTIME_BIN" == "podman" ]] && [[ "$(uname -s)" == "Darwin" ]]; then
  if podman machine inspect >/dev/null 2>&1; then
    if podman info >/dev/null 2>&1; then
      ok "podman machine running"
    else
      fail "podman machine exists but not running" "podman machine start"
    fi
  else
    fail "no podman machine initialized" "podman machine init && podman machine start"
  fi
fi

#############################################################################
# Step 0.3 — Host filesystem layout (docs/USER-GUIDE.md §Step 0.3)
#############################################################################
header "Step 0.3 — Host filesystem layout"

if [[ -d "$PROJECT_ROOT" && -f "$PROJECT_ROOT/package.json" && -f "$PROJECT_ROOT/pnpm-workspace.yaml" ]]; then
  ok "workspace present at $PROJECT_ROOT (package.json + pnpm-workspace.yaml)"
else
  fail "workspace not found at $PROJECT_ROOT (missing package.json or pnpm-workspace.yaml)" "git clone the repo to this location; verify pnpm-workspace.yaml at the root"
fi

if [[ -d "$WORKTREES_DIR" ]]; then
  ok "worktree parent dir present at $WORKTREES_DIR"
else
  warn "worktree parent dir missing at $WORKTREES_DIR" "mkdir -p $WORKTREES_DIR (manager will populate per-track worktrees here)"
fi

if [[ -d "$HOME/.scion" ]]; then
  ok "~/.scion present"
else
  fail "~/.scion missing" "mkdir -p ~/.scion (will hold the manager UAT in Step 0.5b)"
fi

#############################################################################
# Step 0.4 — Harness credentials and GitHub PAT (docs/USER-GUIDE.md §Step 0.4)
#
# Three sub-blocks per the USER-GUIDE:
#   (a) Anthropic / harness API key in ~/.scion/secrets.env
#   (b) Codex (OpenAI) credentials registered on the Hub for code-review-codex
#       (auth path — env or file — AND CODEX_CONFIG file secret)
#   (c) GitHub PAT in ~/.scion/secrets.env
#############################################################################
header "Step 0.4 — Harness credentials and GitHub PAT"

# (a) + (c) — file-based ~/.scion/secrets.env
SECRETS_FILE="$HOME/.scion/secrets.env"
if [[ -f "$SECRETS_FILE" ]]; then
  ok "secrets.env present at $SECRETS_FILE"
  SEC_MODE="$(stat -f '%Lp' "$SECRETS_FILE" 2>/dev/null || stat -c '%a' "$SECRETS_FILE" 2>/dev/null || echo unknown)"
  if [[ "$SEC_MODE" == "600" ]]; then
    ok "secrets.env mode is 600"
  else
    fail "secrets.env mode should be 600 (have $SEC_MODE)" "chmod 600 $SECRETS_FILE"
  fi
  if grep -qE '^ANTHROPIC_API_KEY=' "$SECRETS_FILE"; then
    ok "ANTHROPIC_API_KEY present in secrets.env"
  else
    fail "ANTHROPIC_API_KEY not in secrets.env" \
         "echo 'ANTHROPIC_API_KEY=<your-key>' >> $SECRETS_FILE  (the claude harness needs this)"
  fi
  if grep -qE '^GITHUB_TOKEN=' "$SECRETS_FILE"; then
    ok "GITHUB_TOKEN present in secrets.env (workers can push to origin)"
  else
    fail "GITHUB_TOKEN not in secrets.env" \
         "printf 'GITHUB_TOKEN=%s\\n' \"\$(gh auth token)\" >> $SECRETS_FILE && chmod 600 $SECRETS_FILE"
  fi
else
  fail "secrets.env missing at $SECRETS_FILE" "Per docs/USER-GUIDE.md §0.4: create with ANTHROPIC_API_KEY + GITHUB_TOKEN, mode 600"
fi

# (b) — Codex (OpenAI) credentials for the code-review-codex agent.
# Cross-model audit is mandatory — every wave-batch merge requires both
# spec-adherence (Claude) AND codex (OpenAI) verdicts. Probes:
#   - at least one auth path (OPENAI_API_KEY/CODEX_API_KEY env or
#     CODEX_AUTH file secret) registered in user OR project scope;
#   - CODEX_CONFIG file secret registered (pins gpt-5.5/xhigh — without
#     it the worker silently falls back to gpt-5.4/medium);
#   - both scopes (warn-only; broker resolves user ∪ project).
if ! command -v scion >/dev/null 2>&1; then
  fail "cannot probe codex credentials — scion CLI unavailable" "see Step 0.1 above"
else
  _has_env() {
    local _key="$1" _scope="$2" _out
    if [[ -z "$_scope" ]]; then
      _out="$(scion hub env get "$_key" 2>&1 || true)"
    else
      _out="$(scion hub env get "$_key" "$_scope" 2>&1 || true)"
    fi
    echo "$_out" | grep -qE "^${_key}=" && return 0
    return 1
  }

  _has_secret() {
    local _key="$1" _scope="$2" _out
    if [[ -z "$_scope" ]]; then
      _out="$(scion hub secret list 2>/dev/null || true)"
    else
      _out="$(scion hub secret list "$_scope" 2>/dev/null || true)"
    fi
    echo "$_out" | awk '{print $1}' | grep -qx "$_key" && return 0
    return 1
  }

  AUTH_USER=""
  AUTH_GROVE=""
  for k in OPENAI_API_KEY CODEX_API_KEY; do
    _has_env "$k" ""        && AUTH_USER="${AUTH_USER:+$AUTH_USER, }$k(env)"
    _has_env "$k" "--project" && AUTH_GROVE="${AUTH_GROVE:+$AUTH_GROVE, }$k(env)"
  done
  _has_secret CODEX_AUTH ""        && AUTH_USER="${AUTH_USER:+$AUTH_USER, }CODEX_AUTH(file)"
  _has_secret CODEX_AUTH "--project" && AUTH_GROVE="${AUTH_GROVE:+$AUTH_GROVE, }CODEX_AUTH(file)"

  if [[ -n "$AUTH_USER" || -n "$AUTH_GROVE" ]]; then
    if [[ -n "$AUTH_USER" && -n "$AUTH_GROVE" ]]; then
      ok "codex auth registered at both scopes (user: ${AUTH_USER}; project: ${AUTH_GROVE})"
    elif [[ -n "$AUTH_USER" ]]; then
      ok "codex auth registered at user scope (${AUTH_USER})"
      warn "codex auth not registered at project scope" \
           "Belt-and-suspenders per docs/USER-GUIDE.md §0.4: also set at --project scope (broker resolves user ∪ project)"
    else
      ok "codex auth registered at project scope (${AUTH_GROVE})"
      warn "codex auth not registered at user scope" \
           "Belt-and-suspenders per docs/USER-GUIDE.md §0.4: also set at user scope (no flag)"
    fi
  else
    fail "no codex auth path registered (OPENAI_API_KEY / CODEX_API_KEY env or CODEX_AUTH file secret)" \
         "Pick Path A (API key) or Path B (OAuth file) per docs/USER-GUIDE.md §0.4"
  fi

  CFG_USER=0
  CFG_GROVE=0
  _has_secret CODEX_CONFIG ""        && CFG_USER=1
  _has_secret CODEX_CONFIG "--project" && CFG_GROVE=1

  if [[ $CFG_USER -eq 1 && $CFG_GROVE -eq 1 ]]; then
    ok "CODEX_CONFIG file secret registered at both scopes (pins gpt-5.5/xhigh)"
  elif [[ $CFG_USER -eq 1 ]]; then
    ok "CODEX_CONFIG file secret registered at user scope"
    warn "CODEX_CONFIG not registered at project scope" \
         "Belt-and-suspenders per docs/USER-GUIDE.md §0.4: also set at --project scope"
  elif [[ $CFG_GROVE -eq 1 ]]; then
    ok "CODEX_CONFIG file secret registered at project scope"
    warn "CODEX_CONFIG not registered at user scope" \
         "Belt-and-suspenders per docs/USER-GUIDE.md §0.4: also set at user scope (no flag)"
  else
    fail "CODEX_CONFIG file secret missing in both scopes" \
         "Without it the codex worker silently falls back to gpt-5.4/medium and the cross-model audit line is wrong; see docs/USER-GUIDE.md §0.4"
  fi
fi

#############################################################################
# Step 0.5a — Hub auth bootstrap (docs/USER-GUIDE.md §Step 0.5a)
#
# Probes that the local Scion server is reachable AND Hub Integration is
# enabled. Without this, every Hub-routed scion subcommand 500s.
#############################################################################
header "Step 0.5a — Hub auth bootstrap (server reachable + Hub enabled)"

HUB_REACHABLE=0
if ! command -v scion >/dev/null 2>&1; then
  fail "cannot probe Hub status — scion CLI unavailable" "see Step 0.1 above"
else
  HUB_STATUS_BOOT="$(scion hub status --global 2>&1 || true)"
  if echo "$HUB_STATUS_BOOT" | grep -qiE '(server unreachable|connection refused|cannot connect)'; then
    fail "Scion server unreachable" \
         "Start it: scion server start --enable-hub --enable-runtime-broker --enable-web --dev-auth --auto-provide --host=127.0.0.1 (see USER-GUIDE.md §Step 5.0)"
  elif echo "$HUB_STATUS_BOOT" | grep -qiE 'Hub endpoint not configured'; then
    fail "Hub endpoint not configured" \
         "scion config set hub.endpoint http://127.0.0.1:8080 --global (see USER-GUIDE.md §Step 5.0)"
  else
    HUB_REACHABLE=1
    if echo "$HUB_STATUS_BOOT" | grep -qE 'Enabled:[[:space:]]+true'; then
      ok "scion hub status: server reachable, Hub Integration Enabled"
    elif echo "$HUB_STATUS_BOOT" | grep -qE 'Enabled:[[:space:]]+false'; then
      fail "Hub reachable but Hub Integration Enabled: false" \
           "scion hub enable --global"
    else
      warn "scion hub status: reachable but did not surface 'Enabled:' line" \
           "Run 'scion hub status --global' manually"
    fi
    [[ $VERBOSE -eq 1 ]] && echo "$HUB_STATUS_BOOT" | sed 's/^/         /' || true
  fi
fi

#############################################################################
# Step 0.5b — Manager UAT (docs/USER-GUIDE.md §Step 0.5b)
#############################################################################
header "Step 0.5b — Manager UAT (bearer token)"

UAT_FILE="$HOME/.scion/manager-pat"
if [[ -f "$UAT_FILE" ]]; then
  ok "UAT file present at $UAT_FILE"

  UAT_MODE="$(stat -f '%Lp' "$UAT_FILE" 2>/dev/null || stat -c '%a' "$UAT_FILE" 2>/dev/null || echo unknown)"
  if [[ "$UAT_MODE" == "600" ]]; then
    ok "UAT file mode is 600"
  else
    fail "UAT file mode should be 600 (have $UAT_MODE)" "chmod 600 $UAT_FILE"
  fi

  if [[ -s "$UAT_FILE" ]]; then
    if [[ $HUB_REACHABLE -eq 0 ]]; then
      warn "skipping bearer-token check — Hub unreachable per Step 0.5a" "fix Step 0.5a first"
    elif command -v scion >/dev/null 2>&1; then
      HUB_STATUS="$(SCION_HUB_TOKEN="$(cat "$UAT_FILE")" scion hub status --global 2>&1 || true)"
      if echo "$HUB_STATUS" | grep -qE 'Method:[[:space:]]+(Bearer token|Dev auth)'; then
        AUTH_MODE="$(echo "$HUB_STATUS" | grep -E 'Method:[[:space:]]+' | head -1 | sed 's/.*Method:[[:space:]]*//; s/[[:space:]]*$//')"
        ok "UAT accepted by Hub — $AUTH_MODE"
      elif echo "$HUB_STATUS" | grep -qiE '(401|unauthorized|expired)'; then
        fail "UAT rejected by Hub (401/expired)" "Re-mint per docs/USER-GUIDE.md §Step 0.5b: scion hub token create --project <project> --expires 1y"
      else
        fail "Hub status did not surface a known auth method" "Re-run 'scion hub status --global' manually; see docs/USER-GUIDE.md §Step 0.5"
      fi
      [[ $VERBOSE -eq 1 ]] && echo "$HUB_STATUS" | sed 's/^/         /' || true
    fi
  else
    fail "UAT file is empty" "Mint per docs/USER-GUIDE.md §Step 0.5b"
  fi
else
  fail "UAT file missing at $UAT_FILE" "Mint per docs/USER-GUIDE.md §Step 0.5b: scion hub token create --project <project> --expires 1y; then echo -n <token> > $UAT_FILE; chmod 600 $UAT_FILE"
fi

#############################################################################
# Step 0.6 — Seed broker harness-configs (docs/USER-GUIDE.md §Step 0.6)
#
# Probes for the four named harness-configs on the local broker. The
# broker resolves the `--harness <named-config>` flag at agent-create
# time against these entries. Without `claude` + `codex` the wave can't
# run (claude=manager+impl workers; codex=cross-model audit).
#############################################################################
header "Step 0.6 — Broker harness-configs (claude/codex/gemini/opencode)"

if ! command -v scion >/dev/null 2>&1; then
  fail "cannot probe harness-configs — scion CLI unavailable" "see Step 0.1 above"
else
  HC_LIST="$(scion harness-config list --global 2>/dev/null || true)"
  for hc in claude codex; do
    if echo "$HC_LIST" | awk '{print $1}' | grep -qx "$hc"; then
      ok "harness-config '$hc' registered"
    else
      fail "harness-config '$hc' missing (REQUIRED)" \
           "scion init --machine --yes  (seeds the four named harness-configs)"
    fi
  done
  for hc in gemini opencode; do
    if echo "$HC_LIST" | awk '{print $1}' | grep -qx "$hc"; then
      ok "harness-config '$hc' registered"
    else
      warn "harness-config '$hc' missing (optional — only needed if engagement uses it)" \
           "scion init --machine --yes  (seeds all four)"
    fi
  done
  [[ $VERBOSE -eq 1 ]] && echo "$HC_LIST" | sed 's/^/         /' || true
fi

#############################################################################
# Step 0.7 — Engagement project-scoped agent templates (docs/USER-GUIDE.md §0.7)
#
# Each agent class is materialized as a Scion template under
# orchestration/scion-templates/<class>/. The Captain installs them into
# THIS engagement's project (NOT the global ~/.scion/templates/) so each
# project has its own fleet, isolated from other engagements.
#
# This step verifies:
#   1. Every directory under orchestration/scion-templates/ is a real
#      template (has scion-agent.yaml + system-prompt.md + agents.md).
#   2. The agent-class-registry references each template by name.
#   3. Templates are installed in the current project.
#
# EXPECTED_TEMPLATES is enumerated from disk so adding a new agent class
# (e.g. mid-engagement, when a Captain registers a frontend or worker
# variant) doesn't require editing this script. After adding a template,
# re-run `scion templates import orchestration/scion-templates/ --all
# --force` per docs/USER-GUIDE.md §0.7.
#############################################################################
header "Step 0.7 — Scion templates (project-scoped agent fleet)"

TEMPLATES_DIR="$PROJECT_ROOT/orchestration/scion-templates"
EXPECTED_TEMPLATES=()
if [[ -d "$TEMPLATES_DIR" ]]; then
  while IFS= read -r -d '' dir; do
    EXPECTED_TEMPLATES+=("$(basename "$dir")")
  done < <(find "$TEMPLATES_DIR" -mindepth 1 -maxdepth 1 -type d -print0 | sort -z)
fi

if [[ ! -d "$TEMPLATES_DIR" ]]; then
  fail "orchestration/scion-templates/ missing" \
       "Check out the engagement repo at the right commit"
else
  for t in "${EXPECTED_TEMPLATES[@]}"; do
    if [[ -f "$TEMPLATES_DIR/$t/scion-agent.yaml" \
       && -f "$TEMPLATES_DIR/$t/system-prompt.md" \
       && -f "$TEMPLATES_DIR/$t/agents.md" ]]; then
      ok "template $t present (scion-agent.yaml + system-prompt.md + agents.md)"
    else
      fail "template $t incomplete or missing" \
           "expected $TEMPLATES_DIR/$t/{scion-agent.yaml,system-prompt.md,agents.md}"
    fi
  done

  if command -v yq >/dev/null 2>&1 \
     && [[ -f "$PROJECT_ROOT/orchestration/ledgers/agent-class-registry.yaml" ]]; then
    REGISTERED="$(yq -r '.classes[].template' "$PROJECT_ROOT/orchestration/ledgers/agent-class-registry.yaml" 2>/dev/null | sort -u)"
    for t in "${EXPECTED_TEMPLATES[@]}"; do
      if echo "$REGISTERED" | grep -qx "$t"; then
        ok "agent-class-registry → template '$t' wired"
      else
        warn "agent-class-registry does not reference template '$t'" \
             "add a 'template: $t' field to the matching class entry"
      fi
    done
  else
    warn "yq missing or agent-class-registry.yaml absent — skipped registry-template cross-check" \
         "see Step 0.1 if yq is missing"
  fi

  if command -v scion >/dev/null 2>&1; then
    INSTALLED="$(scion templates list </dev/null 2>/dev/null | tail -n +2 | awk '{print $1}' || true)"
    PENDING=()
    for t in "${EXPECTED_TEMPLATES[@]}"; do
      if echo "$INSTALLED" | grep -qx "$t"; then
        ok "template $t installed in current project"
      else
        PENDING+=("$t")
      fi
    done
    if [[ ${#PENDING[@]} -gt 0 ]]; then
      warn "${#PENDING[@]} template(s) not yet installed in current project: ${PENDING[*]}" \
           "Run: scion templates import $TEMPLATES_DIR/ --all"
    fi
  fi
fi

#############################################################################
# Step 1.3 — Dependencies installed (pnpm install)
#############################################################################
header "Step 1.3 — Dependencies installed"

if [[ -d "$PROJECT_ROOT/node_modules" ]]; then
  ok "node_modules present"
  if pnpm compose-prompts --help >/dev/null 2>&1; then
    ok "compose-prompts resolves (tsx available)"
  else
    fail "compose-prompts cannot run (tsx not resolving)" "pnpm install"
  fi
else
  fail "node_modules missing" "pnpm install (required for compose-prompts, req-lint, gate-check)"
fi

#############################################################################
# Step 5.0 — Hub runtime readiness (grove linked, env pushed, default harness)
#
# Beyond Phase 0's "is the Hub reachable?" checks, verifies that the Hub
# is actually configured for THIS engagement: grove linked, credentials
# pushed, default harness correct, no stale containers.
#############################################################################
header "Step 5.0 — Hub runtime readiness"

if [[ $HUB_REACHABLE -eq 1 ]] && command -v scion >/dev/null 2>&1; then
  # Grove linked to Hub
  HUB_STATUS_FULL="$(scion hub status </dev/null 2>&1 || true)"
  GROVE_NAME="$(basename "$PROJECT_ROOT")"
  if echo "$HUB_STATUS_FULL" | grep -qE 'Linked:[[:space:]]+yes'; then
    ok "grove linked to Hub"
  elif echo "$HUB_STATUS_FULL" | grep -qE "Grove:.*${GROVE_NAME}"; then
    ok "grove linked to Hub (name match)"
  elif [[ -f "$PROJECT_ROOT/.scion/grove-id" ]]; then
    warn "grove-id exists but Hub reports not linked" \
         "scion hub link --yes --hub http://127.0.0.1:8080 -g \"$PROJECT_ROOT\""
  else
    fail "scion project not initialized in this repo" \
         "cd $PROJECT_ROOT && scion init (creates .scion/grove-id + links to Hub)"
  fi

  # Hub secrets: ANTHROPIC_API_KEY
  HUB_SECRETS="$(scion hub secret list </dev/null 2>/dev/null || true)"
  if echo "$HUB_SECRETS" | grep -qw "ANTHROPIC_API_KEY"; then
    ok "ANTHROPIC_API_KEY in Hub secret store"
  else
    fail "ANTHROPIC_API_KEY not in Hub secret store (containers won't have it)" \
         "scion hub secret set ANTHROPIC_API_KEY \"\$ANTHROPIC_API_KEY\""
  fi

  # Hub env: ANTHROPIC_BASE_URL
  HUB_ENVS="$(scion hub env list </dev/null 2>/dev/null || true)"
  if echo "$HUB_ENVS" | grep -qw "ANTHROPIC_BASE_URL"; then
    ok "ANTHROPIC_BASE_URL in Hub env store"
  else
    warn "ANTHROPIC_BASE_URL not in Hub env store (may be needed for LiteLLM gateway routing)" \
         "scion hub env set ANTHROPIC_BASE_URL \"https://ai-gateway.charliehealth.com/\""
  fi

  # Default harness is claude (not gemini)
  DEFAULT_HARNESS="$(scion config get default_harness_config </dev/null 2>/dev/null || echo unknown)"
  DEFAULT_HARNESS="$(echo "$DEFAULT_HARNESS" | tr -d '[:space:]')"
  if [[ "$DEFAULT_HARNESS" == "claude" ]]; then
    ok "default harness is 'claude'"
  elif [[ "$DEFAULT_HARNESS" == "gemini" ]]; then
    fail "default harness is 'gemini' (workers will prompt for GEMINI_API_KEY)" \
         "scion config set default_harness_config claude"
  else
    warn "default harness is '$DEFAULT_HARNESS' (expected 'claude')" \
         "scion config set default_harness_config claude"
  fi

  # Stale containers
  AGENT_LIST="$(scion list </dev/null 2>/dev/null | tail -n +2 || true)"
  STALE_COUNT="$(echo "$AGENT_LIST" | grep -v '^$' | wc -l | tr -d ' ')"
  if [[ "$STALE_COUNT" -eq 0 || -z "$AGENT_LIST" ]]; then
    ok "no stale agents in this grove"
  else
    RUNNING="$(echo "$AGENT_LIST" | grep -c "running" || true)"
    if [[ "$RUNNING" -gt 0 ]]; then
      ok "$RUNNING agent(s) currently running (manager expected during dispatch)"
    else
      warn "$STALE_COUNT stopped/errored agent(s) in grove" \
           "Clean up with: scion delete <name> (or scion delete --stopped)"
    fi
  fi
else
  if [[ $HUB_REACHABLE -eq 0 ]]; then
    warn "skipping Hub runtime readiness — Hub unreachable (fix Step 0.5a first)" ""
  else
    warn "skipping Hub runtime readiness — scion CLI unavailable" ""
  fi
fi

#############################################################################
# Step 5.1 — Phase 4 artifacts (handoff bundle present + valid)
#
# Verifies the handoff bundle exists: track-meta, composed prompts,
# dispatch kickoff brief, and status.md. Without these the manager has
# nothing to execute.
#############################################################################
header "Step 5.1 — Phase 4 artifacts (handoff bundle)"

TRACK_META_DIR="$PROJECT_ROOT/orchestration/track-meta"
COMPOSED_DIR="$PROJECT_ROOT/orchestration/prompts/composed"
DISPATCH_DIR="$PROJECT_ROOT/orchestration/dispatch"

# Track-meta files
TRACK_META_COUNT="$(find "$TRACK_META_DIR" -name 'w*.yaml' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$TRACK_META_COUNT" -gt 0 ]]; then
  ok "$TRACK_META_COUNT track-meta file(s) in orchestration/track-meta/"
else
  fail "no track-meta files (w*.yaml) in orchestration/track-meta/" \
       "Run Phase 4 to author track-meta for the wave"
fi

# Composed prompts match track-meta
if [[ "$TRACK_META_COUNT" -gt 0 ]]; then
  COMPOSED_COUNT="$(find "$COMPOSED_DIR" -name 'w*.md' 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$COMPOSED_COUNT" -ge "$TRACK_META_COUNT" ]]; then
    ok "$COMPOSED_COUNT composed prompt(s) match track-meta count"
  else
    fail "only $COMPOSED_COUNT composed prompt(s) for $TRACK_META_COUNT track-meta files" \
         "pnpm compose-prompts --track-meta <path> for each missing track"
  fi
fi

# Dispatch kickoff brief
KICKOFF_COUNT="$(find "$DISPATCH_DIR" -name '*-kickoff.md' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$KICKOFF_COUNT" -gt 0 ]]; then
  ok "dispatch kickoff brief present ($KICKOFF_COUNT file(s))"
else
  fail "no dispatch kickoff brief in orchestration/dispatch/" \
       "Author per docs/USER-GUIDE.md Phase 4 step 7"
fi

# status.md
if [[ -f "$PROJECT_ROOT/orchestration/status.md" ]]; then
  ok "orchestration/status.md present"
else
  fail "orchestration/status.md missing" \
       "Initialize per docs/USER-GUIDE.md Phase 4 step 6"
fi

# Composition validation (only if node_modules present)
if [[ -d "$PROJECT_ROOT/node_modules" && "$TRACK_META_COUNT" -gt 0 ]]; then
  COMPOSE_FAIL=0
  while IFS= read -r tm; do
    if ! pnpm compose-prompts --track-meta "$tm" --validate-only >/dev/null 2>&1; then
      COMPOSE_FAIL=$((COMPOSE_FAIL+1))
    fi
  done < <(find "$TRACK_META_DIR" -name 'w*.yaml')
  if [[ $COMPOSE_FAIL -eq 0 ]]; then
    ok "all track-meta validate clean (compose-prompts --validate-only)"
  else
    fail "$COMPOSE_FAIL track-meta file(s) fail composition validation" \
         "Run: for tm in orchestration/track-meta/w*.yaml; do pnpm compose-prompts --track-meta \"\$tm\" --validate-only; done"
  fi
fi

#############################################################################
# Summary
#############################################################################
printf "\n────────────────────────────────────────────────\n"
printf "Phase 0 preflight summary\n"
printf "  passed: %d\n" "$PASS"
printf "  warned: %d\n" "$WARN"
printf "  failed: %d\n" "$FAIL"
printf "────────────────────────────────────────────────\n"

if [[ $FAIL -gt 0 ]]; then
  printf "\nBlocking failures:\n"
  for f in "${FAILURES[@]}"; do printf "  • %s\n" "$f"; done
  printf "\nResolve the failures above; Phase 5 dispatch is NOT safe to attempt.\n"
  exit 1
fi

if [[ $WARN -gt 0 ]]; then
  printf "\nWarnings noted but not blocking. You may proceed to Phase 5 dispatch.\n"
else
  printf "\nAll prerequisites satisfied. Proceed to Phase 5 (docs/USER-GUIDE.md):\n"
  printf "\n  export SCION_HUB_TOKEN=\"\$(cat ~/.scion/manager-pat)\"\n"
  printf "  scion create manager --harness claude \\\\\n"
  printf "      --workspace %s \\\\\n" "$PROJECT_ROOT"
  printf "      -b main\n"
  printf "  scion start manager\n"
  printf "  scion message --raw manager \$'\\\\r'\n"
  printf "  scion message manager \"\$(cat orchestration/prompts/manager-kickoff.md)\"\n"
fi
exit 0
