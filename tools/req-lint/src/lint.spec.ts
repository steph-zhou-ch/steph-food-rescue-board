import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverReqFiles, lintCatalog } from "./lint.js";

function makeCatalog(): string {
  return mkdtempSync(join(tmpdir(), "req-lint-"));
}

const VALID_CAPABILITY = `---
id: REQ-CAP-TEST
schema_version: 3
name: Test capability
category: capability
severity: high
status: approved
owners:
  product: "@pm-test"
  technical: "@tech-test"
  qa: "@qa-test"
invariants_respected:
  - REQ-INV-EXAMPLE
business_rationale: |
  This is a worked test fixture that exercises req-lint against a
  well-formed REQ. It must lint cleanly.
---

# Test capability

## Product Contract

PM-owned section.

## Technical Contract

Tech-owned section.

## Acceptance Criteria

### \`crit-one\` - First criterion

**Owner**: technical

\`\`\`yaml
criterion:
  id: crit-one
  owner: technical
  severity: high
  predicate: |
    The system does the thing.
\`\`\`
`;

const VALID_INVARIANT = `---
id: REQ-INV-EXAMPLE
schema_version: 3
name: Example invariant
category: invariant
severity: critical
status: approved
owners:
  product: "@pm-test"
  technical: "@tech-test"
  qa: "@qa-test"
business_rationale: |
  Invariant rationale.
---

# Example invariant

## Acceptance Criteria

### \`always-true\` - Always true

\`\`\`yaml
criterion:
  id: always-true
  owner: technical
  severity: critical
  predicate: |
    Always true.
\`\`\`
`;

describe("req-lint", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    tempDirs.length = 0; // we don't clean tmpdirs aggressively — vitest reruns are independent
  });

  describe("discoverReqFiles", () => {
    it("finds single-file REQs and ignores templates/READMEs", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      writeFileSync(join(dir, "REQ-CAP-ONE.md"), VALID_CAPABILITY);
      writeFileSync(join(dir, "REQ-INV-TWO.md"), VALID_INVARIANT);
      writeFileSync(join(dir, "_template.md"), "---\n---\n");
      writeFileSync(join(dir, "README.md"), "# readme");

      const files = discoverReqFiles(dir);
      expect(files.map((f) => f.expectedId)).toEqual([
        "REQ-CAP-ONE",
        "REQ-INV-TWO",
      ]);
    });

    it("finds directory-style REQs via index.md", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      mkdirSync(join(dir, "REQ-CAP-DIR"));
      writeFileSync(join(dir, "REQ-CAP-DIR", "index.md"), VALID_CAPABILITY);
      const files = discoverReqFiles(dir);
      expect(files.map((f) => f.expectedId)).toContain("REQ-CAP-DIR");
    });
  });

  describe("lintCatalog", () => {
    it("returns zero error-level findings for a well-formed catalog", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), VALID_CAPABILITY);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);

      const result = lintCatalog({ catalogDir: dir });
      const errors = result.findings.filter((f) => f.level === "error");
      expect(errors).toEqual([]);
      expect(result.total_files).toBe(2);
    });

    it("flags id-filename mismatch", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      const bad = VALID_CAPABILITY.replace("id: REQ-CAP-TEST", "id: REQ-CAP-WRONG");
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), bad);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);

      const result = lintCatalog({ catalogDir: dir });
      const rule = result.findings.find((f) => f.rule === "id-filename-mismatch");
      expect(rule).toBeDefined();
      expect(rule?.level).toBe("error");
    });

    it("flags wrong schema_version", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      const bad = VALID_CAPABILITY.replace("schema_version: 3", "schema_version: 2");
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), bad);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);
      const result = lintCatalog({ catalogDir: dir });
      expect(result.findings.find((f) => f.rule === "schema-version")).toBeDefined();
    });

    it("flags missing owner role", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      const bad = VALID_CAPABILITY.replace(/  qa: "@qa-test"\n/, "");
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), bad);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);
      const result = lintCatalog({ catalogDir: dir });
      const triadFinding = result.findings.find((f) => f.rule === "owners-triad");
      expect(triadFinding?.message).toContain("owners.qa");
    });

    it("flags invariants_respected referencing an unknown REQ", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), VALID_CAPABILITY);
      // do NOT write REQ-INV-EXAMPLE — the capability's reference is unresolved
      const result = lintCatalog({ catalogDir: dir });
      const unresolved = result.findings.find((f) => f.rule === "invariants-respected-unresolved");
      expect(unresolved).toBeDefined();
    });

    it("flags criterion id mismatch with heading", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      const bad = VALID_CAPABILITY.replace("  id: crit-one\n", "  id: crit-different\n");
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), bad);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);
      const result = lintCatalog({ catalogDir: dir });
      expect(result.findings.find((f) => f.rule === "criterion-id-heading-mismatch")).toBeDefined();
    });

    it("flags unparseable embedded YAML", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      const bad = VALID_CAPABILITY.replace(
        "  predicate: |\n    The system does the thing.\n",
        "  predicate: |\n    The system does\n   - !!! bad indent: :: ::\n",
      );
      // Build a clearly invalid YAML block instead
      const bad2 = bad.replace(
        "\`\`\`yaml\ncriterion:\n  id: crit-one\n  owner: technical\n  severity: high\n  predicate: |\n    The system does\n   - !!! bad indent: :: ::\n\`\`\`",
        "\`\`\`yaml\ncriterion: {\n  id: crit-one,\n  this is not valid yaml at all: : : :\n\`\`\`",
      );
      writeFileSync(join(dir, "REQ-CAP-TEST.md"), bad2);
      writeFileSync(join(dir, "REQ-INV-EXAMPLE.md"), VALID_INVARIANT);
      const result = lintCatalog({ catalogDir: dir });
      // Either parse error, or shape error (depending on what yaml's tolerance produces)
      const yamlIssue = result.findings.find(
        (f) => f.rule === "criterion-yaml-parse" || f.rule === "criterion-shape" || f.rule === "criterion-id-heading-mismatch",
      );
      expect(yamlIssue).toBeDefined();
    });

    it("flags missing frontmatter", () => {
      const dir = makeCatalog();
      tempDirs.push(dir);
      writeFileSync(join(dir, "REQ-CAP-NOFM.md"), "# no frontmatter here\n");
      const result = lintCatalog({ catalogDir: dir });
      expect(result.findings.find((f) => f.rule === "frontmatter-missing")).toBeDefined();
    });
  });
});
