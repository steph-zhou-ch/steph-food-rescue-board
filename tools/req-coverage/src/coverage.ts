#!/usr/bin/env -S npx tsx
/**
 * req-coverage — REQ catalog → tagged-test coverage validator.
 *
 * Asserts every acceptance criterion at or above the gated severity
 * level (default: critical, high) has at least one
 *   describe('@req <REQ-ID> @criterion <criterion-id>', …)
 * -tagged vitest test under apps/, libs/, or contracts/.
 *
 * Surfaces two finding kinds:
 *   - coverage-missing : criterion has no matching tagged test
 *   - test-drift       : test tag references a REQ-id or criterion-id
 *     that isn't in the catalog (broken tag)
 *
 * Referenced from requirements/README.md ("How to use these" step 4)
 * and docs/typescript-swarm-playbook.md §"TDD discipline".
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

export type FindingLevel = "error" | "warning";
export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  file: string;
  line?: number;
  level: FindingLevel;
  rule: string;
  message: string;
}

export interface CriterionEntry {
  reqId: string;
  criterionId: string;
  severity: Severity;
  reqFile: string;
}

export interface TestTag {
  file: string;
  line: number;
  reqId: string;
  criterionId: string;
}

export interface CoverageOptions {
  catalogDir: string;
  testRoots: string[];
  gatedSeverities: Severity[];
}

export interface CoverageResult {
  catalog_dir: string;
  total_criteria: number;
  gated_criteria: number;
  total_test_tags: number;
  uncovered_criteria: number;
  drifted_tags: number;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Catalog discovery
// ---------------------------------------------------------------------------

const REQ_FILENAME = /^REQ-[A-Z]+-[A-Z0-9-]+\.md$/;
const SEVERITY_VALUES: ReadonlySet<Severity> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);
const DEFAULT_GATED: Severity[] = ["critical", "high"];

function discoverReqFiles(catalogDir: string): { reqId: string; filePath: string }[] {
  const out: { reqId: string; filePath: string }[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(catalogDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(catalogDir, e.name);
    if (e.isFile() && REQ_FILENAME.test(e.name)) {
      out.push({ reqId: e.name.replace(/\.md$/, ""), filePath: full });
    } else if (e.isDirectory() && /^REQ-[A-Z]+-[A-Z0-9-]+$/.test(e.name)) {
      try {
        statSync(join(full, "index.md"));
        out.push({ reqId: e.name, filePath: join(full, "index.md") });
      } catch {
        // missing index — req-lint flags this; we silently skip here
      }
    }
  }
  return out;
}

function extractCriteria(reqId: string, reqFile: string): CriterionEntry[] {
  const out: CriterionEntry[] = [];
  let content: string;
  try {
    content = readFileSync(reqFile, "utf8");
  } catch {
    return out;
  }

  // Frontmatter REQ-level severity (used as fallback when a criterion
  // omits its own severity).
  let reqSeverity: Severity = "medium";
  const fm = content.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    try {
      const parsed = parseYaml(fm[1] ?? "") as Record<string, unknown> | null;
      const s = parsed?.severity;
      if (typeof s === "string" && SEVERITY_VALUES.has(s as Severity)) {
        reqSeverity = s as Severity;
      }
    } catch {
      // ignore
    }
  }

  // Find every fenced yaml block; pick out the criterion mapping.
  const fence = /```yaml\n([\s\S]*?)\n```/g;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(content)) !== null) {
    const block = match[1] ?? "";
    let parsed: unknown;
    try {
      parsed = parseYaml(block);
    } catch {
      continue;
    }
    const criterion = (parsed as { criterion?: Record<string, unknown> } | null)?.criterion;
    if (!criterion || typeof criterion !== "object") continue;
    const id = criterion.id;
    if (typeof id !== "string" || id.length === 0) continue;
    const cs = criterion.severity;
    const severity: Severity =
      typeof cs === "string" && SEVERITY_VALUES.has(cs as Severity)
        ? (cs as Severity)
        : reqSeverity;
    out.push({ reqId, criterionId: id, severity, reqFile });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Test discovery + tag extraction
// ---------------------------------------------------------------------------

const TEST_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "build", "coverage", ".vitest"]);

function isTestFile(name: string): boolean {
  if (!name.includes(".spec.") && !name.includes(".test.")) return false;
  const ext = extname(name);
  return TEST_EXTENSIONS.has(ext);
}

function walkTestFiles(root: string): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        stack.push(join(dir, e.name));
      } else if (e.isFile() && isTestFile(e.name)) {
        out.push(join(dir, e.name));
      }
    }
  }
  return out.sort();
}

const TAG_REGEX = /@req\s+(REQ-[A-Z]+-[A-Z0-9-]+)\s+@criterion\s+([A-Za-z0-9][A-Za-z0-9-]*)/g;

function extractTags(testFile: string): TestTag[] {
  let content: string;
  try {
    content = readFileSync(testFile, "utf8");
  } catch {
    return [];
  }
  const tags: TestTag[] = [];
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(content)) !== null) {
    const reqId = match[1] ?? "";
    const criterionId = match[2] ?? "";
    const upToMatch = content.slice(0, match.index);
    const line = (upToMatch.match(/\n/g)?.length ?? 0) + 1;
    tags.push({ file: testFile, line, reqId, criterionId });
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function runCoverage(options: CoverageOptions): CoverageResult {
  const findings: Finding[] = [];
  const catalogDir = resolve(options.catalogDir);
  const reqFiles = discoverReqFiles(catalogDir);
  const criteria: CriterionEntry[] = [];
  for (const r of reqFiles) {
    criteria.push(...extractCriteria(r.reqId, r.filePath));
  }
  const criteriaByKey = new Map<string, CriterionEntry>();
  for (const c of criteria) {
    criteriaByKey.set(`${c.reqId}::${c.criterionId}`, c);
  }

  const testFiles: string[] = [];
  for (const root of options.testRoots) {
    const abs = resolve(root);
    testFiles.push(...walkTestFiles(abs));
  }
  const allTags: TestTag[] = [];
  for (const tf of testFiles) {
    allTags.push(...extractTags(tf));
  }
  const tagsByKey = new Map<string, TestTag[]>();
  for (const t of allTags) {
    const key = `${t.reqId}::${t.criterionId}`;
    const arr = tagsByKey.get(key) ?? [];
    arr.push(t);
    tagsByKey.set(key, arr);
  }

  const gated = new Set(options.gatedSeverities);
  let uncovered = 0;
  let gatedCount = 0;
  for (const c of criteria) {
    if (!gated.has(c.severity)) continue;
    gatedCount++;
    const key = `${c.reqId}::${c.criterionId}`;
    if (!tagsByKey.has(key)) {
      uncovered++;
      findings.push({
        file: c.reqFile,
        level: "error",
        rule: "coverage-missing",
        message: `${c.severity} criterion "${c.reqId}::${c.criterionId}" has no \`@req ${c.reqId} @criterion ${c.criterionId}\`-tagged test.`,
      });
    }
  }

  // Drift detection: tagged tests that don't resolve to a known criterion
  let drifted = 0;
  for (const t of allTags) {
    const key = `${t.reqId}::${t.criterionId}`;
    if (!criteriaByKey.has(key)) {
      drifted++;
      findings.push({
        file: t.file,
        line: t.line,
        level: "warning",
        rule: "test-drift",
        message: `test tag references unknown criterion "${t.reqId}::${t.criterionId}" — REQ or criterion-id may have been renamed/removed.`,
      });
    }
  }

  return {
    catalog_dir: catalogDir,
    total_criteria: criteria.length,
    gated_criteria: gatedCount,
    total_test_tags: allTags.length,
    uncovered_criteria: uncovered,
    drifted_tags: drifted,
    findings,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  catalogDir: string;
  testRoots: string[];
  gatedSeverities: Severity[];
  soft: boolean;
  help: boolean;
}

const HELP = `req-coverage — REQ catalog → tagged-test coverage validator

Usage:
  pnpm req-coverage [--catalog <dir>] [--test-root <dir>]... [--gate-severity <list>] [--soft]

Options:
  --catalog <dir>          default: requirements
  --test-root <dir>        directories to walk for *.spec.ts / *.test.ts (default: apps, libs, contracts)
  --gate-severity <list>   comma-separated severities that must have coverage (default: critical,high)
  --soft                   report findings but always exit 0 (advisory mode)
  -h, --help               show this help

Exit codes:
  0  every gated criterion has at least one tagged test (or --soft)
  1  one or more gated criteria are uncovered
  2  bad invocation
`;

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    catalogDir: "requirements",
    testRoots: [],
    gatedSeverities: [...DEFAULT_GATED],
    soft: false,
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
    if (token === "--catalog") args.catalogDir = takeNext();
    else if (token === "--test-root") args.testRoots.push(takeNext());
    else if (token === "--gate-severity") {
      const value = takeNext();
      const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!SEVERITY_VALUES.has(p as Severity)) {
          throw new Error(`unknown severity: ${p}`);
        }
      }
      args.gatedSeverities = parts as Severity[];
    } else if (token === "--soft") args.soft = true;
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (args.testRoots.length === 0) {
    args.testRoots = ["apps", "libs", "contracts"];
  }
  return args;
}

function formatHuman(result: CoverageResult): string {
  const lines: string[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  for (const [file, fs] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(relative(process.cwd(), file));
    for (const f of fs) {
      const where = f.line ? `:${f.line}` : "";
      lines.push(`  [${f.level}] ${f.rule}${where} — ${f.message}`);
    }
  }
  if (lines.length > 0) lines.push("");
  if (result.uncovered_criteria === 0 && result.drifted_tags === 0) {
    lines.push(
      `req-coverage: catalog covered (${result.gated_criteria}/${result.gated_criteria} gated criteria, ${result.total_test_tags} tagged tests)`,
    );
  } else {
    lines.push(
      `req-coverage: ${result.gated_criteria - result.uncovered_criteria}/${result.gated_criteria} gated criteria covered, ` +
        `${result.uncovered_criteria} uncovered, ${result.drifted_tags} drifted tags, ${result.total_test_tags} tagged tests`,
    );
  }
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
    process.stderr.write(`req-coverage: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout(HELP);
    return 0;
  }
  const result = runCoverage({
    catalogDir: args.catalogDir,
    testRoots: args.testRoots,
    gatedSeverities: args.gatedSeverities,
  });
  stdout(formatHuman(result));
  if (args.soft) return 0;
  return result.uncovered_criteria > 0 ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(runCli(process.argv.slice(2)));
}
