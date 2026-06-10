#!/usr/bin/env bash
#
# captain-notify — surface an escalation to the human Captain. Use when the
# copilot needs the human's attention (the four escalation classes in the
# captain-copilot skill).
#
# Usage:
#   pnpm captain-notify "title" "body"
#   ./tools/captain-notify/notify.sh "title" "body"
#   ./tools/captain-notify/notify.sh --title "Budget exhausted" \
#       --body "Anthropic rate limit; auth-doctor exit 3" \
#       --severity critical --file orchestration/escalations/2026-06-10-budget.md
#
# Flags (all optional; positional `title body` still works):
#   --title <s>             escalation title
#   --body <s>              escalation detail (decision needed + recommendation)
#   --severity <level>      info | warn | critical   (default: critical)
#   --file <path>           the escalation .md to open from the alert (--escalation alias)
#
# Channels (best-effort; a failure in any one is never fatal):
#   1. Sticky banner — terminal-notifier if present (persists, clickable),
#      else osascript `display notification` (transient fallback). macOS only.
#   2. Persistent modal dialog — osascript `display dialog`, stays until the
#      human clicks. Launched in the BACKGROUND so the agent keeps moving. macOS only.
#   3. stdout — always (the Claude Code conversation/transcript sees this).
#
# Exit: 0 always (best-effort delivery; notification failure is not fatal).

set -uo pipefail

TITLE=""
BODY=""
SEVERITY="critical"
FILE=""

# ── arg parsing: flags in any order, plus legacy positional `title body` ──
POS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)              TITLE="${2:-}"; shift 2 ;;
    --body)               BODY="${2:-}"; shift 2 ;;
    --severity)           SEVERITY="${2:-}"; shift 2 ;;
    --file|--escalation)  FILE="${2:-}"; shift 2 ;;
    -h|--help|help)
      sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --) shift; while [[ $# -gt 0 ]]; do POS+=("$1"); shift; done ;;
    *)  POS+=("$1"); shift ;;
  esac
done
[[ -z "$TITLE" && ${#POS[@]} -ge 1 ]] && TITLE="${POS[0]}"
[[ -z "$BODY"  && ${#POS[@]} -ge 2 ]] && BODY="${POS[1]}"

[[ -z "$TITLE" ]] && TITLE="Captain Escalation"
[[ -z "$BODY"  ]] && BODY="The captain-copilot needs your attention."

# normalise severity → lowercase; anything unknown is treated as critical
SEVERITY="$(printf '%s' "$SEVERITY" | tr '[:upper:]' '[:lower:]')"
case "$SEVERITY" in info|warn|critical) ;; *) SEVERITY="critical" ;; esac

NOW="$(date -u +'%Y-%m-%d %H:%M:%SZ')"

# severity → macOS sound + dialog icon (note | caution | stop)
case "$SEVERITY" in
  info)     SOUND="Glass";     ICON="note" ;;
  warn)     SOUND="Submarine"; ICON="caution" ;;
  critical) SOUND="Sosumi";    ICON="stop" ;;
esac

# escape a string for safe interpolation inside an AppleScript double-quoted
# literal: backslash and double-quote get backslash-escaped; newlines/CRs are
# folded to spaces (display notification/dialog reject raw newlines anyway).
osa_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r' '  '
}

# locate terminal-notifier: prefer one on PATH (brew/system), else the binary
# vendored by the node-notifier devDependency (works after `pnpm install`, no
# brew needed). Checks the repo root's node_modules so it resolves from any cwd.
TN_VENDORED="node-notifier/vendor/mac.noindex/terminal-notifier.app/Contents/MacOS/terminal-notifier"
find_terminal_notifier() {
  if command -v terminal-notifier >/dev/null 2>&1; then
    command -v terminal-notifier; return 0
  fi
  local root; root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  for cand in "$root/node_modules/$TN_VENDORED" "$PWD/node_modules/$TN_VENDORED"; do
    [[ -x "$cand" ]] && { printf '%s' "$cand"; return 0; }
  done
  return 1
}

BANNER="none"
DIALOG="none"

if [[ "$(uname -s)" == "Darwin" ]]; then
  e_title="$(osa_escape "$TITLE")"
  e_body="$(osa_escape "$BODY")"
  e_sev="$(osa_escape "$(printf '%s' "$SEVERITY" | tr '[:lower:]' '[:upper:]')")"

  # ── Channel 1: sticky banner ──
  if TN="$(find_terminal_notifier)"; then
    tn_args=(-title "Captain · $e_sev" -subtitle "$TITLE" -message "$BODY" -sound "$SOUND")
    [[ -n "$FILE" && -e "$FILE" ]] && tn_args+=(-open "file://$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")")
    "$TN" "${tn_args[@]}" >/dev/null 2>&1 && BANNER="terminal-notifier" || BANNER="failed"
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e "display notification \"$e_body\" with title \"$e_title\" subtitle \"$e_sev\" sound name \"$SOUND\"" >/dev/null 2>&1 \
      && BANNER="osascript(transient)" || BANNER="failed"
  fi

  # ── Channel 2: persistent modal dialog (backgrounded so we return now) ──
  if command -v osascript >/dev/null 2>&1; then
    if [[ -n "$FILE" ]]; then
      e_file="$(osa_escape "$FILE")"
      abs_file=""
      [[ -e "$FILE" ]] && abs_file="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"
      e_abs="$(osa_escape "$abs_file")"
      dlg="display dialog \"$e_body\n\nEscalation: $e_file\" with title \"⚓ $e_title\" with icon $ICON buttons {\"Dismiss\", \"Open escalation\"} default button \"Open escalation\""
      # On "Open escalation", reveal the file in Finder (no-op if it doesn't exist).
      script="try
        set r to ($dlg)
        if button returned of r is \"Open escalation\" and \"$e_abs\" is not \"\" then
          tell application \"Finder\" to reveal (POSIX file \"$e_abs\")
          tell application \"Finder\" to activate
        end if
      end try"
    else
      dlg="display dialog \"$e_body\" with title \"⚓ $e_title\" with icon $ICON buttons {\"Acknowledge\"} default button \"Acknowledge\""
      script="try
        $dlg
      end try"
    fi
    ( osascript -e "$script" >/dev/null 2>&1 & ) >/dev/null 2>&1
    DIALOG="bg"
  fi
fi

# ── Channel 3: stdout (always — surfaces in the Claude Code conversation) ──
printf '\n┌─ CAPTAIN ESCALATION ─────────────────────────────────────┐\n'
printf '│ [%s] %s\n' "$(printf '%s' "$SEVERITY" | tr '[:lower:]' '[:upper:]')" "$TITLE"
printf '│ %s\n' "$BODY"
printf '│ %s\n' "$NOW"
[[ -n "$FILE" ]] && printf '│ escalation: %s\n' "$FILE"
printf '└──────────────────────────────────────────────────────────┘\n'
printf 'captain-notify: delivered (banner=%s dialog=%s severity=%s)\n\n' "$BANNER" "$DIALOG" "$SEVERITY"

exit 0
