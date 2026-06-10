#!/usr/bin/env bash
#
# manager-watchdog — keep the swarm manager alive without a human hand-driving
# nudges. Detects a TRUE manager stall and auto-remediates down a codified ladder.
#
# Pairs with manager-kickoff.md §5a: the manager emits a `swarm/manager-pulse`
# every poll cycle, so a stale pulse == a real stall — no "is it just thinking?"
# guessing (the false-positive that plagued the hand-rolled watchdog-v3).
#
# Detection (a stall requires ALL of):
#   • manager phase == running (else it's down → restart)
#   • NOT in an active terminal state (thinking/executing/compacting/baking)
#   • pulse stale ≥ --stall-min  (or, if no pulse branch, trunk stale ≥ --stall-min)
# Blocking signatures short-circuit: TUI/trust prompt → dismiss; rate-limit/auth → ESCALATE.
#
# Remediation ladder (skipped under --dry-run):
#   nudge (--interrupt, ack-required) → if still stalled: safe restart (-t default)
#   TUI/trust prompt → --raw Enter
#   rate-limit / auth → DO NOT restart; surface to the human (exit 3)
#
# Usage:
#   pnpm manager-watchdog                    # run the loop (10-min interval)
#   pnpm manager-watchdog --once             # one check + remediate, then exit
#   pnpm manager-watchdog --once --dry-run   # detect only; print what it WOULD do
#   pnpm manager-watchdog --restart          # codified safe restart now (per-wave reset), then exit
#   pnpm manager-watchdog --interval 300 --stall-min 12 --agent manager -v
#
# Exit: 0 = healthy/handled · 3 = escalation needs a human · 2 = bad invocation

set -uo pipefail

AGENT="${MANAGER_AGENT:-manager}"; TRUNK="origin/main"; PULSE="swarm/manager-pulse"
INTERVAL=600; STALL_MIN=15; ONCE=0; DRYRUN=0; DO_RESTART=0; VERBOSE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --once) ONCE=1 ;;
    --dry-run) DRYRUN=1 ;;
    --restart) DO_RESTART=1; ONCE=1 ;;
    --interval) INTERVAL="${2:?}"; shift ;;
    --stall-min) STALL_MIN="${2:?}"; shift ;;
    --agent) AGENT="${2:?}"; shift ;;
    -v|--verbose) VERBOSE=1 ;;
    -h|--help|help) sed -n '3,28p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $1 (try --help)" >&2; exit 2 ;;
  esac
  shift
done

cd "$(cd "$(dirname "$0")/../.." && pwd)" || exit 2
log(){ printf '[watchdog %s] %s\n' "$(date -u +%H:%M:%SZ)" "$1"; }
sc(){ scion "$@" 2>&1 | grep -vE 'WARNING|Development auth' || true; }
mins_since(){ echo $(( ( $(date +%s) - ${1:-$(date +%s)} ) / 60 )); }

ACTIVE_RE='thinking|executing|compact|[Bb]aking|Running…|esc to interrupt|tokens ·|↑ |↓ '
TUI_RE='Press enter|Do you want to proceed|trust (this|the )|approval policy|Switch to gpt|paste again to expand|Welcome back'
RATE_RE='usage limit|rate.?limit|Credit balance|quota|insufficient_quota|overloaded'
AUTH_RE='hub rejected auth|auth resolution failed|\b401\b|unauthor|invalid api key'

ESCALATE=0

safe_restart(){   # the codified per-wave / recovery restart (encodes the -t default gotcha)
  log "RESTART → scion stop $AGENT && scion start $AGENT -t default + resume"
  [[ $DRYRUN -eq 1 ]] && { log "(dry-run) would restart + resume from status.md"; return 0; }
  scion stop "$AGENT" --yes >/dev/null 2>&1 || true
  scion start "$AGENT" -t default >/dev/null 2>&1 || scion start "$AGENT" >/dev/null 2>&1
  sleep 8
  scion message --raw "$AGENT" $'\r' >/dev/null 2>&1 || true     # dismiss any trust dialog
  scion message --interrupt "$AGENT" \
    "[watchdog $(date -u +%H:%MZ)] You were restarted to clear a stall. Resume from current state: git fetch origin, re-derive the in-flight wave/batch from orchestration/status.md, continue driving, and resume emitting swarm/manager-pulse each poll cycle. Do not assume any prior in-flight op is still live." >/dev/null 2>&1 || true
  log "RESTART done; resume message sent"
}

