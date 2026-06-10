#!/usr/bin/env bash
#
# tools/captain-authority/check.sh — Captain/swarm authority guardrail.
#
# Wired as a PreToolUse(Bash) hook in .claude/settings.local.json (see
# docs/USER-GUIDE.md §Step 0.8). Reads the proposed Bash command from the
# hook's JSON stdin and BLOCKS (exit 2) any attempt to talk directly to a
# wave-worker agent — i.e. `scion message|start|delete <wN-...>`.
#
# The intent (USER-GUIDE.md §Step 0.8 + Phase 6 "do not grab the keyboard"):
# nudging the manager and reading swarm state stay frictionless; issuing
# worker-directed lifecycle commands requires a conscious choice to disable
# this hook. That pause is the point.
#
# ALLOWED (never blocked):
#   scion message manager ...      scion list      scion look ...
#   scion logs ...                 any non-scion command
#
# BLOCKED (exit 2):
#   scion message  w<N>-<slug> ...
#   scion start    w<N>-<slug> ...
#   scion delete   w<N>-<slug> ...
#   scion rm       w<N>-<slug> ...   (rm is delete's alias)
#
# Worker slug pattern is `w<digits>-` per USER-GUIDE.md Appendix D
# (wave-scoped track ids: w1-domain-slots, w2-app-..., etc.).
#
# Exit codes:
#   0  allow the command
#   2  block the command (stderr is surfaced to the agent as the reason)

set -euo pipefail

# The hook delivers a JSON object on stdin: {"tool_name":...,
# "tool_input":{"command":"..."}}. Extract the command string. python3 is
# already a hook dependency in this repo (.claude/settings.json Stop hook),
# so rely on it rather than jq.
cmd="$(python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)  # unparseable stdin -> do not block
print(data.get("tool_input", {}).get("command", ""))
' 2>/dev/null || true)"

# Nothing to inspect -> allow.
[ -z "$cmd" ] && exit 0

# Block scion (message|start|delete|rm) targeting a wave-worker slug.
# Tolerates arbitrary whitespace and leading words in a compound command
# (e.g. `cd foo && scion message w1-... "..."`).
if printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])scion[[:space:]]+(message|start|delete|rm)[[:space:]]+w[0-9]+-'; then
  cat >&2 <<'MSG'
BLOCKED by tools/captain-authority/check.sh (USER-GUIDE.md §Step 0.8).

You tried to issue a worker-directed `scion` lifecycle command. During a
wave, the Captain does NOT talk to workers directly — that is the manager's
job, and all application work goes through the swarm.

If this is a deliberate, authorized exception, disable this hook in
.claude/settings.local.json, run the command, then re-enable it.

Allowed without disabling: `scion message manager ...`, `scion list`,
`scion look ...`, `scion logs ...`.
MSG
  exit 2
fi

exit 0
