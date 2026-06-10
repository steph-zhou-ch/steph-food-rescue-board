#!/usr/bin/env -S npx tsx
/**
 * req-lint — catalog validator for REQ Spec v3 and v4.
 *
 * Wired into the engagement via the root `pnpm req-lint` script. See
 * docs/USER-GUIDE.md Appendix A (Tooling matrix → "Catalog validation") and
 * Phase 1.3 / Phase 2 of the methodology.
 */

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse as parseYaml, parseDocument } from "yaml";

export type FindingLevel = "error" | "warning";

export interface Finding {
  file: string;
  line?: number;
  level: FindingLevel;
  rule: string;
  message: string;
  /**
   * Mechanical fix the Captain (or a Captain-side subagent) can apply
   * without semantic judgement. docs/USER-GUIDE.md Phase 2 ("What you decide")
   * says: "Apply any `suggested_fix` field where present; author your own
   * fix otherwise." Populated for rules where the fix is unambiguous.
   */
  suggested_fix?: string;
}

export interface LintResult {
  catalog_dir: string;
  total_files: number;
  files_with_errors: number;
  findings: Finding[];
  started_at: string;
  finished_at: string;
}

export interface LintOptions {
  catalogDir: string;
}

const REQ_FILENAME = /^REQ-[A-Z]+-[A-Z0-9-]+\.md$/;
const REQ_ID_PATTERN = /^REQ-[A-Z]+-[A-Z0-9-]+$/;
const CATEGORY_VALUES = new Set([
  "capability",
  "invariant",
  "integration",
  "configurability",
]);
const SEVERITY_VALUES = new Set(["critical", "high", "medium", "low"]);
const STATUS_VALUES = new Set(["draft", "approved", "deprecated"]);
const HANDLE_PATTERN = /^@[a-z0-9][a-z0-9._-]*$/i;

interface ParsedReq {
  filePath: string;
  expectedId: string;
  rawFrontmatter: string;
  frontmatterStartLine: number;
  frontmatterEndLine: number;
  frontmatter: Record<string, unknown> | null;
  body: string;
  bodyStartLine: number;
}

interface ReqFile {
  filePath: string;
  expectedId: string;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

export function discoverReqFiles(catalogDir: string): ReqFile[] {
  const out: ReqFile[] = [];
  const entries = readdirSync(catalogDir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(catalogDir, entry.name);
    if (entry.isFile() && REQ_FILENAME.test(entry.name)) {
      out.push({ filePath: full, expectedId: entry.name.replace(/\.md$/, "") });
    } else if (entry.isDirectory() && /^REQ-[A-Z]+-[A-Z0-9-]+$/.test(entry.name)) {
      const indexPath = join(full, "index.md");
      try {
        statSync(indexPath);
        out.push({ filePath: indexPath, expectedId: entry.name });
      } catch {
        // directory-style REQ missing index.md — surfaced as a finding
        // during lint (file path = the missing index).
        out.push({ filePath: indexPath, expectedId: entry.name });
      }
    }
  }
  out.sort((a, b) => a.expectedId.localeCompare(b.expectedId));
  return out;
}

// ---------------------------------------------------------------------------
// Frontmatter + body split
// ---------------------------------------------------------------------------

function splitFrontmatter(content: string): {
  rawFrontmatter: string;
  body: string;
  frontmatterStartLine: number;
  frontmatterEndLine: number;
  bodyStartLine: number;
} | null {
  // Frontmatter is the YAML between the first two `---` lines at the top
  // of the file. Must start on line 1.
  const lines = content.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;
  return {
    rawFrontmatter: lines.slice(1, endIdx).join("\n"),
    body: lines.slice(endIdx + 1).join("\n"),
    frontmatterStartLine: 1,
    frontmatterEndLine: endIdx + 1,
    bodyStartLine: endIdx + 2,
  };
}

function parseReq(filePath: string, expectedId: string): {
  parsed: ParsedReq;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (err) {
    findings.push({
      file: filePath,
      level: "error",
      rule: "file-missing",
      message: `Cannot read file: ${(err as Error).message}`,
    });
    return {
      parsed: {
        filePath,
        expectedId,
        rawFrontmatter: "",
        frontmatterStartLine: 0,
        frontmatterEndLine: 0,
        frontmatter: null,
        body: "",
        bodyStartLine: 0,
      },
      findings,
    };
  }

  const split = splitFrontmatter(content);
  if (!split) {
    findings.push({
      file: filePath,
      line: 1,
      level: "error",
      rule: "frontmatter-missing",
      message: "REQ files MUST open with YAML frontmatter delimited by `---` on line 1.",
    });
    return {
      parsed: {
        filePath,
        expectedId,
        rawFrontmatter: "",
        frontmatterStartLine: 0,
        frontmatterEndLine: 0,
        frontmatter: null,
        body: content,
        bodyStartLine: 1,
      },
      findings,
    };
  }

  let frontmatter: Record<string, unknown> | null = null;
  try {
    const doc = parseDocument(split.rawFrontmatter);
    const errs = doc.errors;
    if (errs.length > 0) {
      for (const err of errs) {
        findings.push({
          file: filePath,
          line: split.frontmatterStartLine + (err.linePos?.[0]?.line ?? 0),
          level: "error",
          rule: "frontmatter-yaml-parse",
          message: `Frontmatter YAML parse error: ${err.message}`,
        });
      }
    } else {
      frontmatter = doc.toJS({ maxAliasCount: 100 }) as Record<string, unknown>;
    }
  } catch (err) {
    findings.push({
      file: filePath,
      line: split.frontmatterStartLine,
      level: "error",
      rule: "frontmatter-yaml-parse",
      message: `Frontmatter YAML parse error: ${(err as Error).message}`,
    });
  }

  return {
    parsed: {
      filePath,
      expectedId,
      rawFrontmatter: split.rawFrontmatter,
      frontmatterStartLine: split.frontmatterStartLine,
      frontmatterEndLine: split.frontmatterEndLine,
      frontmatter,
      body: split.body,
      bodyStartLine: split.bodyStartLine,
    },
    findings,
  };
}

// ---------------------------------------------------------------------------
// Frontmatter rules
// ---------------------------------------------------------------------------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function lintFrontmatter(parsed: ParsedReq, knownReqIds: Set<string>): Finding[] {
  const findings: Finding[] = [];
  const fm = parsed.frontmatter;
  if (!fm) return findings;

