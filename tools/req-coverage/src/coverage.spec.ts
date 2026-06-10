import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCoverage } from "./coverage.js";

function makeFixture(): {
  root: string;
  catalogDir: string;
  testsDir: string;
  writeReq(name: string, body: string): void;
  writeTest(relPath: string, body: string): void;
} {
  const root = mkdtempSync(join(tmpdir(), "req-coverage-"));
  const catalogDir = join(root, "requirements");
  const testsDir = join(root, "tests");
  mkdirSync(catalogDir);
  mkdirSync(testsDir);
  return {
    root,
    catalogDir,
    testsDir,
    writeReq: (name, body) => writeFileSync(join(catalogDir, name), body),
    writeTest: (relPath, body) => {
      const full = join(testsDir, relPath);
      mkdirSync(join(full, ".."), { recursive: true });
      writeFileSync(full, body);
    },
  };
}

const REQ_WITH_TWO_CRITICALS = (id: string) => `---
id: ${id}
schema_version: 3
name: Test
category: capability
severity: critical
status: approved
owners:
  product: "@pm"
  technical: "@tech"
  qa: "@qa"
business_rationale: rationale
---
# Test
## Acceptance Criteria
### \`alpha\` - first
\`\`\`yaml
criterion:
  id: alpha
  severity: critical
\`\`\`
### \`beta\` - second
\`\`\`yaml
criterion:
  id: beta
  severity: high
\`\`\`
### \`gamma\` - third (low severity)
\`\`\`yaml
criterion:
  id: gamma
  severity: low
\`\`\`
`;

describe("req-coverage", () => {
  it("reports 100% covered when every gated criterion has a tagged test", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion alpha', () => {});
describe('@req REQ-CAP-X @criterion beta', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.uncovered_criteria).toBe(0);
    expect(result.gated_criteria).toBe(2);
    expect(result.total_test_tags).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it("flags an uncovered critical criterion", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion beta', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.uncovered_criteria).toBe(1);
    const finding = result.findings.find((f) => f.rule === "coverage-missing");
    expect(finding?.message).toContain("REQ-CAP-X::alpha");
  });

  it("does not gate low-severity criteria by default", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion alpha', () => {});
describe('@req REQ-CAP-X @criterion beta', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.gated_criteria).toBe(2);
    expect(result.total_criteria).toBe(3);
  });

  it("flags drifted tags (tests reference unknown criterion-ids)", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion alpha', () => {});
describe('@req REQ-CAP-X @criterion beta', () => {});
describe('@req REQ-CAP-X @criterion deleted-criterion', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.drifted_tags).toBe(1);
    const drift = result.findings.find((f) => f.rule === "test-drift");
    expect(drift?.message).toContain("deleted-criterion");
  });

  it("flags tests referencing unknown REQ ids as drift", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion alpha', () => {});
describe('@req REQ-CAP-X @criterion beta', () => {});
describe('@req REQ-CAP-Z @criterion alpha', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.drifted_tags).toBe(1);
  });

  it("with no tests, marks every gated criterion as uncovered", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.gated_criteria).toBe(2);
    expect(result.uncovered_criteria).toBe(2);
    expect(result.total_test_tags).toBe(0);
  });

  it("honors a narrower --gate-severity (critical only)", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.spec.ts",
      `describe('@req REQ-CAP-X @criterion alpha', () => {});`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical"],
    });
    expect(result.gated_criteria).toBe(1);
    expect(result.uncovered_criteria).toBe(0);
  });

  it("ignores non-test files", () => {
    const env = makeFixture();
    env.writeReq("REQ-CAP-X.md", REQ_WITH_TWO_CRITICALS("REQ-CAP-X"));
    env.writeTest(
      "x.ts",
      `// Production code referencing the tag in a comment:
// @req REQ-CAP-X @criterion alpha
`,
    );
    const result = runCoverage({
      catalogDir: env.catalogDir,
      testRoots: [env.testsDir],
      gatedSeverities: ["critical", "high"],
    });
    expect(result.total_test_tags).toBe(0);
  });
});
