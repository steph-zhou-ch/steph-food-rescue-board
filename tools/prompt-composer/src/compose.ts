#!/usr/bin/env -S npx tsx
/**
 * prompt-composer — stitches a worker-ready prompt out of:
 *
 *   1. engagement-side rule pack(s) (default: orchestration/prompts/base.md)
 *   2. agent-class authority block (allowed_paths + forbidden_patterns
 *      from orchestration/ledgers/agent-class-registry.yaml)
 *   3. track-meta mission (track_id, summary, deliverables, exit_criterion)
 *   4. inlined REQ excerpts (per source_of_truth.req_ids)
 *   5. operational protocol (TDD discipline, branch + commit markers)
 *
 * Output lives at orchestration/prompts/composed/<track-id>.md and is
 * what the Scion manager pipes to each worker container via
 *   scion message <track-id> "$(cat orchestration/prompts/composed/<track-id>.md)"
 *
 * See docs/USER-GUIDE.md §Phase 4 + §Appendix A → "Prompt composition" for
 * how this fits into the methodology.
 */

import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FindingLevel = "error" | "warning";

export interface Finding {
  file: string;
  level: FindingLevel;
  rule: string;
  message: string;
}

export interface TrackMeta {
  track_id: string;
  agent_class: string;
  phase: number;
  wave: number;
  batch: number;
  track_summary: string;
  predecessors: string[];
  subscribed_contracts: string[];
  cross_cutting_packs: string[];
  unblocks: string[];
  deliverables: string[];
  exit_criterion: string;
  source_of_truth: { req_ids: string[] };
  execution_mode: string;
}

export interface AgentClass {
  id: string;
  template: string;
  description: string;
  allowed_paths: string[];
  forbidden_patterns: string[];
}

export interface AgentClassRegistry {
  classes: AgentClass[];
}

export interface ComposeOptions {
  trackMetaPath: string;
  validateOnly: boolean;
  registryPath: string;
  basePromptPath: string;
  codeReviewRulePackPath: string;
  catalogDir: string;
  outputDir: string;
  /** Default `false`. If true, also write to outputDir even when --validate-only is set. Used in tests. */
  alsoWriteWhenValidating?: boolean;
}

export interface ComposeResult {
  trackMeta: TrackMeta | null;
  findings: Finding[];
  outputPath: string | null;
  composedPrompt: string | null;
}

// ---------------------------------------------------------------------------
// Load helpers
// ---------------------------------------------------------------------------

function readFileSafe(filePath: string): { content: string } | { error: string } {
  try {
    return { content: readFileSync(filePath, "utf8") };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export function loadTrackMeta(trackMetaPath: string): { meta: TrackMeta | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const read = readFileSafe(trackMetaPath);
  if ("error" in read) {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-missing",
      message: `Cannot read track-meta: ${read.error}`,
    });
    return { meta: null, findings };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(read.content);
  } catch (err) {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-yaml-parse",
      message: `track-meta YAML parse error: ${(err as Error).message}`,
    });
    return { meta: null, findings };
  }
  if (!parsed || typeof parsed !== "object") {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-shape",
      message: "track-meta must be a top-level YAML mapping.",
    });
    return { meta: null, findings };
  }
  const obj = parsed as Record<string, unknown>;
  const meta: TrackMeta = {
    track_id: String(obj.track_id ?? ""),
    agent_class: String(obj.agent_class ?? ""),
    phase: typeof obj.phase === "number" ? obj.phase : 0,
    wave: typeof obj.wave === "number" ? obj.wave : 0,
    batch: typeof obj.batch === "number" ? obj.batch : 0,
    track_summary: String(obj.track_summary ?? ""),
    predecessors: Array.isArray(obj.predecessors) ? obj.predecessors.map(String) : [],
    subscribed_contracts: Array.isArray(obj.subscribed_contracts)
      ? obj.subscribed_contracts.map(String)
      : [],
    cross_cutting_packs: Array.isArray(obj.cross_cutting_packs)
      ? obj.cross_cutting_packs.map(String)
      : [],
    unblocks: Array.isArray(obj.unblocks) ? obj.unblocks.map(String) : [],
    deliverables: Array.isArray(obj.deliverables) ? obj.deliverables.map(String) : [],
    exit_criterion: String(obj.exit_criterion ?? ""),
    source_of_truth:
      obj.source_of_truth && typeof obj.source_of_truth === "object"
        ? {
            req_ids: Array.isArray((obj.source_of_truth as Record<string, unknown>).req_ids)
              ? (
                  (obj.source_of_truth as Record<string, unknown>).req_ids as unknown[]
                ).map(String)
              : [],
          }
        : { req_ids: [] },
    execution_mode: String(obj.execution_mode ?? ""),
  };
  return { meta, findings };
}