remediate(){      # $1 = entry rung: nudge | raw | restart
  case "$1" in
    raw)
      [[ $DRYRUN -eq 1 ]] && { log "(dry-run) would send --raw Enter to dismiss the prompt"; return; }
      scion message --raw "$AGENT" $'\r' >/dev/null 2>&1 || true
      log "sent Enter (--raw) to dismiss the blocking prompt"
      ;;
    nudge)
      [[ $DRYRUN -eq 1 ]] && { log "(dry-run) would --interrupt nudge, then restart if still stalled"; return; }
      scion message --interrupt "$AGENT" \
        "[watchdog $(date -u +%H:%MZ)] No forward progress detected. Reply with a one-line status and resume driving: poll in-flight tracks, re-message any late auditor, emit a swarm/manager-pulse. If genuinely blocked, file an escalation." >/dev/null 2>&1 || true
      log "nudged (--interrupt); waiting 60s for recovery"
      sleep 60
      git fetch origin --prune --quiet 2>/dev/null || true
      if sc look "$AGENT" | tail -15 | grep -qiE "$ACTIVE_RE"; then log "recovered after nudge (now active)"; return; fi
      if git rev-parse --verify -q "origin/$PULSE" >/dev/null 2>&1; then
        local pa; pa="$(mins_since "$(git log -1 --format=%ct "origin/$PULSE" 2>/dev/null || echo 0)")"
        [[ "$pa" -lt "$STALL_MIN" ]] && { log "recovered after nudge (fresh pulse ${pa}m)"; return; }
      fi
      log "still stalled after nudge → escalating to restart"
      safe_restart
      ;;
    restart) safe_restart ;;
  esac
}

check(){
  ESCALATE=0
  git fetch origin --prune --quiet 2>/dev/null || log "(offline — using last-known refs)"
  # Stand down on a closed engagement — an idle manager after task_completed is
  # correct, not a stall. Nothing to watch until the next wave is dispatched.
  local _sb; _sb="$(git show "$TRUNK:orchestration/status.md" 2>/dev/null || true)"
  if grep -qiE 'ENGAGEMENT-?COMPLETE' <<<"$_sb"; then
    [[ $VERBOSE -eq 1 ]] && log "engagement complete — standing down (no wave in flight)" || true
    return 0
  fi
  local trunk_age pulse_age phase look
  trunk_age="$(mins_since "$(git log -1 --format=%ct "$TRUNK" 2>/dev/null || echo "$(date +%s)")")"
  if git rev-parse --verify -q "origin/$PULSE" >/dev/null 2>&1; then
    pulse_age="$(mins_since "$(git log -1 --format=%ct "origin/$PULSE" 2>/dev/null || echo "$(date +%s)")")"
  else
    pulse_age=-1
  fi
  phase="$(sc list | awk -v a="$AGENT" '$1==a{print $7}' | head -1)"
  look="$(sc look "$AGENT" | tail -25)"
  [[ $VERBOSE -eq 1 ]] && log "trunk_age=${trunk_age}m pulse_age=${pulse_age}m phase=${phase:-?}"

  if [[ -z "$phase" ]]; then log "manager not in scion list (hub down? run pnpm auth-doctor)"; return 0; fi
  if [[ "$phase" != "running" ]]; then log "STALL: manager phase=$phase (not running)"; remediate restart; return; fi

  if echo "$look" | grep -qiE "$RATE_RE"; then log "ESCALATE: rate-limit/usage signature — NOT restarting (credit state must change first)"; ESCALATE=1; return; fi
  if echo "$look" | grep -qiE "$AUTH_RE"; then log "ESCALATE: auth signature — run 'pnpm auth-doctor --fix'; NOT restarting"; ESCALATE=1; return; fi
  if echo "$look" | grep -qiE "$TUI_RE"; then log "STALL: TUI/trust prompt blocking forward progress"; remediate raw; return; fi

  if echo "$look" | grep -qiE "$ACTIVE_RE"; then [[ $VERBOSE -eq 1 ]] && log "manager active (thinking/executing) — healthy"; return 0; fi

  local stalled=0
  if [[ "$pulse_age" -ge 0 ]]; then [[ "$pulse_age" -ge "$STALL_MIN" ]] && stalled=1
  else [[ "$trunk_age" -ge "$STALL_MIN" ]] && stalled=1; fi
  if [[ $stalled -eq 1 ]]; then
    log "STALL: no pulse/progress ≥${STALL_MIN}m and not in an active state — remediating"
    remediate nudge
  else
    [[ $VERBOSE -eq 1 ]] && log "healthy (recent pulse/progress)" || true
  fi
}

if [[ $DO_RESTART -eq 1 ]]; then safe_restart; exit 0; fi
if [[ $ONCE -eq 1 ]]; then check; [[ $ESCALATE -eq 1 ]] && exit 3 || exit 0; fi
log "watchdog started (agent=$AGENT interval=${INTERVAL}s stall=${STALL_MIN}m). Ctrl-C to stop."
while true; do check; sleep "$INTERVAL"; done
