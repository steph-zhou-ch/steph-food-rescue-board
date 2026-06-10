#!/usr/bin/env bash
#
# orchestration/gates/gate-check.sh — synchronization gate runner
#
# Doc-stable entry point referenced from:
#   - docs/USER-GUIDE.md §Appendix A "Wave gate-check" + §Phase 6 / §Phase 7
#   - orchestration/prompts/manager-kickoff.md §"Lifecycle Step 8"
#   - package.json `gate-check` script
#
# This is a thin shim that execs the TypeScript implementation at
# tools/gate-check/src/run.ts via tsx. Keeping the entry point as a .sh
# at this path means the doc-referenced command stays stable even if
# the implementation language changes.
#
# Usage:
#   ./orchestration/gates/gate-check.sh <gate-id>
#   ./orchestration/gates/gate-check.sh --list
#   ./orchestration/gates/gate-check.sh --help

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

exec npx --prefix "$REPO_ROOT" tsx "$REPO_ROOT/tools/gate-check/src/run.ts" "$@"
