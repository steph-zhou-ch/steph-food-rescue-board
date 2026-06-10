#!/usr/bin/env bash
#
# captain-status — one-glance, git-reconciled status of the swarm.
#
# Replaces "what's the status?" conversational polling (the loudest signal in
# the engagement retrospective: asked 30+ times, ~52% of manager interaction).
# Reads the TRUTH from origin/main — trunk tip + age, the status board, in-flight
# impl tracks, recent escalations + their status — and the live scion container
# state. Fast (~1-2s): a single fetch + a handful of git reads, no audit fan-out.
#
# Maps to the retrospective's P0 #2.
#
# Usage:  ./tools/captain-status/status.sh [-v]
# Exit:   0 always (informational)

set -uo pipefail
TRUNK="origin/main"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 0

b(){ printf "\033[1m%s\033[0m" "$1"; }
hr(){ printf '─%.0s' {1..64}; printf '\n'; }
sc(){ scion "$@" 2>&1 | grep -vE 'WARNING|Development auth' || true; }

if ! git fetch origin --prune --quiet 2>/dev/null; then
  printf "  (offline — showing last-known local refs)\n"
fi

tip="$(git log -1 --format='%h' "$TRUNK" 2>/dev/null || echo '?')"
subj="$(git log -1 --format='%s' "$TRUNK" 2>/dev/null | cut -c1-72)"
when="$(git log -1 --format='%cr' "$TRUNK" 2>/dev/null || echo '?')"
ct="$(git log -1 --format='%ct' "$TRUNK" 2>/dev/null || date +%s)"
age_min=$(( ( $(date +%s) - ct ) / 60 ))

SB="$(git show "$TRUNK:orchestration/status.md" 2>/dev/null || true)"
phase="$(echo "$SB" | grep -m1 -iE '^>[[:space:]]*Phase:' | sed -E 's/^>[[:space:]]*//')"
state="$(echo "$SB" | grep -m1 -iE 'Current state:' | sed -E 's/.*Current state:[[:space:]]*`?//; s/`.*//' | cut -c1-220)"

printf "\n"; hr
printf "  %s   ·   %s\n" "$(b 'SWARM STATUS')" "$(date -u +'%Y-%m-%d %H:%M:%SZ')"
hr
printf "  %s  %s  %s\n" "$(b 'Trunk')" "$tip" "$subj"
printf "  %s  %s" "$(b 'Last push')" "$when"
if [[ $age_min -ge 30 ]]; then printf "   ⚠ %dm since last trunk advance\n" "$age_min"; else printf "\n"; fi
[[ -n "$phase" ]] && printf "  %s\n" "$phase"
[[ -n "$state" ]] && printf "  %s %s…\n" "$(b 'State')" "$state"

# ── in-flight impl tracks: unmerged, non-auditor branches ahead of trunk ──
printf "\n  %s\n" "$(b 'In-flight tracks')"
n=0
while read -r br; do
  [[ -z "$br" ]] && continue
  t="${br#origin/swarm/}"
  case "$t" in *spec-adherence*|*code-review-codex*|audit/*) continue;; esac
  # skip branches whose wave already closed (rebased/squashed tips read as
  # "ahead" by raw ancestry even though the work merged): authoritative via the
  # wave's closure report on trunk.
  wn="$(printf '%s' "$t" | grep -oE 'w[0-9]+' | head -1 | tr -dc '0-9')"
  [[ -n "$wn" ]] && git cat-file -e "$TRUNK:orchestration/reports/w${wn}-closure.md" 2>/dev/null && continue
  ahead="$(git rev-list --count "$br" ^"$TRUNK" 2>/dev/null || echo 0)"
  [[ "${ahead:-0}" -eq 0 ]] && continue
  mark=""
  git log "$br" ^"$TRUNK" --format='%s' 2>/dev/null | grep -qE "\[(fix-)?complete:$t\]" && mark="  ✓ complete-marker"
  printf "    • %-44s +%-3s commits%s\n" "$t" "$ahead" "$mark"
  n=$((n+1))
done < <(git for-each-ref --no-merged="$TRUNK" --format='%(refname:short)' refs/remotes/origin/swarm/ 2>/dev/null)
[[ $n -eq 0 ]] && printf "    (none — no impl tracks in flight)\n"

# ── recent escalations + status ──
printf "\n  %s\n" "$(b 'Recent escalations')"
e=0
while read -r f; do
  [[ -z "$f" ]] && continue
  st="$(git show "$TRUNK:$f" 2>/dev/null | grep -m1 -iE '^Status:|status:' | sed -E 's/.*[Ss]tatus:[[:space:]]*//' | cut -c1-24)"
  printf "    • [%-10s] %s\n" "${st:-?}" "$(basename "$f")"
  e=$((e+1))
done < <(git ls-tree -r --name-only "$TRUNK" orchestration/escalations/ 2>/dev/null | grep -E '/20[0-9].*\.md$' | sort | tail -5)
[[ $e -eq 0 ]] && printf "    (none)\n"

# ── scion containers (manager + active workers) ──
printf "\n  %s\n" "$(b 'Containers')"
SL="$(sc list)"
if echo "$SL" | grep -qE '^manager[[:space:]]'; then
  echo "$SL" | awk '$1=="manager" || $1 ~ /^w[0-9]+-/ { printf "    • %-44s %s\n", $1, $7 }' | head -12
else
  printf "    (scion/hub not reachable — run: pnpm auth-doctor)\n"
fi
hr
printf "\n"
