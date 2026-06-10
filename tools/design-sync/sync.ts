// Sync a client design surface against the Figma Dev Mode MCP server.
//
// Reads clients/designs/<surface>/design.yaml, then for each listed node:
//   - calls get_screenshot → writes snapshots/<name>.png
//   - calls get_metadata → writes snapshots/<name>.structure.xml
//   - calls get_variable_defs (once, on the first node) → writes tokens.json
// Updates last_synced + last_synced_by in design.yaml.
//
// Usage:
//   pnpm --filter @charliehealth/design-sync sync <surface-slug>
//
// Prereq: Figma desktop running with "Enable local MCP Server" toggled on.
// Override endpoint with FIGMA_MCP_URL (default http://127.0.0.1:3845/mcp).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { callTool } from "./mcp-client.js";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DESIGNS_DIR = join(REPO_ROOT, "clients", "designs");

interface DesignNode {
  id: string;
  name: string;
  snapshot?: string;
  [k: string]: unknown;
}
interface DesignManifest {
  prd: string;
  figma: {
    file_url: string;
    file_key: string;
    file_name: string;
    file_version?: string;
    last_synced?: string;
    last_synced_by?: string;
    synced_via?: string;
  };
  nodes: DesignNode[];
  [k: string]: unknown;
}

function gitUserName(): string {
  try {
    return execSync("git config user.name", { encoding: "utf8" }).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function findFirstImage(content: Array<{ type: string; data?: string; mimeType?: string }>): { data: string; mimeType: string } | undefined {
  for (const part of content) {
    if (part.type === "image" && part.data) {
      return { data: part.data, mimeType: part.mimeType ?? "image/png" };
    }
  }
  return undefined;
}

function findFirstText(content: Array<{ type: string; text?: string }>): string | undefined {
  for (const part of content) {
    if (part.type === "text" && part.text) return part.text;
  }
  return undefined;
}

async function syncSurface(slug: string): Promise<void> {
  const surfaceDir = join(DESIGNS_DIR, slug);
  const yamlPath = join(surfaceDir, "design.yaml");
  if (!existsSync(yamlPath)) {
    throw new Error(`design.yaml not found at ${yamlPath}`);
  }

  const raw = readFileSync(yamlPath, "utf8");
  const manifest = parseYaml(raw) as DesignManifest;

  if (!manifest.nodes?.length) {
    throw new Error(`No nodes listed in ${yamlPath}`);
  }

  const snapshotsDir = join(surfaceDir, "snapshots");
  mkdirSync(snapshotsDir, { recursive: true });

  console.log(`Syncing ${slug}: ${manifest.nodes.length} node(s) from ${manifest.figma.file_url}`);

  for (const node of manifest.nodes) {
    console.log(`  · ${node.id} (${node.name}) — fetching screenshot + structure`);
    const shotResult = await callTool("get_screenshot", { nodeId: node.id });
    const image = findFirstImage(shotResult.content);
    if (!image) {
      console.warn(`    ! no image returned for ${node.id}, skipping snapshot`);
    } else {
      const snapshotRel = node.snapshot ?? `snapshots/${node.name}.png`;
      const snapshotAbs = join(surfaceDir, snapshotRel);
      mkdirSync(dirname(snapshotAbs), { recursive: true });
      writeFileSync(snapshotAbs, Buffer.from(image.data, "base64"));
      node.snapshot = snapshotRel;
      console.log(`    ✓ ${snapshotRel} (${(Buffer.from(image.data, "base64").length / 1024).toFixed(1)} KiB)`);
    }

    const metaResult = await callTool("get_metadata", {
      nodeId: node.id,
      clientFrameworks: "react",
      clientLanguages: "typescript",
    });
    const metaText = findFirstText(metaResult.content);
    if (metaText) {
      // Strip the trailing "IMPORTANT: After you call this tool..." instruction
      // the Figma MCP appends — it's guidance for an LLM caller, not part of the
      // structural spec.
      const xmlEnd = metaText.lastIndexOf("</frame>");
      const xml = xmlEnd >= 0 ? metaText.slice(0, xmlEnd + "</frame>".length) : metaText;
      const structureRel = `snapshots/${node.name}.structure.xml`;
      writeFileSync(join(surfaceDir, structureRel), xml + "\n");
      console.log(`    ✓ ${structureRel} (${(xml.length / 1024).toFixed(1)} KiB)`);
    } else {
      console.warn(`    ! no structure returned for ${node.id}`);
    }
  }

  // Token defs are file-level. Pull once using the first node id.
  const firstNode = manifest.nodes[0];
  console.log(`  · tokens.json (variables for ${firstNode.id})`);
  const varsResult = await callTool("get_variable_defs", {
    nodeId: firstNode.id,
    clientFrameworks: "react",
    clientLanguages: "typescript",
  });
  const varsText = findFirstText(varsResult.content);
  if (varsText) {
    const tokensPath = join(surfaceDir, "tokens.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(varsText);
    } catch {
      parsed = { _raw: varsText };
    }
    const wrapped = {
      _source: "Figma MCP get_variable_defs",
      _node_id: firstNode.id,
      _synced: todayIso(),
      variables: parsed,
    };
    writeFileSync(tokensPath, JSON.stringify(wrapped, null, 2) + "\n");
    console.log(`    ✓ tokens.json`);
  } else {
    console.warn("    ! no variable defs returned");
  }

  manifest.figma.last_synced = todayIso();
  manifest.figma.last_synced_by = gitUserName();
  manifest.figma.synced_via = "figma-mcp";
  writeFileSync(yamlPath, stringifyYaml(manifest));
  console.log(`  ✓ design.yaml updated (last_synced=${manifest.figma.last_synced})`);
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error("Usage: tsx sync.ts <surface-slug>");
    console.error(`Available surfaces in ${DESIGNS_DIR}:`);
    process.exit(2);
  }
  try {
    await syncSurface(slug);
  } catch (err) {
    console.error(`design-sync failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
