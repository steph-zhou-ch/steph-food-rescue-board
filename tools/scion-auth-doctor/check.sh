#!/usr/bin/env bash
#
# scion-auth-doctor — verify every harness credential the swarm needs, at BOTH
# user and project scope, AND assert the codex auditor resolves gpt-5.5/xhigh
# (not a silent fallback to a weaker model). Optionally auto-heal drift (--fix)
# and run a live codex spawn probe (--probe).
#
# Why: auth/credential drift was the #1 failure class in the appointment-service
# engagement (~9 of 22 escalations), and codex SILENTLY falling back to
# gpt-5.4/medium was a latent correctness bug the Captain had to police by hand.
# Maps to docs/USER-GUIDE.md §0.4 and the retrospective's P0 #1.
#
# Usage:
#   ./tools/scion-auth-doctor/check.sh           # verify all creds (fast, read-only)
#   ./tools/scion-auth-doctor/check.sh --fix     # + auto-re-register drifted codex secrets from local files
#   ./tools/scion-auth-doctor/check.sh --probe   # + live codex spawn; assert the gpt-5.5 banner (~30s)
#   ./tools/scion-auth-doctor/check.sh -v
#
# Exit: 0 = all healthy · 1 = one or more failures · 2 = bad invocation

set -uo pipefail

PROBE=0; FIX=0; VERBOSE=0
for a in "${@:-}"; do
  case "$a" in
    --probe) PROBE=1 ;;
    --fix) FIX=1 ;;
    -v|--verbose) VERBOSE=1 ;;
    -h|--help|help) sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    ""|--run|run) ;;
    *) echo "unknown flag: $a (try --help)" >&2; exit 2 ;;
  esac
done

PASS=0; FAIL=0; WARN=0; FAILURES=()
ok()   { printf "  [ ok ] %s\n" "$1"; PASS=$((PASS+1)); }
warn() { printf "  [warn] %s\n         → %s\n" "$1" "$2"; WARN=$((WARN+1)); }
fail() { printf "  [fail] %s\n         → %s\n" "$1" "$2"; FAIL=$((FAIL+1)); FAILURES+=("$1"); }
heal() { printf "         ↻ %s\n" "$1"; }
header(){ printf "\n── %s ──────────────────────────────\n" "$1"; }
mode_of(){ stat -f '%Lp' "$1" 2>/dev/null || stat -c '%a' "$1" 2>/dev/null; }
# run a scion command, stripping the dev-auth banner; never fail the pipeline
sc(){ scion "$@" 2>&1 | grep -vE 'WARNING|Development auth' || true; }

SECRETS="$HOME/.scion/secrets.env"
UAT="$HOME/.scion/manager-pat"
CODEX_CONFIG_LOCAL="$HOME/.codex/config.toml"
CODEX_AUTH_LOCAL="$HOME/.codex/auth.json"

############################################################################
header "Hub reachability"
HUB="$(sc hub status)"
if echo "$HUB" | grep -qiE 'Endpoint:'; then
  ok "Hub reachable ($(echo "$HUB" | grep -iE 'Endpoint:' | head -1 | awk '{print $NF}'))"
  GROVE="$(echo "$HUB" | grep -iE '^\s*(Grove|Project):' | head -1 | awk '{print $2}')"
  [[ -n "${GROVE:-}" ]] && ok "Project: $GROVE" || warn "project not resolved" "run from inside the engagement repo"
else
  fail "Hub not reachable" "scion server start --enable-hub --enable-runtime-broker --enable-web --dev-auth --auto-provide --host=127.0.0.1  (docs/USER-GUIDE.md Recovery §R.3)"
fi

############################################################################
header "Local secrets.env (claude + github PAT)"
if [[ -f "$SECRETS" ]]; then
  m="$(mode_of "$SECRETS")"; [[ "$m" == "600" ]] && ok "secrets.env mode 600" || warn "secrets.env mode $m (want 600)" "chmod 600 $SECRETS"
  grep -qE '^ANTHROPIC_API_KEY=' "$SECRETS" && ok "ANTHROPIC_API_KEY in secrets.env" || fail "ANTHROPIC_API_KEY missing from secrets.env" "echo 'ANTHROPIC_API_KEY=<key>' >> $SECRETS"
  grep -qE '^GITHUB_TOKEN=' "$SECRETS"     && ok "GITHUB_TOKEN in secrets.env"     || fail "GITHUB_TOKEN missing from secrets.env"     "printf 'GITHUB_TOKEN=%s\\n' \"\$(gh auth token)\" >> $SECRETS"
