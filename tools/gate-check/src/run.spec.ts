import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runGate } from "./run.js";

interface CommandLog {
  cmd: string;
  result: { status: number; stderr: string; stdout: string };
}

function makeRunner(plan: Record<string, number>): {
  runner: (cmd: string, cwd: string) => { status: number; stderr: string; stdout: string };
  log: CommandLog[];
} {
  const log: CommandLog[] = [];
  const runner = (cmd: string, _cwd: string) => {
    const status = plan[cmd] ?? 0;
    const result = { status, stderr: "", stdout: "" };
    log.push({ cmd, result });
    return result;
  };
  return { runner, log };
}

function makeGatesFile(json: object): string {
  const dir = mkdtempSync(join(tmpdir(), "gate-check-"));
  const path = join(dir, "gates.json");
  writeFileSync(path, JSON.stringify(json, null, 2));
  return path;
}

const TWO_GATE_FILE = {
  schema_version: 1,
  gates: [
    {
      id: "G.wave-1-slots",
      description: "Wave 1 slot-domain gate",
      requires: ["w1-domain-slots"],
      commands: ["pnpm typecheck", "pnpm test"],
    },
    {
      id: "G.wave-1-cancel",
      description: "Wave 1 cancel gate",
      commands: ["echo cancel"],
    },
  ],
};

describe("gate-check runGate", () => {
  it("returns 0 when all commands succeed", () => {
    const gatesFile = makeGatesFile(TWO_GATE_FILE);
    const { runner, log } = makeRunner({ "pnpm typecheck": 0, "pnpm test": 0 });
    const stdout: string[] = [];
    const stderr: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.wave-1-slots",
      stdout: (s) => stdout.push(s),
      stderr: (s) => stderr.push(s),
      runCommand: runner,
    });
    expect(rc).toBe(0);
    expect(log.map((l) => l.cmd)).toEqual(["pnpm typecheck", "pnpm test"]);
    expect(stdout.join("\n")).toContain("PASSED");
  });

  it("returns 1 on first failing command and stops", () => {
    const gatesFile = makeGatesFile(TWO_GATE_FILE);
    const { runner, log } = makeRunner({ "pnpm typecheck": 0, "pnpm test": 7 });
    const stdout: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.wave-1-slots",
      stdout: (s) => stdout.push(s),
      stderr: () => undefined,
      runCommand: runner,
    });
    expect(rc).toBe(1);
    expect(log.map((l) => l.cmd)).toEqual(["pnpm typecheck", "pnpm test"]);
    expect(stdout.join("\n")).toContain("FAILED");
    expect(stdout.join("\n")).toContain("exit 7");
  });

  it("returns 1 on the very first command failure (does not continue)", () => {
    const gatesFile = makeGatesFile(TWO_GATE_FILE);
    const { runner, log } = makeRunner({ "pnpm typecheck": 1 });
    const stdout: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.wave-1-slots",
      stdout: (s) => stdout.push(s),
      stderr: () => undefined,
      runCommand: runner,
    });
    expect(rc).toBe(1);
    expect(log.map((l) => l.cmd)).toEqual(["pnpm typecheck"]); // never ran pnpm test
  });

  it("returns 3 when gate-id is unknown", () => {
    const gatesFile = makeGatesFile(TWO_GATE_FILE);
    const { runner } = makeRunner({});
    const stderr: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.nope",
      stdout: () => undefined,
      stderr: (s) => stderr.push(s),
      runCommand: runner,
    });
    expect(rc).toBe(3);
    expect(stderr.join("\n")).toContain("gate not found: G.nope");
  });

  it("returns 4 when the gate has no commands", () => {
    const gatesFile = makeGatesFile({
      schema_version: 1,
      gates: [{ id: "G.empty", commands: [] }],
    });
    const { runner } = makeRunner({});
    const stderr: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.empty",
      stdout: () => undefined,
      stderr: (s) => stderr.push(s),
      runCommand: runner,
    });
    expect(rc).toBe(4);
  });

  it("returns 2 when gates.json is missing or malformed", () => {
    const { runner } = makeRunner({});
    const stderr: string[] = [];
    const rc = runGate({
      gatesFile: "/no/such/path/gates.json",
      gateId: "G.x",
      stdout: () => undefined,
      stderr: (s) => stderr.push(s),
      runCommand: runner,
    });
    expect(rc).toBe(2);
  });

  it("returns 2 when gates.json is missing the `gates` array", () => {
    const gatesFile = makeGatesFile({ schema_version: 1 } as object);
    const { runner } = makeRunner({});
    const stderr: string[] = [];
    const rc = runGate({
      gatesFile,
      gateId: "G.x",
      stdout: () => undefined,
      stderr: (s) => stderr.push(s),
      runCommand: runner,
    });
    expect(rc).toBe(2);
  });

  it("includes the gate description in stdout when present", () => {
    const gatesFile = makeGatesFile(TWO_GATE_FILE);
    const { runner } = makeRunner({ "echo cancel": 0 });
    const stdout: string[] = [];
    runGate({
      gatesFile,
      gateId: "G.wave-1-cancel",
      stdout: (s) => stdout.push(s),
      stderr: () => undefined,
      runCommand: runner,
    });
    expect(stdout.join("\n")).toContain("Wave 1 cancel gate");
  });
});
