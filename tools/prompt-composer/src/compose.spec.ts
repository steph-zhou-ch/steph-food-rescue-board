import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compose, loadTrackMeta, validateTrackMeta } from "./compose.js";

function makeTempEngagement(): {
  root: string;
  trackMetaPath: (id: string) => string;
  outputDir: string;
  registryPath: string;
  basePromptPath: string;
  codeReviewRulePackPath: string;
  catalogDir: string;
} {
  const root = mkdtempSync(join(tmpdir(), "prompt-composer-"));
  const registryPath = join(root, "registry.yaml");
  const basePromptPath = join(root, "base.md");
  const codeReviewRulePackPath = join(root, "code-review-rule-pack.md");
  const catalogDir = join(root, "requirements");
  const trackMetaDir = join(root, "track-meta");
  const outputDir = join(root, "composed");
  mkdirSync(catalogDir);
  mkdirSync(trackMetaDir);
  writeFileSync(
    registryPath,
    `classes:
  - id: typescript-domain-agent
    template: typescript-domain-agent
    description: "Pure TS domain logic."
    allowed_paths:
      - libs/domain/src/
      - libs/domain/test/
    forbidden_patterns:
      - "from 'pg'"
  - id: code-review-codex
    template: code-review-codex
    description: "Cross-model auditor."
    allowed_paths:
      - orchestration/reviews/
    forbidden_patterns:
      - "// @ts-ignore"
`,
  );
  writeFileSync(basePromptPath, "# base rule-pack\n\nTDD discipline.\n");
  writeFileSync(codeReviewRulePackPath, "# code-review rule-pack\n\nReview discipline.\n");
  writeFileSync(
    join(catalogDir, "REQ-CAP-TEST.md"),
    `---
id: REQ-CAP-TEST
schema_version: 3
name: Test
category: capability
severity: high
status: approved
owners:
  product: "@pm"
  technical: "@tech"
  qa: "@qa"
business_rationale: rationale
---
# Test
## Product Contract
prose
## Technical Contract
prose
## Acceptance Criteria
### \`crit\` - first
\`\`\`yaml
criterion:
  id: crit
\`\`\`
`,
  );
  return {
    root,
    trackMetaPath: (id: string) => join(trackMetaDir, `${id}.yaml`),
    outputDir,
    registryPath,
    basePromptPath,
    codeReviewRulePackPath,
    catalogDir,
  };
}

const VALID_TRACK_META = `track_id: w1-domain-slots
agent_class: typescript-domain-agent
phase: 4
wave: 1
batch: 1
track_summary: |
  Implement the SlotRepository value-object + its predicate.
predecessors: []
subscribed_contracts: []
cross_cutting_packs: []
unblocks: []
deliverables:
  - libs/domain/src/slots/SlotRepository.ts
  - libs/domain/test/slots/SlotRepository.spec.ts
exit_criterion: |
  pnpm typecheck && pnpm test pass on swarm/w1-domain-slots.
source_of_truth:
  req_ids:
    - REQ-CAP-TEST
execution_mode: hub_mode
`;