else
  fail "secrets.env missing ($SECRETS)" "create with ANTHROPIC_API_KEY + GITHUB_TOKEN (mode 600); see docs/USER-GUIDE.md §0.4"
fi

############################################################################
header "Anthropic (claude harness) — user + project"
A_U="$(sc hub env get ANTHROPIC_API_KEY)"; A_G="$(sc hub env get ANTHROPIC_API_KEY --project)"
echo "$A_U" | grep -qiE 'ANTHROPIC_API_KEY' && ok "ANTHROPIC_API_KEY registered (user scope)"  || warn "ANTHROPIC_API_KEY not at user scope"  "scion hub env set ANTHROPIC_API_KEY=<v> --always --secret"
echo "$A_G" | grep -qiE 'ANTHROPIC_API_KEY' && ok "ANTHROPIC_API_KEY registered (project scope)" || warn "ANTHROPIC_API_KEY not at project scope" "scion hub env set --project ANTHROPIC_API_KEY=<v> --always --secret"

############################################################################
header "Codex auth (cross-model auditor) — api-key OR oauth-file"
SEC_U="$(sc hub secret list)"; SEC_G="$(sc hub secret list --project)"
OAI="$(sc hub env get OPENAI_API_KEY)$(sc hub env get OPENAI_API_KEY --project)"
have_auth=0
echo "$OAI"        | grep -qiE 'OPENAI_API_KEY' && { ok "OPENAI_API_KEY present (api-key path)"; have_auth=1; }
echo "$SEC_U$SEC_G"| grep -qiE 'CODEX_AUTH'     && { ok "CODEX_AUTH file secret present (oauth path)"; have_auth=1; }
if [[ $have_auth -eq 0 ]]; then
  if [[ $FIX -eq 1 && -f "$CODEX_AUTH_LOCAL" ]]; then
    heal "re-registering CODEX_AUTH from $CODEX_AUTH_LOCAL (user + project)"
    scion hub secret set        --type file --target /home/scion/.codex/auth.json CODEX_AUTH @"$CODEX_AUTH_LOCAL" >/dev/null 2>&1
    scion hub secret set --project --type file --target /home/scion/.codex/auth.json CODEX_AUTH @"$CODEX_AUTH_LOCAL" >/dev/null 2>&1
    ok "CODEX_AUTH re-registered"
  else
    fail "no codex auth (neither OPENAI_API_KEY nor CODEX_AUTH)" "register per docs/USER-GUIDE.md §0.4 Path A/B — or --fix (needs ~/.codex/auth.json). Without this, every codex audit stalls."
  fi
fi

############################################################################
header "Codex model pin (gpt-5.5 / xhigh) — the anti-silent-fallback check"
if echo "$SEC_U$SEC_G" | grep -qiE 'CODEX_CONFIG'; then
  ok "CODEX_CONFIG file secret registered"
elif [[ $FIX -eq 1 && -f "$CODEX_CONFIG_LOCAL" ]]; then
  heal "re-registering CODEX_CONFIG from $CODEX_CONFIG_LOCAL (user + project)"
  scion hub secret set        --type file --target /home/scion/.codex/config.toml CODEX_CONFIG @"$CODEX_CONFIG_LOCAL" >/dev/null 2>&1
  scion hub secret set --project --type file --target /home/scion/.codex/config.toml CODEX_CONFIG @"$CODEX_CONFIG_LOCAL" >/dev/null 2>&1
  ok "CODEX_CONFIG re-registered"
else
  fail "CODEX_CONFIG not registered → codex silently uses the harness-default model (gpt-5.4/medium)" "this IS the silent-fallback bug; register per docs/USER-GUIDE.md §0.4, or --fix"