export function loadRegistry(registryPath: string): {
  registry: AgentClassRegistry | null;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const read = readFileSafe(registryPath);
  if ("error" in read) {
    findings.push({
      file: registryPath,
      level: "error",
      rule: "registry-missing",
      message: `Cannot read agent-class registry: ${read.error}`,
    });
    return { registry: null, findings };
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(read.content);
  } catch (err) {
    findings.push({
      file: registryPath,
      level: "error",
      rule: "registry-yaml-parse",
      message: `registry YAML parse error: ${(err as Error).message}`,
    });
    return { registry: null, findings };
  }
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { classes?: unknown }).classes)) {
    findings.push({
      file: registryPath,
      level: "error",
      rule: "registry-shape",
      message: "registry must have a top-level `classes:` list.",
    });
    return { registry: null, findings };
  }
  const registry: AgentClassRegistry = {
    classes: (parsed as { classes: unknown[] }).classes.map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        id: String(e.id ?? ""),
        template: String(e.template ?? ""),
        description: String(e.description ?? ""),
        allowed_paths: Array.isArray(e.allowed_paths) ? e.allowed_paths.map(String) : [],
        forbidden_patterns: Array.isArray(e.forbidden_patterns)
          ? e.forbidden_patterns.map(String)
          : [],
      };
    }),
  };
  return { registry, findings };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS: Array<{ field: keyof TrackMeta; rule: string }> = [
  { field: "track_id", rule: "track-meta-track-id-missing" },
  { field: "agent_class", rule: "track-meta-agent-class-missing" },
  { field: "track_summary", rule: "track-meta-summary-missing" },
  { field: "exit_criterion", rule: "track-meta-exit-criterion-missing" },
  { field: "execution_mode", rule: "track-meta-execution-mode-missing" },
];

function isNonEmpty(v: unknown): boolean {
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return v != null;
}

export function validateTrackMeta(
  meta: TrackMeta,
  registry: AgentClassRegistry,
  catalogDir: string,
  trackMetaPath: string,
): Finding[] {
  const findings: Finding[] = [];
  for (const req of REQUIRED_FIELDS) {
    if (!isNonEmpty(meta[req.field])) {
      findings.push({
        file: trackMetaPath,
        level: "error",
        rule: req.rule,
        message: `track-meta is missing required \`${String(req.field)}\` field.`,
      });
    }
  }
  if (meta.deliverables.length === 0) {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-deliverables-empty",
      message: "track-meta must declare at least one deliverable.",
    });
  }
  if (meta.source_of_truth.req_ids.length === 0) {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-req-ids-empty",
      message: "track-meta must declare at least one `source_of_truth.req_ids` entry.",
    });
  }

  // agent_class must resolve
  const knownClasses = new Set(registry.classes.map((c) => c.id));
  if (meta.agent_class && !knownClasses.has(meta.agent_class)) {
    findings.push({
      file: trackMetaPath,
      level: "error",
      rule: "track-meta-agent-class-unknown",
      message: `agent_class "${meta.agent_class}" is not in the registry (known: ${[...knownClasses].join(", ")}).`,
    });
  }

  // REQ ids resolve
  for (const reqId of meta.source_of_truth.req_ids) {
    if (resolveReqPath(reqId, catalogDir) === null) {
      findings.push({
        file: trackMetaPath,
        level: "error",
        rule: "track-meta-req-unresolved",
        message: `source_of_truth.req_ids entry "${reqId}" does not resolve to a REQ file under ${catalogDir}.`,
      });
    }
  }

  // execution_mode must be a known value (for now, only hub_mode is supported)
  if (meta.execution_mode && meta.execution_mode !== "hub_mode") {
    findings.push({
      file: trackMetaPath,
      level: "warning",
      rule: "track-meta-execution-mode-unknown",
      message: `execution_mode "${meta.execution_mode}" is non-standard; only "hub_mode" is supported today.`,
    });
  }

  return findings;
}

