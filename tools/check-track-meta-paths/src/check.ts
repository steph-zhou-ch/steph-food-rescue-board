#!/usr/bin/env -S npx tsx
/**
 * check-track-meta-paths — read-only gate documented in docs/USER-GUIDE.md
 * §Appendix A ("Track-meta path check").
 *
 * Fails the build if any track-meta's `deliverables:` references a path
 * outside the engagement's stack-specific roots:
 *   apps/ · libs/ · migrations/ · tools/ · orchestration/ · contracts/ · docs/
 *
 * Wired into the unified preflight chain
 *   pnpm typecheck && pnpm req-lint && pnpm check-track-meta-paths
 * (docs/USER-GUIDE.md Phase 9 + the meta-gate meta-track in Wave 2+).
 *
 * Output format (per docs/USER-GUIDE.md line 1694):
 *   check-track-meta-paths: track-meta paths OK (M files)
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

// DEFAULT_ALLOWED_ROOTS — the engagement-roots a track-meta deliverable
// may live under. Frontend engagements that ship a shared component
// library or design manifests (e.g. `ui-components/`, `clients/`) should
// either:
//   (a) extend this list in-fork and update the spec, or
//   (b) pass `--allow <root>` per invocation (see CLI below).
// Keep this list tight — every entry widens the surface a worker can
// modify before tripping path-scope.
export const DEFAULT_ALLOWED_ROOTS = [
  "apps/",
  "libs/",
  "migrations/",
  "tools/",
  "orchestration/",
  "contracts/",
  "docs/",
];

export interface Finding {
  file: string;
  level: "error" | "warning";
  rule: string;
  message: string;
}

export interface CheckOptions {
  trackMetaDir: string;
  allowedRoots: string[];
}

export interface CheckResult {
  total_files: number;
  files_with_errors: number;
  findings: Finding[];
}

const TEMPLATE_PREFIX = "_";

function discoverTrackMetas(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".yaml") && !name.startsWith(TEMPLATE_PREFIX))
    .map((name) => join(dir, name))
    .sort();
}

function violatesRoots(p: string, allowedRoots: string[]): boolean {
  if (p.startsWith("/")) return true;
  if (p.startsWith("./")) p = p.slice(2);
  return !allowedRoots.some((root) => p === root.slice(0, -1) || p.startsWith(root));
}

export function checkTrackMetas(options: CheckOptions): CheckResult {
  const files = discoverTrackMetas(options.trackMetaDir);
  const findings: Finding[] = [];
  const filesWithErrors = new Set<string>();
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = parseYaml(readFileSync(file, "utf8"));
    } catch (err) {
      findings.push({
        file,
        level: "error",
        rule: "track-meta-yaml-parse",
        message: `YAML parse error: ${(err as Error).message}`,
      });
      filesWithErrors.add(file);
      continue;
    }
    if (!parsed || typeof parsed !== "object") {
      findings.push({
        file,
        level: "error",
        rule: "track-meta-shape",
        message: "track-meta must be a top-level YAML mapping.",
      });
      filesWithErrors.add(file);
      continue;
    }
    const deliverables = (parsed as { deliverables?: unknown }).deliverables;
    if (!Array.isArray(deliverables)) {
      findings.push({
        file,
        level: "error",
        rule: "deliverables-shape",
        message: "`deliverables:` must be a YAML list.",
      });
      filesWithErrors.add(file);
      continue;
    }
    for (const entry of deliverables) {
      if (typeof entry !== "string") {
        findings.push({
          file,
          level: "error",
          rule: "deliverable-not-string",
          message: `deliverable entry is not a string: ${JSON.stringify(entry)}`,
        });
        filesWithErrors.add(file);
        continue;
      }
      if (violatesRoots(entry, options.allowedRoots)) {
        findings.push({
          file,
          level: "error",
          rule: "deliverable-outside-roots",
          message: `deliverable "${entry}" is not under any of ${options.allowedRoots.join(", ")}.`,
        });
        filesWithErrors.add(file);
      }
    }
  }
  return {
    total_files: files.length,
    files_with_errors: filesWithErrors.size,
    findings,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  trackMetaDir: string;
  allowedRoots: string[];
  help: boolean;
}

const HELP = `check-track-meta-paths — gate that track-meta deliverables stay inside engagement roots

Usage:
  pnpm check-track-meta-paths [--track-meta-dir <dir>] [--allow <root>] [--allow <root>] ...

Options:
  --track-meta-dir <dir>   default: orchestration/track-meta
  --allow <root>           additional allowed root (repeatable; defaults to apps/, libs/, migrations/, tools/, orchestration/, contracts/, docs/)
  -h, --help               show this help

Exit codes:
  0  all track-meta deliverables fall under allowed roots
  1  one or more violations
  2  bad invocation
`;

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    trackMetaDir: "orchestration/track-meta",
    allowedRoots: [...DEFAULT_ALLOWED_ROOTS],
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    const takeNext = () => {
      const next = argv[i + 1];
      if (!next) throw new Error(`${token} requires a value`);
      i++;
      return next;
    };
    if (token === "--track-meta-dir") args.trackMetaDir = takeNext();
    else if (token === "--allow") {
      const root = takeNext();
      const normalized = root.endsWith("/") ? root : `${root}/`;
      args.allowedRoots.push(normalized);
    } else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

function formatHuman(result: CheckResult): string {
  if (result.findings.length === 0) {
    return `check-track-meta-paths: track-meta paths OK (${result.total_files} files)`;
  }
  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  const lines: string[] = [];
  for (const [file, fs] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(file);
    for (const f of fs) {
      lines.push(`  [${f.level}] ${f.rule} — ${f.message}`);
    }
  }
  lines.push("");
  lines.push(
    `check-track-meta-paths: ${result.total_files} files scanned, ${result.files_with_errors} with errors`,
  );
  return lines.join("\n");
}

export function runCli(
  argv: readonly string[],
  stdout: (s: string) => void = (s) => process.stdout.write(s + "\n"),
): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`check-track-meta-paths: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout(HELP);
    return 0;
  }
  const result = checkTrackMetas({
    trackMetaDir: resolve(args.trackMetaDir),
    allowedRoots: args.allowedRoots,
  });
  stdout(formatHuman(result));
  return result.findings.some((f) => f.level === "error") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}