fi
if [[ -f "$CODEX_CONFIG_LOCAL" ]]; then
  MODEL="$(grep -iE '^[[:space:]]*model[[:space:]]*=' "$CODEX_CONFIG_LOCAL" | head -1)"
  EFFORT="$(grep -iE 'reasoning_effort' "$CODEX_CONFIG_LOCAL" | head -1)"
  if echo "$MODEL" | grep -qiE 'gpt-5\.5'; then ok "config pins model gpt-5.5"; else
    if [[ $FIX -eq 1 ]]; then
      heal "rewriting $CODEX_CONFIG_LOCAL → gpt-5.5/xhigh + re-registering"
      printf 'model = "gpt-5.5"\nmodel_reasoning_effort = "xhigh"\n' > "$CODEX_CONFIG_LOCAL"
      scion hub secret set        --type file --target /home/scion/.codex/config.toml CODEX_CONFIG @"$CODEX_CONFIG_LOCAL" >/dev/null 2>&1
      scion hub secret set --project --type file --target /home/scion/.codex/config.toml CODEX_CONFIG @"$CODEX_CONFIG_LOCAL" >/dev/null 2>&1
      ok "model pin healed → gpt-5.5/xhigh"
    else
      fail "config.toml does not pin gpt-5.5 (have: ${MODEL:-none})" "set model = \"gpt-5.5\" in $CODEX_CONFIG_LOCAL (or --fix)"
    fi
  fi
  echo "$EFFORT" | grep -qiE 'xhigh' && ok "config pins reasoning xhigh" || warn "reasoning_effort not xhigh (have: ${EFFORT:-none})" "set model_reasoning_effort = \"xhigh\""
else
  warn "no local ~/.codex/config.toml to verify the model pin" "printf 'model = \"gpt-5.5\"\\nmodel_reasoning_effort = \"xhigh\"\\n' > $CODEX_CONFIG_LOCAL"
fi

############################################################################
header "Manager token (UAT)"
if [[ -f "$UAT" ]]; then
  m="$(mode_of "$UAT")"; [[ "$m" == "600" ]] && ok "manager-pat present, mode 600" || warn "manager-pat mode $m (want 600)" "chmod 600 $UAT"
else
  warn "manager-pat missing ($UAT)" "dev-auth (local) hubs don't need it; prod-auth hubs: mint per docs/USER-GUIDE.md §0.5b"
fi

############################################################################
if [[ $PROBE -eq 1 ]]; then
  header "Codex live spawn probe"
  P="auth-doctor-cr-probe"
  scion delete "$P" --yes >/dev/null 2>&1 || true
  if scion create "$P" -t code-review-codex --harness codex -b main >/dev/null 2>&1 && scion start "$P" >/dev/null 2>&1; then
    sleep 18
    L="$(sc look "$P")"
    if   echo "$L" | grep -qiE 'gpt-5\.5'; then ok "codex probe resolved gpt-5.5 ✓"
    elif echo "$L" | grep -qiE 'gpt-5\.4|gpt-4|gpt-5\.3'; then fail "codex probe resolved the WRONG model (silent fallback)" "CODEX_CONFIG not taking effect; --fix then re-probe"
    else warn "codex probe banner inconclusive" "scion look $P  (then: scion delete $P --yes)"; fi
  else
    fail "codex probe failed to start (auth resolution)" "see docs/USER-GUIDE.md Gotcha 7 / §0.4; try --fix"
  fi
  scion delete "$P" --yes >/dev/null 2>&1 || true
fi

############################################################################
header "Summary"
printf "  %d ok · %d warn · %d fail\n" "$PASS" "$WARN" "$FAIL"
if [[ $FAIL -gt 0 ]]; then
  printf "\n  Action items:\n"; for f in "${FAILURES[@]}"; do printf "    • %s\n" "$f"; done
  [[ $FIX -eq 0 ]] && printf "\n  Tip: re-run with --fix to auto-re-register drifted codex secrets from local files.\n"
  exit 1
fi
printf "  ✓ all harness credentials healthy%s\n" "$([[ $PROBE -eq 0 ]] && echo " (add --probe for a live codex model assertion)" || true)"
exit 0
