import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_ALLOWED_ROOTS, checkTrackMetas } from "./check.js";

function makeTrackMetaDir(): string {
  const d = mkdtempSync(join(tmpdir(), "check-track-meta-paths-"));
  return d;
}

const VALID_META = `track_id: w1-domain-test
agent_class: typescript-domain-agent
phase: 4
wave: 1
batch: 1
track_summary: summary
predecessors: []
deliverables:
  - libs/domain/src/x.ts
  - libs/domain/test/x.spec.ts
  - apps/app/src/y.ts
  - migrations/2026-01-01_add_foo.sql
  - tools/req-lint/src/lint.ts
  - orchestration/reviews/w1-spec-adherence.md
exit_criterion: done
source_of_truth:
  req_ids: [REQ-CAP-X]
execution_mode: hub_mode
`;

describe("check-track-meta-paths", () => {
  it("exits clean for deliverables under allowed roots", () => {
    const dir = makeTrackMetaDir();
    writeFileSync(join(dir, "w1-domain-test.yaml"), VALID_META);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(1);
  });

  it("flags deliverables outside allowed roots", () => {
    const dir = makeTrackMetaDir();
    const bad = VALID_META.replace(
      "  - libs/domain/src/x.ts",
      "  - somewhere/else/x.ts",
    );
    writeFileSync(join(dir, "w1-bad.yaml"), bad);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    const f = result.findings.find((x) => x.rule === "deliverable-outside-roots");
    expect(f).toBeDefined();
    expect(f?.message).toContain("somewhere/else/x.ts");
  });

  it("flags absolute paths", () => {
    const dir = makeTrackMetaDir();
    const bad = VALID_META.replace(
      "  - libs/domain/src/x.ts",
      "  - /etc/passwd",
    );
    writeFileSync(join(dir, "w1-bad.yaml"), bad);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings.find((f) => f.rule === "deliverable-outside-roots")).toBeDefined();
  });

  it("ignores files whose name starts with `_` (templates)", () => {
    const dir = makeTrackMetaDir();
    const bad = VALID_META.replace(
      "  - libs/domain/src/x.ts",
      "  - somewhere/else/x.ts",
    );
    writeFileSync(join(dir, "_template-track.yaml"), bad);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(0);
  });

  it("flags malformed YAML", () => {
    const dir = makeTrackMetaDir();
    writeFileSync(join(dir, "w1-bad.yaml"), "deliverables: : : :");
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    const yamlFinding = result.findings.find(
      (f) => f.rule === "track-meta-yaml-parse" || f.rule === "track-meta-shape",
    );
    expect(yamlFinding).toBeDefined();
  });

  it("flags non-list `deliverables:`", () => {
    const dir = makeTrackMetaDir();
    writeFileSync(join(dir, "w1-bad.yaml"), "deliverables: not-a-list\n");
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings.find((f) => f.rule === "deliverables-shape")).toBeDefined();
  });

  it("returns 0 files when directory has no track-metas", () => {
    const dir = makeTrackMetaDir();
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(0);
  });

  it("honors custom allow-list", () => {
    const dir = makeTrackMetaDir();
    const bad = VALID_META.replace("  - libs/domain/src/x.ts", "  - extra/place/x.ts");
    writeFileSync(join(dir, "w1-bad.yaml"), bad);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: [...DEFAULT_ALLOWED_ROOTS, "extra/"],
    });
    expect(result.findings).toEqual([]);
  });

  it("ignores missing directory (returns 0 files)", () => {
    const result = checkTrackMetas({
      trackMetaDir: "/this/path/should/not/exist/and/never/will",
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(0);
  });

  it("permits contracts/ deliverables (workspace package)", () => {
    const dir = makeTrackMetaDir();
    const contractsMeta = VALID_META.replace(
      "  - libs/domain/src/x.ts\n  - libs/domain/test/x.spec.ts",
      [
        "  - contracts/src/events/appointment.created.json",
        "  - contracts/src/events/index.ts",
        "  - contracts/src/graphql/appointment.graphql",
      ].join("\n"),
    );
    writeFileSync(join(dir, "w1-contract-events.yaml"), contractsMeta);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(1);
  });

  it("permits docs/ deliverables (runbooks, dashboards, alert rules)", () => {
    const dir = makeTrackMetaDir();
    const docsMeta = VALID_META.replace(
      "  - libs/domain/src/x.ts\n  - libs/domain/test/x.spec.ts",
      [
        "  - docs/design/60-rollout/runbook.md",
        "  - docs/design/60-rollout/dashboards/grafana.json",
        "  - docs/design/60-rollout/alert-rules.yaml",
      ].join("\n"),
    );
    writeFileSync(join(dir, "w9-rollout-hardening.yaml"), docsMeta);
    const result = checkTrackMetas({
      trackMetaDir: dir,
      allowedRoots: DEFAULT_ALLOWED_ROOTS,
    });
    expect(result.findings).toEqual([]);
    expect(result.total_files).toBe(1);
  });
});
