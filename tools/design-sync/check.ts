// Static checks for client design manifests.
//
// For every clients/designs/<surface>/design.yaml:
//   - parses the YAML
//   - verifies prd: target file exists (when set)
//   - verifies each listed snapshot file exists on disk
//   - verifies each maps_to_req (if not "TBD") resolves to a real REQ file
//   - verifies code_connect.mappings paths resolve in code_connect.root
//     (mappings with `pending:` must reference a real REQ; mappings with
//     `external:` are skipped — they target third-party packages)
//
// Exits 0 (with informational log) when no design surfaces exist — keeps
// the G.design-sync gate a no-op for backend-only adoptions of this template.
//
// Wired into orchestration/gates/gate-check.sh as G.design-sync.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DESIGNS_DIR = join(REPO_ROOT, "clients", "designs");
const REQUIREMENTS_DIR = join(REPO_ROOT, "requirements");

interface DesignNode {
  id: string;
  name: string;
  snapshot?: string;
  structure?: string;
  maps_to_req?: string;
}
interface CodeConnectMapping {
  component?: string;
  external?: string;
  pending?: string;
  planned_component?: string;
  figma_name?: string;
}
interface CodeConnectBlock {
  package?: string;
  root?: string;
  mappings?: Record<string, CodeConnectMapping>;
}
interface DesignManifest {
  prd?: string;
  figma?: { file_url?: string; last_synced?: string };
  nodes?: DesignNode[];
  code_connect?: CodeConnectBlock;
}

function listSurfaceDirs(): string[] {
  if (!existsSync(DESIGNS_DIR)) return [];
  return readdirSync(DESIGNS_DIR)
    .filter((name) => statSync(join(DESIGNS_DIR, name)).isDirectory())
    .filter((name) => existsSync(join(DESIGNS_DIR, name, "design.yaml")));
}

interface Issue {
  surface: string;
  severity: "error" | "warn";
  message: string;
}

function checkSurface(slug: string): Issue[] {
  const issues: Issue[] = [];
  const surfaceDir = join(DESIGNS_DIR, slug);
  const yamlPath = join(surfaceDir, "design.yaml");
  let manifest: DesignManifest;
  try {
    manifest = parseYaml(readFileSync(yamlPath, "utf8")) as DesignManifest;
  } catch (err) {
    issues.push({ surface: slug, severity: "error", message: `unparseable design.yaml: ${(err as Error).message}` });
    return issues;
  }

  if (manifest.prd) {
    const prdAbs = join(REPO_ROOT, manifest.prd);
    if (!existsSync(prdAbs)) {
      issues.push({ surface: slug, severity: "error", message: `prd target not found: ${manifest.prd}` });
    }
  }

  if (!manifest.figma?.file_url) {
    issues.push({ surface: slug, severity: "error", message: "design.yaml missing figma.file_url" });
  }
  if (!manifest.figma?.last_synced || manifest.figma.last_synced === "TBD") {
    issues.push({ surface: slug, severity: "warn", message: "figma.last_synced is unset — run `pnpm --filter @charliehealth/design-sync sync " + slug + "`" });
  }

  if (!manifest.nodes?.length) {
    issues.push({ surface: slug, severity: "error", message: "design.yaml has no nodes" });
    return issues;
  }

  for (const node of manifest.nodes) {
    if (!node.id || !node.name) {
      issues.push({ surface: slug, severity: "error", message: `node missing id or name: ${JSON.stringify(node)}` });
      continue;
    }
    const snapshotRel = node.snapshot ?? `snapshots/${node.name}.png`;
    const snapshotAbs = join(surfaceDir, snapshotRel);
    if (!existsSync(snapshotAbs)) {
      issues.push({ surface: slug, severity: "error", message: `node ${node.id} (${node.name}): snapshot missing at ${snapshotRel}` });
    }

    if (node.maps_to_req && node.maps_to_req !== "TBD") {
      const reqFile = join(REQUIREMENTS_DIR, `${node.maps_to_req}.md`);
      if (!existsSync(reqFile)) {
        issues.push({ surface: slug, severity: "error", message: `node ${node.id}: maps_to_req=${node.maps_to_req} does not resolve to ${reqFile}` });
      }
    } else {
      issues.push({ surface: slug, severity: "warn", message: `node ${node.id} (${node.name}): maps_to_req is TBD` });
    }
  }

  const cc = manifest.code_connect;
  if (cc?.mappings) {
    if (!cc.root) {
      issues.push({ surface: slug, severity: "error", message: "code_connect.mappings present but code_connect.root is unset" });
    } else {
      const ccRootAbs = join(REPO_ROOT, cc.root);
      if (!existsSync(ccRootAbs)) {
        issues.push({ surface: slug, severity: "error", message: `code_connect.root not found: ${cc.root}` });
      } else {
        for (const [nodeId, m] of Object.entries(cc.mappings)) {
          if (m.external) continue;
          if (m.pending) {
            const reqFile = join(REQUIREMENTS_DIR, `${m.pending}.md`);
            if (!existsSync(reqFile)) {
              issues.push({ surface: slug, severity: "error", message: `code_connect[${nodeId}]: pending=${m.pending} does not resolve to ${reqFile}` });
            }
            continue;
          }
          if (!m.component) {
            issues.push({ surface: slug, severity: "error", message: `code_connect[${nodeId}]: must set one of component / external / pending` });
            continue;
          }
          const componentDir = join(ccRootAbs, m.component);
          if (!existsSync(componentDir)) {
            issues.push({ surface: slug, severity: "error", message: `code_connect[${nodeId}]: component ${m.component} not found at ${cc.root}/${m.component}` });
          }
        }
      }
    }
    const instanceIds = collectInstanceIds(surfaceDir, manifest.nodes ?? []);
    const mapped = new Set(Object.keys(cc.mappings));
    const unmapped = [...instanceIds].filter((id) => !mapped.has(id));
    if (unmapped.length > 0) {
      issues.push({ surface: slug, severity: "warn", message: `${unmapped.length} instance(s) in structure xml have no code_connect mapping (e.g. ${unmapped.slice(0, 5).join(", ")})` });
    }
  }

  return issues;
}

function collectInstanceIds(surfaceDir: string, nodes: DesignNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node.structure) continue;
    const abs = join(surfaceDir, node.structure);
    if (!existsSync(abs)) continue;
    const xml = readFileSync(abs, "utf8");
    for (const m of xml.matchAll(/<instance\s+id="([0-9:]+)"/g)) {
      ids.add(m[1]);
    }
  }
  return ids;
}

function main(): void {
  const surfaces = listSurfaceDirs();
  if (surfaces.length === 0) {
    console.log("design-sync check: no design surfaces found");
    process.exit(0);
  }

  let errors = 0;
  let warns = 0;
  for (const slug of surfaces) {
    const issues = checkSurface(slug);
    if (issues.length === 0) {
      console.log(`✓ ${slug}`);
      continue;
    }
    console.log(`· ${slug}`);
    for (const issue of issues) {
      const tag = issue.severity === "error" ? "ERROR" : "warn ";
      console.log(`  ${tag}  ${issue.message}`);
      if (issue.severity === "error") errors++;
      else warns++;
    }
  }

  console.log(`\n${surfaces.length} surface(s), ${errors} error(s), ${warns} warning(s)`);
  process.exit(errors > 0 ? 1 : 0);
}

main();