  // id matches filename
  if (!isNonEmptyString(fm.id)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "id-missing",
      message: "Frontmatter `id:` is required.",
    });
  } else if (fm.id !== parsed.expectedId) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "id-filename-mismatch",
      message: `Frontmatter id "${fm.id}" does not match filename id "${parsed.expectedId}".`,
      suggested_fix: `Set \`id: ${parsed.expectedId}\` in the frontmatter (or rename the file to ${fm.id}.md).`,
    });
  } else if (!REQ_ID_PATTERN.test(fm.id)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "id-shape",
      message: `Frontmatter id "${fm.id}" does not match the REQ-<CATEGORY>-<NAME> shape.`,
    });
  }

  // schema_version: 3 or 4
  if (fm.schema_version !== 3 && fm.schema_version !== 4) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "schema-version",
      message: `Frontmatter \`schema_version\` MUST be 3 or 4 (got ${JSON.stringify(fm.schema_version)}).`,
      suggested_fix: "Set `schema_version: 4` in the frontmatter.",
    });
  }

  const isV4 = fm.schema_version === 4;

  // name
  if (!isNonEmptyString(fm.name)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "name-missing",
      message: "Frontmatter `name:` is required.",
    });
  }

  // category
  if (!isNonEmptyString(fm.category) || !CATEGORY_VALUES.has(fm.category)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "category-enum",
      message: `Frontmatter \`category\` must be one of ${[...CATEGORY_VALUES].join(", ")} (got ${JSON.stringify(fm.category)}).`,
    });
  }

  // severity
  if (!isNonEmptyString(fm.severity) || !SEVERITY_VALUES.has(fm.severity)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "severity-enum",
      message: `Frontmatter \`severity\` must be one of ${[...SEVERITY_VALUES].join(", ")} (got ${JSON.stringify(fm.severity)}).`,
    });
  }

  // status
  if (!isNonEmptyString(fm.status) || !STATUS_VALUES.has(fm.status)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "status-enum",
      message: `Frontmatter \`status\` must be one of ${[...STATUS_VALUES].join(", ")} (got ${JSON.stringify(fm.status)}).`,
    });
  }

  // owners
  const owners = fm.owners as Record<string, unknown> | undefined;
  if (!owners || typeof owners !== "object") {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "owners-missing",
      message: "Frontmatter `owners:` block is required.",
    });
  } else if (isV4) {
    // v4: only technical is required
    const handle = owners.technical;
    if (!isNonEmptyString(handle)) {
      findings.push({
        file: parsed.filePath,
        line: parsed.frontmatterStartLine,
        level: "error",
        rule: "owners-triad",
        message: "Frontmatter `owners.technical` is required.",
      });
    } else if (!HANDLE_PATTERN.test(handle)) {
      findings.push({
        file: parsed.filePath,
        line: parsed.frontmatterStartLine,
        level: "warning",
        rule: "owners-handle-format",
        message: `\`owners.technical\` ("${handle}") does not look like a handle (\`@name\`).`,
      });
    }
  } else {
    // v3: full triad required
    for (const role of ["product", "technical", "qa"] as const) {
      const handle = owners[role];
      if (!isNonEmptyString(handle)) {
        findings.push({
          file: parsed.filePath,
          line: parsed.frontmatterStartLine,
          level: "error",
          rule: "owners-triad",
          message: `Frontmatter \`owners.${role}\` is required.`,
        });
      } else if (!HANDLE_PATTERN.test(handle)) {
        findings.push({
          file: parsed.filePath,
          line: parsed.frontmatterStartLine,
          level: "warning",
          rule: "owners-handle-format",
          message: `\`owners.${role}\` ("${handle}") does not look like a handle (\`@name\`).`,
        });
      }
    }
  }

  // business_rationale (v3 only)
  if (!isV4 && !isNonEmptyString(fm.business_rationale)) {
    findings.push({
      file: parsed.filePath,
      line: parsed.frontmatterStartLine,
      level: "error",
      rule: "business-rationale-missing",
      message: "Frontmatter `business_rationale:` is required (2-4 sentence prose, PM-owned).",
    });
  }

  // invariants_respected — each entry must resolve to a known REQ-INV-*
  const invs = fm.invariants_respected;
  if (invs !== undefined && invs !== null) {
    if (!Array.isArray(invs)) {
      findings.push({
        file: parsed.filePath,
        line: parsed.frontmatterStartLine,
        level: "error",
        rule: "invariants-respected-shape",
        message: "`invariants_respected` must be a YAML list of REQ-INV-* ids.",
      });
    } else {
      for (const entry of invs) {
        if (typeof entry !== "string") {
          findings.push({
            file: parsed.filePath,
            line: parsed.frontmatterStartLine,
            level: "error",
            rule: "invariants-respected-shape",
            message: `\`invariants_respected\` entry ${JSON.stringify(entry)} is not a string.`,
          });
          continue;
        }
        if (!entry.startsWith("REQ-INV-")) {
          findings.push({
            file: parsed.filePath,
            line: parsed.frontmatterStartLine,
            level: "error",
            rule: "invariants-respected-prefix",
            message: `\`invariants_respected\` entry "${entry}" is not a REQ-INV-* id.`,
          });
          continue;
        }
        if (!knownReqIds.has(entry)) {
          findings.push({
            file: parsed.filePath,
            line: parsed.frontmatterStartLine,
            level: "error",
            rule: "invariants-respected-unresolved",
            message: `\`invariants_respected\` references "${entry}" which is not present in the catalog.`,
          });
        }
      }
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Body: required sections + criterion blocks
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS_V3: Record<string, string[]> = {
  capability: ["Product Contract", "Technical Contract", "Acceptance Criteria"],
  invariant: ["Acceptance Criteria"],
  integration: ["Acceptance Criteria"],
  configurability: ["Acceptance Criteria"],
};

const REQUIRED_SECTIONS_V4: Record<string, string[]> = {
  capability: ["Acceptance Criteria"],
  invariant: ["Acceptance Criteria"],
  integration: ["Acceptance Criteria"],
  configurability: ["Acceptance Criteria"],
};

function lintBodySections(parsed: ParsedReq): Finding[] {
  const findings: Finding[] = [];
  const category = (parsed.frontmatter?.category as string | undefined) ?? "";
  const isV4 = parsed.frontmatter?.schema_version === 4;
  const sectionMap = isV4 ? REQUIRED_SECTIONS_V4 : REQUIRED_SECTIONS_V3;
  const required = sectionMap[category] ?? [];
  const bodyLines = parsed.body.split("\n");
  const h2Headings = new Set(
    bodyLines
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim()),
  );
  for (const section of required) {
    if (!h2Headings.has(section)) {
      findings.push({
        file: parsed.filePath,
        line: parsed.bodyStartLine,
        level: "error",
        rule: "section-missing",
        message: `Body is missing the required \`## ${section}\` section (category=${category}).`,
      });
    }
  }
  return findings;
}

interface CriterionBlock {
  headingId: string;
  headingLine: number;
  yamlContent: string;
  yamlLine: number;
}

function extractCriterionBlocks(parsed: ParsedReq): CriterionBlock[] {
  const blocks: CriterionBlock[] = [];
  const lines = parsed.body.split("\n");
  let currentHeadingId: string | null = null;
  let currentHeadingLine = 0;
  let inFence = false;
  let fenceIsYaml = false;
  let fenceStartLine = 0;
  let fenceBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const absLine = parsed.bodyStartLine + i;
    if (!inFence) {
      const headingMatch = line.match(/^### `([^`]+)`/);
      if (headingMatch) {
        currentHeadingId = headingMatch[1] ?? null;
        currentHeadingLine = absLine;
        continue;
      }
      if (line.startsWith("```")) {
        inFence = true;
        fenceIsYaml = line.slice(3).trim().toLowerCase() === "yaml";
        fenceStartLine = absLine;
        fenceBuf = [];
        continue;
      }
    } else {
      if (line.startsWith("```")) {
        if (fenceIsYaml && currentHeadingId) {
          blocks.push({
            headingId: currentHeadingId,
            headingLine: currentHeadingLine,
            yamlContent: fenceBuf.join("\n"),
            yamlLine: fenceStartLine,
          });
          currentHeadingId = null;
        }
        inFence = false;
        fenceIsYaml = false;
        fenceBuf = [];
        continue;
      }
      fenceBuf.push(line);
    }
  }
  return blocks;
}

function lintCriterionBlocks(parsed: ParsedReq): Finding[] {
  const findings: Finding[] = [];
  const blocks = extractCriterionBlocks(parsed);

  // Capabilities should have at least one criterion block; invariants and
  // integrations also typically do, but the universal rule (every REQ has
  // a `## Acceptance Criteria` section with criteria) is enforced via the
  // section check + this loop.
  if ((parsed.frontmatter?.category as string | undefined) === "capability" && blocks.length === 0) {
    findings.push({
      file: parsed.filePath,
      line: parsed.bodyStartLine,
      level: "error",
      rule: "criteria-empty",
      message: "Capability REQ has no acceptance-criterion blocks (no `### \\`<id>\\`` headings with embedded yaml).",
    });
  }

  for (const block of blocks) {
    let parsedYaml: unknown;
    try {
      parsedYaml = parseYaml(block.yamlContent);
    } catch (err) {
      findings.push({
        file: parsed.filePath,
        line: block.yamlLine,
        level: "error",
        rule: "criterion-yaml-parse",
        message: `Criterion "${block.headingId}" — embedded YAML parse error: ${(err as Error).message}`,
      });
      continue;
    }
    if (!parsedYaml || typeof parsedYaml !== "object") {
      findings.push({
        file: parsed.filePath,
        line: block.yamlLine,
        level: "error",
        rule: "criterion-shape",
        message: `Criterion "${block.headingId}" — embedded YAML must be a mapping with a top-level \`criterion:\` key.`,
      });
      continue;
    }
    const criterion = (parsedYaml as { criterion?: unknown }).criterion;
    if (!criterion || typeof criterion !== "object") {
      findings.push({
        file: parsed.filePath,
        line: block.yamlLine,
        level: "error",
        rule: "criterion-shape",
        message: `Criterion "${block.headingId}" — embedded YAML must have a top-level \`criterion:\` mapping.`,
      });
      continue;
    }
    const cid = (criterion as Record<string, unknown>).id;
    if (typeof cid !== "string" || cid.length === 0) {
      findings.push({
        file: parsed.filePath,
        line: block.yamlLine,
        level: "error",
        rule: "criterion-id-missing",
        message: `Criterion "${block.headingId}" — embedded YAML \`criterion.id\` is required.`,
      });
    } else if (cid !== block.headingId) {
      findings.push({
        file: parsed.filePath,
        line: block.yamlLine,
        level: "error",
        rule: "criterion-id-heading-mismatch",
        message: `Criterion heading \`${block.headingId}\` does not match embedded \`criterion.id\` "${cid}".`,
        suggested_fix: `Set embedded criterion.id to "${block.headingId}" (or rename the heading from \`${block.headingId}\` to \`${cid}\`).`,
      });
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function lintCatalog(options: LintOptions): LintResult {
  const started = new Date().toISOString();
  const catalogDir = resolve(options.catalogDir);
  const files = discoverReqFiles(catalogDir);

  const knownReqIds = new Set(files.map((f) => f.expectedId));
  const findings: Finding[] = [];
  const filesWithErrors = new Set<string>();

  for (const file of files) {
    const { parsed, findings: parseFindings } = parseReq(file.filePath, file.expectedId);
    const fmFindings = lintFrontmatter(parsed, knownReqIds);
    const sectionFindings = lintBodySections(parsed);
    const criterionFindings = lintCriterionBlocks(parsed);
    const fileFindings = [
      ...parseFindings,
      ...fmFindings,
      ...sectionFindings,
      ...criterionFindings,
    ];
    for (const f of fileFindings) {
      findings.push(f);
      if (f.level === "error") filesWithErrors.add(f.file);
    }
  }

  return {
    catalog_dir: catalogDir,
    total_files: files.length,
    files_with_errors: filesWithErrors.size,
    findings,
    started_at: started,
    finished_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  catalogDir: string;
  outputPath: string | null;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { catalogDir: "requirements", outputPath: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--catalog") {
      const next = argv[i + 1];
      if (!next) throw new Error("--catalog requires a path argument");
      args.catalogDir = next;
      i++;
    } else if (token?.startsWith("--catalog=")) {
      args.catalogDir = token.slice("--catalog=".length);
    } else if (token === "--output") {
      const next = argv[i + 1];
      if (!next) throw new Error("--output requires a path argument");
      args.outputPath = next;
      i++;
    } else if (token?.startsWith("--output=")) {
      args.outputPath = token.slice("--output=".length);
    } else if (token === "-h" || token === "--help") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

const HELP = `req-lint — REQ Spec v3/v4 catalog validator

Usage:
  pnpm req-lint [--catalog <dir>] [--output <path>]

Options:
  --catalog <dir>   Catalog directory to lint (default: requirements)
  --output <path>   Write JSON result to this path in addition to stdout
  -h, --help        Show this help

Exit codes:
  0  catalog OK (zero error-level findings; warnings allowed)
  1  one or more error-level findings
  2  bad invocation
`;

function formatHuman(result: LintResult): string {
  if (result.findings.length === 0) {
    return `req-lint: catalog OK (${result.total_files} files)`;
  }
  const lines: string[] = [];
  const byFile = new Map<string, Finding[]>();
  for (const f of result.findings) {
    const arr = byFile.get(f.file) ?? [];
    arr.push(f);
    byFile.set(f.file, arr);
  }
  for (const [file, fs] of [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(file);
    for (const f of fs) {
      const where = f.line ? `:${f.line}` : "";
      lines.push(`  [${f.level}] ${f.rule}${where} — ${f.message}`);
    }
  }
  const errors = result.findings.filter((f) => f.level === "error").length;
  const warnings = result.findings.filter((f) => f.level === "warning").length;
  lines.push("");
  lines.push(
    `req-lint: ${result.total_files} files scanned, ${result.files_with_errors} with errors (${errors} errors, ${warnings} warnings)`,
  );
  return lines.join("\n");
}

export function runCli(argv: readonly string[], stdout: (s: string) => void = (s) => process.stdout.write(s + "\n")): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    process.stderr.write(`req-lint: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout(HELP);
    return 0;
  }
  const result = lintCatalog({ catalogDir: args.catalogDir });
  stdout(formatHuman(result));
  if (args.outputPath) {
    const abs = resolve(args.outputPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(result, null, 2) + "\n", "utf8");
  }
  return result.findings.some((f) => f.level === "error") ? 1 : 0;
}

// Direct-execution guard. When invoked via `tsx tools/req-lint/src/lint.ts`,
// import.meta.url is a file:// URL pointing at this file. When imported as
// a library (tests), the guard prevents the CLI from running.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}

// Silence unused-import warning for `fileURLToPath` when in module-only paths.
export const __internal = { fileURLToPath };
