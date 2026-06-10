#!/usr/bin/env bash
#
# tools/setup-scion-images/build.sh — wrapper around the upstream Scion
# image builder.
#
# Doc-stable entry point referenced from docs/USER-GUIDE.md §Step 0.2 (Path A).
# Captain preflight's `scion-claude:latest not in local podman/docker
# store` remediation hint points here.
#
# What it does:
#   • Locates the Scion source clone at ~/projects/scion-ch (override via
#     --scion-source <path> or env SCION_SOURCE_DIR).
#   • Detects the container runtime (podman preferred, docker fallback).
#   • Shells out to <scion-source>/image-build/scripts/build-images.sh
#     with the right --builder + --target flags.
#
# Modes:
#   (no args)         equivalent to --target all (full DAG build, ~15 min)
#   --rebuild         equivalent to --target common (skip core-base, ~5 min)
#   --clone           git-clone https://github.com/CharlieHealth/scion-ch.git into
#                     <scion-source> if missing, then build full
#   --dry-run         print the resolved command without executing it
#   --scion-source X  override the Scion source directory
#   --builder X       override the builder (local-podman | local-docker)
#   --target X        override --target (passes through to upstream)
#   --help / -h       show this usage
#
# Exit codes:
#   0  build succeeded (or dry-run completed)
#   2  bad invocation / missing prerequisite
#   *  whatever the upstream builder returns on failure

set -euo pipefail

usage() {
  sed -n '3,32p' "$0" | sed 's/^# \{0,1\}//' >&2
}

SCION_SOURCE="${SCION_SOURCE_DIR:-$HOME/projects/scion}"
BUILDER=""
TARGET="all"
CLONE=0
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild)
      TARGET="common"
      ;;
    --clone)
      CLONE=1
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --scion-source)
      shift
      [[ $# -gt 0 ]] || { echo "build.sh: --scion-source requires a path" >&2; exit 2; }
      SCION_SOURCE="$1"
      ;;
    --scion-source=*)
      SCION_SOURCE="${1#--scion-source=}"
      ;;
    --builder)
      shift
      [[ $# -gt 0 ]] || { echo "build.sh: --builder requires a value" >&2; exit 2; }
      BUILDER="$1"
      ;;
    --builder=*)
      BUILDER="${1#--builder=}"
      ;;
    --target)
      shift
      [[ $# -gt 0 ]] || { echo "build.sh: --target requires a value" >&2; exit 2; }
      TARGET="$1"
      ;;
    --target=*)
      TARGET="${1#--target=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "build.sh: unknown argument: $1" >&2
      usage
      exit 2
      ;;
  esac
  shift
done

# ---------- detect runtime / pick builder ----------
if [[ -z "$BUILDER" ]]; then
  if command -v podman >/dev/null 2>&1; then
    BUILDER="local-podman"
  elif command -v docker >/dev/null 2>&1; then
    BUILDER="local-docker"
  else
    echo "build.sh: neither podman nor docker on PATH; install one or pass --builder explicitly" >&2
    exit 2
  fi
fi

# ---------- locate / clone Scion source ----------
if [[ ! -d "$SCION_SOURCE/.git" ]]; then
  if [[ $CLONE -eq 1 ]]; then
    echo "build.sh: cloning Scion source into $SCION_SOURCE …"
    if [[ $DRY_RUN -eq 1 ]]; then
      echo "  (dry-run) git clone https://github.com/CharlieHealth/scion-ch.git $SCION_SOURCE"
    else
      git clone https://github.com/CharlieHealth/scion-ch.git "$SCION_SOURCE"
    fi
  else
    echo "build.sh: Scion source not found at $SCION_SOURCE" >&2
    echo "         pass --clone to git-clone it from https://github.com/CharlieHealth/scion-ch.git" >&2
    echo "         or set --scion-source / SCION_SOURCE_DIR to an existing checkout" >&2
    exit 2
  fi
fi

UPSTREAM="$SCION_SOURCE/image-build/scripts/build-images.sh"
if [[ ! -x "$UPSTREAM" ]]; then
  echo "build.sh: upstream builder not found or not executable at $UPSTREAM" >&2
  echo "         is $SCION_SOURCE a complete Scion source checkout?" >&2
  exit 2
fi

# ---------- run / preview ----------
CMD=("$UPSTREAM" "--builder" "$BUILDER" "--target" "$TARGET")
echo "build.sh: ${CMD[*]}"
if [[ $DRY_RUN -eq 1 ]]; then
  echo "  (dry-run) skipped — pass without --dry-run to execute"
  exit 0
fi
exec "${CMD[@]}"
