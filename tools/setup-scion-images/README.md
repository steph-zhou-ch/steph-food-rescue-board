# `tools/setup-scion-images/`

Thin wrapper around the upstream Scion image builder
(`<scion-source>/image-build/scripts/build-images.sh`). Lets a Captain
build the local Scion image set (manager + worker container images)
without remembering the upstream flags.

The wrapper is referenced from
[`docs/USER-GUIDE.md` §Step 0.2](../../docs/USER-GUIDE.md#step-02--set-up-the-local-scion-image-repository)
(Path A — Local Podman build) and from the
`./tools/captain-preflight/check.sh` remediation hint when
`scion-claude:latest` is missing from the local container store.

## Quick start

```bash
# Full build (first time on this laptop; ~15 min single-arch)
./tools/setup-scion-images/build.sh

# Incremental rebuild after a Scion source pull (~5 min)
./tools/setup-scion-images/build.sh --rebuild

# Clone Scion source first if it isn't already present, then build
./tools/setup-scion-images/build.sh --clone

# Preview the resolved upstream command without executing it
./tools/setup-scion-images/build.sh --dry-run
```

## All flags

| Flag | Effect |
|---|---|
| `--rebuild` | Pass `--target common` to the upstream (skip core-base layer) |
| `--clone` | Git-clone `https://github.com/CharlieHealth/scion-ch.git` into the source dir if missing |
| `--dry-run` | Print the resolved upstream command without running it |
| `--scion-source <path>` | Override the Scion source dir (default: `~/projects/scion-ch`; env `SCION_SOURCE_DIR`) |
| `--builder <local-podman\|local-docker>` | Override builder selection (default: podman if present, else docker) |
| `--target <name>` | Override `--target` passed to upstream (default: `all`; `--rebuild` flips to `common`) |
| `-h`, `--help` | Show usage |

## What gets built

Per [`docs/USER-GUIDE.md` §Step 0.2 image hierarchy](../../docs/USER-GUIDE.md#step-02--set-up-the-local-scion-image-repository),
the full set is:

```
core-base          system deps (Go, Node, Python, Git)
  └── scion-base   sciontool binary + non-root scion user (UID 1000)
        ├── scion-claude     ← this engagement uses for manager + workers
        ├── scion-codex      ← needed for code-review-codex audit worker
        ├── scion-gemini
        ├── scion-opencode
        └── scion-hub        (only needed if you self-host the Scion Hub)
```

The minimum image set this engagement needs is `scion-claude:latest`
and `scion-codex:latest` (the cross-model auditor — see
[`docs/SWARM-QUALITY-FRAMEWORK.md` Category G](../../docs/SWARM-QUALITY-FRAMEWORK.md)).
The other harness images are nice-to-have for cross-engagement parity
but not required.

## Verifying the build

```bash
# Logical mapping (harness name → image)
scion harness-config list --global

# Physical presence (image is in the local store)
podman image ls --format '{{.Repository}}:{{.Tag}}' | grep '^scion-'

# End-to-end smoke
./tools/captain-preflight/check.sh
```

Captain preflight `Step 0.2 — Scion images` should report `scion-claude:latest in local podman store` after a successful build.

## Cross-references

- [`docs/USER-GUIDE.md` §Step 0.2](../../docs/USER-GUIDE.md#step-02--set-up-the-local-scion-image-repository) — engagement-level context on the harness image model.
- [`docs/USER-GUIDE.md` Path B / C](../../docs/USER-GUIDE.md#step-02--set-up-the-local-scion-image-repository) — alternative paths (local Docker; pulling from a shared registry).
- Upstream `build-images.sh` source: [https://github.com/CharlieHealth/scion-ch/blob/main/image-build/scripts/build-images.sh](https://github.com/CharlieHealth/scion-ch/blob/main/image-build/scripts/build-images.sh)
