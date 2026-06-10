#!/usr/bin/env -S npx tsx
/**
 * gate-check — synchronization gate runner.
 *
 * Reads `orchestration/gates/gates.json`, locates the gate by `id`,
 * runs its `commands:` array sequentially. Exit 0 if all commands
 * succeed; exit non-zero (and stop) on the first failure.
 *
 * Stack-agnostic: the gate's commands are arbitrary shell commands
 * authored at wave-planning time (Phase 4). Typical commands for the
 * TypeScript engagement are `pnpm typecheck` and `pnpm test`. See
 * docs/USER-GUIDE.md §Appendix A "Wave gate-check" + manager-kickoff
 * §"Lifecycle Step 8" for orchestration semantics.
 *
 * Doc-stable entry point: `./orchestration/gates/gate-check.sh <gate-id>`
 * which is a thin shim that execs this script.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Gate {
  id: string;
  description?: string;
  requires?: string[];
  commands: string[];
}

interface GatesFile {
  schema_version?: number;
  gates: Gate[];
  future_gates?: Gate[];
}

export type ExitCode = 0 | 1 | 2 | 3 | 4;

export interface RunOptions {
  gatesFile: string;
  gateId: string;
  cwd?: string;
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Override the actual command runner (for tests). */
  runCommand?: (cmd: string, cwd: string) => { status: number; stderr: string; stdout: string };
}

function defaultRunCommand(cmd: string, cwd: string): { status: number; stderr: string; stdout: string } {
  const result = spawnSync(cmd, {
    cwd,
    shell: true,
    stdio: ["ignore", "inherit", "inherit"],
    encoding: "utf8",
  });
  return { status: result.status ?? 1, stderr: "", stdout: "" };
}

export function loadGates(gatesFile: string): GatesFile {
  const content = readFileSync(gatesFile, "utf8");
  const parsed = JSON.parse(content) as GatesFile;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.gates)) {
    throw new Error(`${gatesFile}: expected top-level object with a \`gates\` array`);
  }
  return parsed;
}

export function findGate(gates: GatesFile, gateId: string): Gate | null {
  return gates.gates.find((g) => g.id === gateId) ?? null;
}

export function runGate(options: RunOptions): ExitCode {
  const stdout = options.stdout ?? ((s) => process.stdout.write(s + "\n"));
  const stderr = options.stderr ?? ((s) => process.stderr.write(s + "\n"));
  const cwd = options.cwd ?? process.cwd();
  const runCmd = options.runCommand ?? defaultRunCommand;

  let gatesFile: GatesFile;
  try {
    gatesFile = loadGates(options.gatesFile);
  } catch (err) {
    stderr(`gate-check: cannot load ${options.gatesFile}: ${(err as Error).message}`);
    return 2;
  }

  const gate = findGate(gatesFile, options.gateId);
  if (!gate) {
    const known = gatesFile.gates.map((g) => g.id);
    stderr(
      `gate-check: gate not found: ${options.gateId}` +
        (known.length > 0 ? ` (known: ${known.join(", ")})` : " (gates list is empty)"),
    );
    return 3;
  }
  if (!Array.isArray(gate.commands) || gate.commands.length === 0) {
    stderr(`gate-check: gate "${options.gateId}" has no \`commands:\` to run`);
    return 4;
  }

  stdout(`gate-check: running gate '${gate.id}' (${gate.commands.length} command${gate.commands.length === 1 ? "" : "s"})`);
  if (gate.description) stdout(`  ${gate.description}`);

  for (let i = 0; i < gate.commands.length; i++) {
    const cmd = gate.commands[i];
    if (typeof cmd !== "string" || cmd.trim().length === 0) {
      stderr(`gate-check: command #${i + 1} is empty or non-string`);
      return 4;
    }
    stdout("");
    stdout(`  $ ${cmd}`);
    const { status } = runCmd(cmd, cwd);
    if (status === 0) {
      stdout("    [pass]");
    } else {
      stdout(`    [fail] (exit ${status})`);
      stdout("");
      stdout(`gate-check: ${gate.id} FAILED`);
      return 1;
    }
  }
  stdout("");
  stdout(`gate-check: ${gate.id} PASSED`);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  gateId: string | null;
  gatesFile: string;
  list: boolean;
  help: boolean;
}

const HELP = `gate-check — run a named gate from orchestration/gates/gates.json

Usage:
  ./orchestration/gates/gate-check.sh <gate-id>
  ./orchestration/gates/gate-check.sh --list
  ./orchestration/gates/gate-check.sh --help

Options:
  --gates-file <path>   default: orchestration/gates/gates.json
  --list                show known gate ids + descriptions
  -h, --help            show this help

Exit codes:
  0  gate passed (all commands exited 0)
  1  gate failed (at least one command exited non-zero)
  2  cannot load gates.json (missing or malformed)
  3  gate-id not found in gates.json
  4  gate has no commands to run / a command is empty
`;

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    gateId: null,
    gatesFile: "orchestration/gates/gates.json",
    list: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "-h" || token === "--help") args.help = true;
    else if (token === "--list") args.list = true;
    else if (token === "--gates-file") {
      const next = argv[i + 1];
      if (!next) throw new Error("--gates-file requires a path");
      args.gatesFile = next;
      i++;
    } else if (token?.startsWith("--gates-file=")) {
      args.gatesFile = token.slice("--gates-file=".length);
    } else if (token && !token.startsWith("-")) {
      if (args.gateId !== null) throw new Error(`unexpected positional argument: ${token}`);
      args.gateId = token;
    } else {
      throw new Error(`unknown argument: ${token}`);
    }
  }
  return args;
}

export function runCli(
  argv: readonly string[],
  stdout: (s: string) => void = (s) => process.stdout.write(s + "\n"),
  stderr: (s: string) => void = (s) => process.stderr.write(s + "\n"),
): number {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    stderr(`gate-check: ${(err as Error).message}`);
    stderr(HELP);
    return 2;
  }
  if (args.help) {
    stdout(HELP);
    return 0;
  }
  const gatesFile = resolve(args.gatesFile);
  if (args.list) {
    let gates: GatesFile;
    try {
      gates = loadGates(gatesFile);
    } catch (err) {
      stderr(`gate-check: ${(err as Error).message}`);
      return 2;
    }
    if (gates.gates.length === 0) {
      stdout("(no gates defined; orchestration/gates/gates.json gates[] is empty)");
      return 0;
    }
    for (const g of gates.gates) {
      stdout(`${g.id}\t${g.description ?? ""}`);
    }
    return 0;
  }
  if (!args.gateId) {
    stderr("gate-check: missing <gate-id> argument");
    stderr(HELP);
    return 2;
  }
  return runGate({ gatesFile, gateId: args.gateId, stdout, stderr });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exit(runCli(process.argv.slice(2)));
}