describe("prompt-composer", () => {
  it("composes a valid track-meta and writes output to the output dir", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-domain-slots");
    writeFileSync(trackMetaPath, VALID_TRACK_META);
    const result = compose({
      trackMetaPath,
      validateOnly: false,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    const errors = result.findings.filter((f) => f.level === "error");
    expect(errors).toEqual([]);
    expect(result.outputPath).toBe(join(env.outputDir, "w1-domain-slots.md"));
    expect(existsSync(result.outputPath ?? "")).toBe(true);
    const rendered = readFileSync(result.outputPath ?? "", "utf8");
    expect(rendered).toContain("# Composed worker prompt — `w1-domain-slots`");
    expect(rendered).toContain("base rule-pack");
    expect(rendered).toContain("`REQ-CAP-TEST`");
    expect(rendered).toContain("libs/domain/src/slots/SlotRepository.ts");
  });

  it("--validate-only skips writing output", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-domain-slots");
    writeFileSync(trackMetaPath, VALID_TRACK_META);
    const result = compose({
      trackMetaPath,
      validateOnly: true,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(result.outputPath).toBeNull();
    expect(existsSync(env.outputDir)).toBe(false);
  });

  it("flags unknown agent_class", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-bad");
    writeFileSync(trackMetaPath, VALID_TRACK_META.replace("typescript-domain-agent", "fictional-agent"));
    const result = compose({
      trackMetaPath,
      validateOnly: true,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    expect(result.findings.find((f) => f.rule === "track-meta-agent-class-unknown")).toBeDefined();
  });

  it("flags unresolved REQ ids", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-bad");
    writeFileSync(trackMetaPath, VALID_TRACK_META.replace("REQ-CAP-TEST", "REQ-CAP-DOES-NOT-EXIST"));
    const result = compose({
      trackMetaPath,
      validateOnly: true,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    expect(result.findings.find((f) => f.rule === "track-meta-req-unresolved")).toBeDefined();
  });

  it("flags missing required fields", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-bad");
    const bad = VALID_TRACK_META.replace(/track_id: .*\n/, "");
    writeFileSync(trackMetaPath, bad);
    const result = compose({
      trackMetaPath,
      validateOnly: true,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    expect(result.findings.find((f) => f.rule === "track-meta-track-id-missing")).toBeDefined();
  });

  it("uses code-review-rule-pack.md when agent_class is code-review-codex", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-code-review");
    const codexMeta = VALID_TRACK_META
      .replace("typescript-domain-agent", "code-review-codex")
      .replace(
        "deliverables:\n  - libs/domain/src/slots/SlotRepository.ts\n  - libs/domain/test/slots/SlotRepository.spec.ts",
        "deliverables:\n  - orchestration/reviews/w1-code-review-codex.md",
      );
    writeFileSync(trackMetaPath, codexMeta);
    const result = compose({
      trackMetaPath,
      validateOnly: false,
      registryPath: env.registryPath,
      basePromptPath: env.basePromptPath,
      codeReviewRulePackPath: env.codeReviewRulePackPath,
      catalogDir: env.catalogDir,
      outputDir: env.outputDir,
    });
    const errors = result.findings.filter((f) => f.level === "error");
    expect(errors).toEqual([]);
    const rendered = readFileSync(result.outputPath ?? "", "utf8");
    expect(rendered).toContain("code-review rule-pack");
    expect(rendered).not.toContain("# base rule-pack");
  });

  it("loadTrackMeta parses required scalar + list fields", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-x");
    writeFileSync(trackMetaPath, VALID_TRACK_META);
    const { meta, findings } = loadTrackMeta(trackMetaPath);
    expect(findings).toEqual([]);
    expect(meta?.track_id).toBe("w1-domain-slots");
    expect(meta?.deliverables.length).toBe(2);
    expect(meta?.source_of_truth.req_ids).toEqual(["REQ-CAP-TEST"]);
  });

  it("validateTrackMeta flags empty deliverables", () => {
    const env = makeTempEngagement();
    const trackMetaPath = env.trackMetaPath("w1-empty");
    const bad = VALID_TRACK_META.replace(
      /deliverables:\n  - .+\n  - .+\n/,
      "deliverables: []\n",
    );
    writeFileSync(trackMetaPath, bad);
    const { meta } = loadTrackMeta(trackMetaPath);
    expect(meta).not.toBeNull();
    const findings = validateTrackMeta(
      meta!,
      { classes: [{ id: "typescript-domain-agent", template: "x", description: "", allowed_paths: [], forbidden_patterns: [] }] },
      env.catalogDir,
      trackMetaPath,
    );
    expect(findings.find((f) => f.rule === "track-meta-deliverables-empty")).toBeDefined();
  });
});