export function resolveReqPath(reqId: string, catalogDir: string): string | null {
  const singleFile = join(catalogDir, `${reqId}.md`);
  const dirIndex = join(catalogDir, reqId, "index.md");
  try {
    statSync(singleFile);
    return singleFile;
  } catch {
    // try directory layout
  }
  try {
    statSync(dirIndex);
    return dirIndex;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/**
 * Rule packs to include for each agent class (in addition to the worker's
 * Scion template system-prompt, which Scion delivers at container spawn
 * and is NOT this composer's responsibility).
 *
 * Default: base.md (the impl-worker rule-pack).
 * Override per agent class as appropriate.
 *
 * If a class is not listed here, the composer falls back to base.md.
 * A track-meta may override via the `cross_cutting_packs:` field
 * (which is appended after the per-class default).
 */
const DEFAULT_RULE_PACKS_BY_CLASS: Record<string, "base" | "code-review"> = {
  "typescript-domain-agent": "base",
  "typescript-api-agent": "base",
  "application-services-agent": "base",
  "foundations-agent": "base",
  "spec-adherence-agent": "base",
  "code-review-codex": "code-review",
};

function chooseRulePackPaths(
  meta: TrackMeta,
  options: ComposeOptions,
): string[] {
  const choice = DEFAULT_RULE_PACKS_BY_CLASS[meta.agent_class] ?? "base";
  const head = choice === "code-review" ? options.codeReviewRulePackPath : options.basePromptPath;
  return [head, ...meta.cross_cutting_packs.map((p) => p)];
}

export function composePrompt(
  meta: TrackMeta,
  registry: AgentClassRegistry,
  options: ComposeOptions,
): { content: string; findings: Finding[] } {
  const findings: Finding[] = [];
  const cls = registry.classes.find((c) => c.id === meta.agent_class);
  // cls null already surfaced as a validation finding by the caller

  const sections: string[] = [];

  sections.push(headerSection(meta, cls));
  sections.push(rulePacksSection(meta, options, findings));
  sections.push(agentAuthoritySection(cls));
  sections.push(missionSection(meta));
  sections.push(reqsSection(meta, options, findings));
  sections.push(operationalProtocolSection(meta));

  return { content: sections.filter((s) => s.length > 0).join("\n\n---\n\n") + "\n", findings };
}

function headerSection(meta: TrackMeta, cls: AgentClass | undefined): string {
  const lines: string[] = [];
  lines.push(`# Composed worker prompt — \`${meta.track_id}\``);
  lines.push("");
  lines.push(`> Agent class: \`${meta.agent_class}\`${cls ? ` (Scion template: \`${cls.template}\`)` : ""}`);
  lines.push(`> Wave / batch: w${meta.wave} / batch ${meta.batch} · Phase ${meta.phase}`);
  lines.push("");
  lines.push(
    "_This file is generated by `pnpm compose-prompts`; do not edit by hand. " +
      "Rerun the composer after editing the source track-meta, REQ, or rule pack._",
  );
  return lines.join("\n");
}

function rulePacksSection(meta: TrackMeta, options: ComposeOptions, findings: Finding[]): string {
  const paths = chooseRulePackPaths(meta, options);
  const lines: string[] = ["## 1. Engagement rule pack(s)"];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(p);
    const read = readFileSafe(abs);
    if ("error" in read) {
      findings.push({
        file: options.trackMetaPath,
        level: "error",
        rule: "rule-pack-missing",
        message: `rule-pack "${p}" could not be read: ${read.error}`,
      });
      continue;
    }
    lines.push("");
    lines.push(`### From \`${p}\``);
    lines.push("");
    lines.push(read.content.trimEnd());
  }
  return lines.join("\n");
}

function agentAuthoritySection(cls: AgentClass | undefined): string {
  if (!cls) return "## 2. Agent-class authority\n\n_Agent class not resolved — see findings._";
  const lines: string[] = ["## 2. Agent-class authority"];
  lines.push("");
  lines.push(cls.description);
  lines.push("");
  lines.push("**Allowed paths** (write only here):");
  for (const p of cls.allowed_paths) lines.push(`- \`${p}\``);
  lines.push("");
  lines.push("**Forbidden patterns** (must NOT appear in your output):");
  for (const fp of cls.forbidden_patterns) lines.push(`- \`${fp}\``);
  return lines.join("\n");
}

function missionSection(meta: TrackMeta): string {
  const lines: string[] = ["## 3. Mission"];
  lines.push("");
  lines.push(`**Track id:** \`${meta.track_id}\``);
  lines.push("");
  lines.push("**Summary:**");
  lines.push("");
  lines.push(meta.track_summary.trim());
  lines.push("");
  lines.push("**Predecessors:**");
  if (meta.predecessors.length === 0) lines.push("- (none — ready immediately)");
  else for (const p of meta.predecessors) lines.push(`- \`${p}\``);
  if (meta.subscribed_contracts.length > 0) {
    lines.push("");
    lines.push("**Subscribed contracts:**");
    for (const c of meta.subscribed_contracts) lines.push(`- \`${c}\``);
  }
  lines.push("");
  lines.push("**Deliverables** (files you will create or modify):");
  for (const d of meta.deliverables) lines.push(`- \`${d}\``);
  lines.push("");
  lines.push("**Exit criterion:**");
  lines.push("");
  lines.push(meta.exit_criterion.trim());
  if (meta.unblocks.length > 0) {
    lines.push("");
    lines.push("**Unblocks (gates that depend on this track):**");
    for (const g of meta.unblocks) lines.push(`- \`${g}\``);
  }
  return lines.join("\n");
}

function reqsSection(meta: TrackMeta, options: ComposeOptions, findings: Finding[]): string {
  const lines: string[] = ["## 4. REQs you implement (inlined verbatim)"];
  for (const reqId of meta.source_of_truth.req_ids) {
    const reqPath = resolveReqPath(reqId, options.catalogDir);
    if (reqPath === null) {
      findings.push({
        file: options.trackMetaPath,
        level: "error",
        rule: "req-unresolved-at-compose",
        message: `REQ "${reqId}" could not be resolved under ${options.catalogDir}.`,
      });
      continue;
    }
    const read = readFileSafe(reqPath);
    if ("error" in read) {
      findings.push({
        file: options.trackMetaPath,
        level: "error",
        rule: "req-unreadable",
        message: `REQ "${reqId}" at ${reqPath} could not be read: ${read.error}`,
      });
      continue;
    }
    lines.push("");
    lines.push(`### \`${reqId}\` (source: \`${relative(process.cwd(), reqPath)}\`)`);
    lines.push("");
    lines.push(read.content.trimEnd());
  }
  return lines.join("\n");
}

function operationalProtocolSection(meta: TrackMeta): string {
  const lines: string[] = ["## 5. Operational protocol"];
  lines.push("");
  lines.push(`**Branch.** Work on \`swarm/${meta.track_id}\`. Pull from \`origin/main\` at start; rebase only if your manager pushes a fix-batch.`);
  lines.push("");
  lines.push("**TDD commit pairs.** One acceptance-criterion per commit pair:");
  lines.push("");
  lines.push("1. `[test] <criterion-id> failing` — a vitest test asserting the YAML predicate. Tag the test via `describe('@req <REQ-ID> @criterion <criterion-id>', () => …)` so spec-adherence can find it.");
  lines.push("2. `[impl] <criterion-id> passing` — the production change that turns the failing test green.");
  lines.push("");
  lines.push("Run `pnpm typecheck && pnpm test` locally before every push.");
  lines.push("");
  lines.push(`**Done marker.** When all listed deliverables are complete and \`pnpm typecheck && pnpm test\` passes on \`swarm/${meta.track_id}\`, commit \`[complete:${meta.track_id}]\` (subject only) and push. The manager polls \`origin/swarm/${meta.track_id}\` for this marker.`);
  lines.push("");
  lines.push(`**Push policy.** You push to \`origin/swarm/${meta.track_id}\` only. The manager merges to staging and then to \`main\`. Do NOT push to \`main\` or to a sibling track's branch.`);
  lines.push("");
  lines.push("**Escalation.** If you are blocked (missing rule, contradictory predicate, ambiguous REQ), commit an `[escalation] <short-id>` to your branch with the question and stop — the manager will pick it up.");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function compose(options: ComposeOptions): ComposeResult {
  const findings: Finding[] = [];
  const { meta, findings: metaFindings } = loadTrackMeta(options.trackMetaPath);
  findings.push(...metaFindings);
  if (!meta) return { trackMeta: null, findings, outputPath: null, composedPrompt: null };

  const { registry, findings: regFindings } = loadRegistry(options.registryPath);
  findings.push(...regFindings);
  if (!registry) return { trackMeta: meta, findings, outputPath: null, composedPrompt: null };

  findings.push(...validateTrackMeta(meta, registry, options.catalogDir, options.trackMetaPath));

  if (findings.some((f) => f.level === "error")) {
    return { trackMeta: meta, findings, outputPath: null, composedPrompt: null };
  }

  const { content, findings: composeFindings } = composePrompt(meta, registry, options);
  findings.push(...composeFindings);

  let outputPath: string | null = null;
  if (!options.validateOnly || options.alsoWriteWhenValidating) {
    const dir = resolve(options.outputDir);
    mkdirSync(dir, { recursive: true });
    outputPath = join(dir, `${meta.track_id}.md`);
    writeFileSync(outputPath, content, "utf8");
  }

  return { trackMeta: meta, findings, outputPath, composedPrompt: content };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  trackMetaPath: string | null;
  validateOnly: boolean;
  registryPath: string;
  basePromptPath: string;
  codeReviewRulePackPath: string;
  catalogDir: string;
  outputDir: string;
  help: boolean;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    trackMetaPath: null,
    validateOnly: false,
    registryPath: "orchestration/ledgers/agent-class-registry.yaml",
    basePromptPath: "orchestration/prompts/base.md",
    codeReviewRulePackPath: "orchestration/prompts/code-review-rule-pack.md",
    catalogDir: "requirements",
    outputDir: "orchestration/prompts/composed",
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
    if (token === "--track-meta") args.trackMetaPath = takeNext();
    else if (token?.startsWith("--track-meta=")) args.trackMetaPath = token.slice("--track-meta=".length);
    else if (token === "--validate-only") args.validateOnly = true;
    else if (token === "--registry") args.registryPath = takeNext();
    else if (token === "--base-prompt") args.basePromptPath = takeNext();
    else if (token === "--code-review-rule-pack") args.codeReviewRulePackPath = takeNext();
    else if (token === "--catalog") args.catalogDir = takeNext();
    else if (token === "--output-dir") args.outputDir = takeNext();
    else if (token === "-h" || token === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  return args;
}

const HELP = `compose-prompts — render a worker-ready prompt from a track-meta + base rule-pack + REQ excerpts

Usage:
  pnpm compose-prompts --track-meta <path> [--validate-only] [...options]

Required:
  --track-meta <path>            track-meta YAML to render

Options:
  --validate-only                check the track-meta is composable; do not write output
  --registry <path>              default: orchestration/ledgers/agent-class-registry.yaml
  --base-prompt <path>           default: orchestration/prompts/base.md
  --code-review-rule-pack <path> default: orchestration/prompts/code-review-rule-pack.md
  --catalog <dir>                default: requirements
  --output-dir <dir>             default: orchestration/prompts/composed
  -h, --help                     show this help

Exit codes:
  0  composed successfully (or --validate-only with no findings)
  1  one or more error-level findings
  2  bad invocation
`;

function formatHuman(result: ComposeResult, validateOnly: boolean): string {
  const lines: string[] = [];
  for (const f of result.findings) {
    lines.push(`[${f.level}] ${f.rule} — ${f.message}  (${f.file})`);
  }
  const id = result.trackMeta?.track_id ?? "(unknown)";
  const errs = result.findings.filter((f) => f.level === "error").length;
  if (errs === 0) {
    if (validateOnly) {
      lines.push(`compose-prompts: ${id} validates clean`);
    } else if (result.outputPath) {
      lines.push(`compose-prompts: ${id} → ${result.outputPath}`);
    } else {
      lines.push(`compose-prompts: ${id} (no output path — internal error?)`);
    }
  } else {
    lines.push(`compose-prompts: ${id} — ${errs} error(s); see findings above`);
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
    process.stderr.write(`compose-prompts: ${(err as Error).message}\n${HELP}`);
    return 2;
  }
  if (args.help) {
    stdout(HELP);
    return 0;
  }
  if (!args.trackMetaPath) {
    process.stderr.write(`compose-prompts: --track-meta is required\n${HELP}`);
    return 2;
  }
  const result = compose({
    trackMetaPath: args.trackMetaPath,
    validateOnly: args.validateOnly,
    registryPath: args.registryPath,
    basePromptPath: args.basePromptPath,
    codeReviewRulePackPath: args.codeReviewRulePackPath,
    catalogDir: args.catalogDir,
    outputDir: args.outputDir,
  });
  stdout(formatHuman(result, args.validateOnly));
  return result.findings.some((f) => f.level === "error") ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const exitCode = runCli(process.argv.slice(2));
  process.exit(exitCode);
}

// Re-export for consumers that want internal pieces (e.g., tests).
export const __internal = { dirname };
