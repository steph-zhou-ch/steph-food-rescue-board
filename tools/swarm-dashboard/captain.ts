/**
 * Captain Dashboard — the panel I (the Captain) wish I had during this
 * engagement. Built on top of the same data sources as render.ts but with
 * a different lens: forward-looking decision queue, stall detector,
 * audit-findings explorer, worker pulse, REQ coverage matrix,
 * recipe-lesson tracker, and a deeply interpreted live activity feed.
 *
 * Self-contained dark-mode single-page HTML. No framework. Search with `/`,
 * navigate with `j/k`, drill-down with click-to-expand. Polls every 30s.
 *
 * Serve: `GET /captain` (see serve.ts). Render to file: `pnpm captain`.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  gitFetch,
  gitLog,
  gitLsTree,
  gitShow,
  loadCatalogFull,
  loadTrackMetas,
  safeParseYamlString,
  scionList,
} from "./render.ts";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const DIST = join(import.meta.dirname, "dist", "captain-dashboard.html");

// ---------- types ----------

type Verdict = "approved" | "rejected" | "unknown";
type AuditKind = "spec-adherence" | "code-review-codex";

type AuditEntry = {
  branch: string;            // origin/swarm/w<N>-batch-<M>-<auditor>
  wave: number;
  batch: string;             // batch label e.g. "2", "B2"
  auditor: AuditKind;
  cycle: number;
  verdict: Verdict;
  reviewedAt?: string;       // ISO
  auditedBranches: string[]; // worker branches@sha that were audited
  findings: Finding[];
  pathOnBranch: string;      // orchestration/reviews/w<N>-...-md
};

type Finding = {
  id: string;                // CR-CDX-w2-001 / SA-w3-cancel-001
  severity: "critical" | "high" | "medium" | "low";
  kind?: string;
  targetTrack?: string;
  file?: string;
  line?: number;
  observation?: string;
  whyItMatters?: string;
  suggestedFix?: string;
};

type ClosureLesson = {
  letter: string;       // "A", "B", "BB"
  wave: number;
  title: string;
  body: string;
};

type WorkerStatus = {
  name: string;
  template: string;
  phase: string;        // running / stopped
  containerUp: string;  // "Up 5 minutes" / "Exited (255) 3 minutes ago"
  lastActivity: string; // "12 seconds ago" / "blocked, 2 min ago"
  classification:
    | "running-healthy"
    | "running-stalled"
    | "stopped-normal"
    | "stopped-stuck"
    | "manager";
  idleSeconds?: number;
};

type CaptainQueueItem = {
  id: string;
  severity: "blocker" | "high" | "medium" | "info";
  title: string;
  detail: string;
  source: string;        // where the signal came from
};

type CommitRow = { sha: string; shortSha: string; author: string; iso: string; subject: string };

// ---------- audit verdict loader ----------

function listAuditBranches(): string[] {
  try {
    const out = execSync(
      `git -C "${REPO_ROOT}" for-each-ref --format='%(refname:short)' refs/remotes/origin/swarm/ 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );
    return out
      .split("\n")
      .map((r) => r.replace(/^'|'$/g, "").trim())
      .filter((r) => r.includes("-code-review-codex") || r.includes("-spec-adherence"));
  } catch {
    return [];
  }
}

function gitShowOn(branch: string, relPath: string): string | null {
  try {
    return execSync(
      `git -C "${REPO_ROOT}" show ${branch}:${relPath} 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

function gitLsTreeOn(branch: string, prefix: string): string[] {
  try {
    const out = execSync(
      `git -C "${REPO_ROOT}" ls-tree --name-only -r ${branch} -- ${prefix} 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function parseAuditFile(branch: string, path: string, text: string): AuditEntry | null {
  // Frontmatter
  const fm = text.match(/^---\n([\s\S]*?)\n---/);
  let frontmatter: {
    auditor?: string;
    model?: string;
    audited_branches?: string[];
    reviewed_at?: string;
    verdict?: string;
    cycle?: number | string;
  } = {};
  if (fm?.[1]) frontmatter = safeParseYamlString(fm[1], {});

  // YAML findings block — fenced ```yaml ... verdict: ... ``` with findings array
  const fenceRe = /```ya?ml\n([\s\S]*?)\n```/g;
  let findings: Finding[] = [];
  let yamlVerdict: string | undefined;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1] ?? "";
    if (!/^findings:|^\s*-\s*id:\s*(CR-CDX|SA-w)/m.test(body) && !/^verdict:/m.test(body)) continue;
    const parsed = safeParseYamlString<{
      verdict?: string;
      findings?: Array<{
        id?: string;
        severity?: Finding["severity"];
        finding_kind?: string;
        target_track?: string;
        file?: string;
        line?: number;
        observation?: string;
        why_it_matters?: string;
        suggested_fix?: string;
      }>;
    }>(body, {});
    if (parsed.verdict && !yamlVerdict) yamlVerdict = parsed.verdict;
    if (parsed.findings) {
      for (const f of parsed.findings) {
        if (!f.id) continue;
        findings.push({
          id: f.id,
          severity: (f.severity ?? "medium") as Finding["severity"],
          kind: f.finding_kind,
          targetTrack: f.target_track,
          file: f.file,
          line: f.line,
          observation: f.observation,
          whyItMatters: f.why_it_matters,
          suggestedFix: f.suggested_fix,
        });
      }
    }
  }

  // Wave + batch + auditor from branch name e.g. "swarm/w3-batch-2-code-review-codex"
  const bn = branch.replace(/^origin\//, "");
  const waveMatch = bn.match(/w(\d+)/);
  const wave = waveMatch ? Number(waveMatch[1]) : -1;
  const batchMatch = bn.match(/batch-(\w+)/);
  const batch = batchMatch ? batchMatch[1]! : "0";
  const auditor: AuditKind = bn.includes("code-review-codex") ? "code-review-codex" : "spec-adherence";

  const verdictRaw = (frontmatter.verdict ?? yamlVerdict ?? "unknown").toLowerCase();
  const verdict: Verdict =
    verdictRaw === "approved" || verdictRaw === "approve" ? "approved" :
    verdictRaw === "rejected" || verdictRaw === "reject" ? "rejected" : "unknown";

  return {
    branch,
    wave,
    batch,
    auditor,
    cycle: Number(frontmatter.cycle ?? 1),
    verdict,
    reviewedAt: frontmatter.reviewed_at,
    auditedBranches: Array.isArray(frontmatter.audited_branches) ? frontmatter.audited_branches : (typeof frontmatter.audited_branches === "string" ? [frontmatter.audited_branches] : []),
    findings,
    pathOnBranch: path,
  };
}

function loadAudits(): AuditEntry[] {
  // Fast path: for each audit branch, identify the per-cycle commits by
  // grepping their subjects (`[complete:<track>] approve cycle <N>` etc.).
  // Read the verdict file at each of those commits — cheap: 1-3 commits per
  // branch instead of walking the full log.
  const branches = listAuditBranches();
  const audits: AuditEntry[] = [];
  for (const br of branches) {
    try {
      // Subjects to match: `[complete:<track>] approve cycle N` /
      //                    `[complete:<track>] reject cycle N` /
      //                    `[complete:<track>] cycle-N approve` etc.
      const log = execSync(
        `git -C "${REPO_ROOT}" log --pretty=format:'%H|%s' ${br} --grep='^\\[complete:.*\\]' 2>/dev/null`,
        { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
      );
      const lines = log.split("\n").filter(Boolean);
      // Always also read the branch tip.
      const tipFiles = gitLsTreeOn(br, "orchestration/reviews/");
      for (const f of tipFiles) {
        if (!f.endsWith(".md") || f.endsWith("README.md")) continue;
        const text = gitShowOn(br, f);
        if (!text) continue;
        const audit = parseAuditFile(br, f, text);
        if (audit) audits.push(audit);
      }
      // Then each verdict-marker commit (typically 1-3 per branch).
      for (const line of lines) {
        const [sha, ...rest] = line.split("|");
        if (!sha) continue;
        for (const f of tipFiles) {
          if (!f.endsWith(".md") || f.endsWith("README.md")) continue;
          const text = gitShowOn(sha, f);
          if (!text) continue;
          const audit = parseAuditFile(br, f, text);
          if (audit) audits.push(audit);
        }
        void rest;
      }
    } catch { /* ignore */ }
  }
  // Dedup: keep ONE entry per (wave, batch, auditor, cycle) — earliest seen.
  const seen = new Map<string, AuditEntry>();
  for (const a of audits) {
    const key = `${a.wave}.${a.batch}.${a.auditor}.${a.cycle}`;
    if (!seen.has(key)) seen.set(key, a);
  }
  return [...seen.values()].sort((a, b) => {
    if (a.wave !== b.wave) return a.wave - b.wave;
    if (a.batch !== b.batch) return a.batch.localeCompare(b.batch);
    if (a.auditor !== b.auditor) return a.auditor.localeCompare(b.auditor);
    return a.cycle - b.cycle;
  });
}

// ---------- closure-report lesson loader ----------

function loadClosures(): ClosureLesson[] {
  const files = gitLsTree("orchestration/reports/");
  const lessons: ClosureLesson[] = [];
  for (const f of files) {
    const m = f.match(/\/w(\d+)-closure\.md$/);
    if (!m) continue;
    const wave = Number(m[1]);
    const text = gitShow(f) ?? "";
    // Find a heading containing "lesson" anywhere (current repo uses
    // "## Recipe-lessons from Wave N" / "## Lessons learned" / etc.)
    const lessonsSection = text.match(/##\s+[^\n]*(?:lesson|recipe)[^\n]*\n([\s\S]+?)(?=\n##\s|\n#\s|$)/i);
    if (!lessonsSection) continue;
    const body = lessonsSection[1] ?? "";
    // Match: `### Lesson <Letter> — <Title>` (em-dash, hyphen, or colon).
    const itemRe = /###\s+Lesson\s+([A-Z]{1,3})\s*[—\-–:]\s*([^\n]+)\n+([\s\S]*?)(?=\n###\s+Lesson\s+|\n##\s|$)/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(body)) !== null) {
      lessons.push({
        letter: im[1]!,
        wave,
        title: (im[2] ?? "").trim(),
        body: (im[3] ?? "").trim(),
      });
    }
  }
  return lessons;
}

// ---------- worker pulse ----------

function loadWorkers(): WorkerStatus[] {
  const out = scionList();
  const workers: WorkerStatus[] = [];
  // scion list columns: NAME TEMPLATE HARNESS-CFG RUNTIME GROVE BROKER PHASE CONTAINER LAST-ACTIVITY
  // Use the header to find phase / container / last-activity indices to be
  // resilient if scion ever adds columns.
  const lines = out.split("\n");
  let headerCols: string[] | null = null;
  let phaseIdx = 6, containerIdx = 7, lastIdx = 8;
  for (const line of lines) {
    if (/^NAME\s/.test(line)) {
      headerCols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
      phaseIdx = headerCols.findIndex((c) => /^PHASE$/i.test(c));
      containerIdx = headerCols.findIndex((c) => /^CONTAINER$/i.test(c));
      lastIdx = headerCols.findIndex((c) => /^LAST\s*ACTIVITY$/i.test(c));
      if (phaseIdx < 0) phaseIdx = 6;
      if (containerIdx < 0) containerIdx = 7;
      if (lastIdx < 0) lastIdx = 8;
      continue;
    }
    if (!/^[a-z0-9][\w-]+\s/.test(line)) continue;
    const cols = line.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    if (cols.length < 6) continue;
    const name = cols[0]!;
    const template = cols[1] ?? "";
    const phase = cols[phaseIdx] ?? "";
    const containerUp = cols[containerIdx] ?? "";
    const lastActivity = cols[lastIdx] ?? "";
    const isManager = name === "manager";
    const idleSeconds = parseIdle(lastActivity);
    const classification =
      isManager ? "manager"
      : phase === "running" && idleSeconds !== undefined && idleSeconds > 600 ? "running-stalled"
      : phase === "running" ? "running-healthy"
      : containerUp.includes("Exited (255)") ? "stopped-normal"
      : "stopped-stuck";
    workers.push({ name, template, phase, containerUp, lastActivity, classification, idleSeconds });
  }
  return workers;
}

function parseIdle(label: string): number | undefined {
  // "12 seconds ago" / "3 minutes ago" / "blocked, 26 seconds ago" / "just now"
  const m = label.match(/(\d+)\s+(second|minute|hour|day)s?\s+ago/i);
  if (!m) {
    if (/just now/i.test(label)) return 0;
    return undefined;
  }
  const n = Number(m[1]);
  const unit = (m[2] ?? "").toLowerCase();
  return n * (unit === "second" ? 1 : unit === "minute" ? 60 : unit === "hour" ? 3600 : 86400);
}

// ---------- captain queue (decisions Captain owes) ----------

function computeCaptainQueue(audits: AuditEntry[], commits: CommitRow[], workers: WorkerStatus[]): CaptainQueueItem[] {
  const q: CaptainQueueItem[] = [];

  // 1. Dual-approve sitting on stage → manager needs to merge to trunk
  const byBatch = new Map<string, AuditEntry[]>();
  for (const a of audits) {
    const k = `w${a.wave}.b${a.batch}`;
    if (!byBatch.has(k)) byBatch.set(k, []);
    byBatch.get(k)!.push(a);
  }
  for (const [key, batch] of byBatch) {
    if (batch.length < 2) continue;
    const allApproved = batch.every((a) => a.verdict === "approved");
    if (!allApproved) continue;
    const waveNum = batch[0]!.wave;
    const batchTrunkMerge = commits.find((c) =>
      c.subject.includes(`wave-${waveNum}`) && c.subject.includes(`batch-${batch[0]!.batch}`) && c.subject.includes("trunk"),
    );
    if (!batchTrunkMerge) {
      q.push({
        id: `merge.${key}`,
        severity: "high",
        title: `${key} dual-approved — awaiting trunk merge`,
        detail: `Both auditors approved cycle ${Math.max(...batch.map((a) => a.cycle))}. Manager should compose-merge + push to origin/main.`,
        source: "audit verdicts",
      });
    }
  }

  // 2. Rejected verdict with no fix-batch dispatched yet
  for (const a of audits) {
    if (a.verdict !== "rejected") continue;
    if (a.findings.length === 0) continue;
    const fixDispatched = commits.find((c) =>
      c.subject.includes(`fix-batch`) && c.subject.includes(`W${a.wave}.B${a.batch}`) && c.subject.includes(`cycle-${a.cycle + 1}`),
    );
    if (!fixDispatched && a.cycle < 3) {
      q.push({
        id: `fix.w${a.wave}.b${a.batch}.cycle${a.cycle}`,
        severity: "blocker",
        title: `W${a.wave}.B${a.batch} cycle-${a.cycle} ${a.auditor === "code-review-codex" ? "codex" : "spec"} rejected — fix-batch owed`,
        detail: `${a.findings.length} findings (${a.findings.filter((f) => f.severity === "critical" || f.severity === "high").length} blocker). Cycle ${a.cycle + 1} dispatch awaited.`,
        source: a.branch,
      });
    }
  }

  // 3. Hardcoded preflight items (Captain-owned)
  q.push({
    id: "w6-sdl-bump",
    severity: "medium",
    title: "W6 preflight: SDL v1.1.0 bump for GroupScheduleSegment.parent",
    detail: "Captain-authored work before W6 dispatch. Plan: do at Wave 5 closure.",
    source: "Task #39",
  });

  // 4. Stalled workers
  for (const w of workers) {
    if (w.classification !== "running-stalled") continue;
    q.push({
      id: `stall.${w.name}`,
      severity: "high",
      title: `${w.name} stalled (${w.idleSeconds}s idle)`,
      detail: `Container ${w.containerUp.toLowerCase()}; last activity ${w.lastActivity}. Likely TUI-prompt / rate-limit dialog — scion look it.`,
      source: "scion list",
    });
  }

  return q;
}

// ---------- activity interpretation ----------

type InterpretedActivity = {
  iso: string;
  shortSha: string;
  icon: string;
  category: "wave-close" | "batch-merge" | "track-merge" | "track-complete" | "audit-approve" | "audit-reject" | "fix-batch" | "audit-prompt" | "docs" | "prep" | "merge" | "other";
  headline: string;
  raw: string;
};

function interpretCommit(c: CommitRow): InterpretedActivity {
  const s = c.subject;
  const base = { iso: c.iso, shortSha: c.shortSha, raw: s };
  if (/^\[close\] Wave/.test(s)) return { ...base, icon: "🏁", category: "wave-close", headline: s.replace(/^\[close\]\s*/, "") };
  if (/^\[merge\] wave-\d+ batch-\d+ → trunk/.test(s)) return { ...base, icon: "🔀", category: "batch-merge", headline: s.replace(/^\[merge\]\s*/, "") };
  if (/^\[merge\] \w[\w-]+ @ /.test(s)) return { ...base, icon: "📦", category: "track-merge", headline: s.replace(/^\[merge\]\s*/, "") };
  if (/^\[merge\]/.test(s)) return { ...base, icon: "🔀", category: "merge", headline: s.replace(/^\[merge\]\s*/, "") };
  if (/^\[complete:|^\[fix-complete:/.test(s)) return { ...base, icon: "✅", category: "track-complete", headline: s.replace(/^\[/, "").replace(/\]$/, "") };
  if (/^\[fix-batch\]/.test(s)) return { ...base, icon: "🔧", category: "fix-batch", headline: s.replace(/^\[fix-batch\]\s*/, "") };
  if (/^\[audit-prompts?\]/.test(s)) return { ...base, icon: "🎯", category: "audit-prompt", headline: s.replace(/^\[audit-prompts?\]\s*/, "") };
  if (/approve/i.test(s) && /audit|review/i.test(s)) return { ...base, icon: "✓", category: "audit-approve", headline: s };
  if (/reject/i.test(s) && /audit|review/i.test(s)) return { ...base, icon: "✗", category: "audit-reject", headline: s };
  if (/^\[w?\d+-batch-\d+-prep\]|^\[.*-prep\]/.test(s) || /prep\]/.test(s)) return { ...base, icon: "🔭", category: "prep", headline: s.replace(/^\[.*?\]\s*/, "") };
  if (/^docs?\(/.test(s)) return { ...base, icon: "📝", category: "docs", headline: s };
  return { ...base, icon: "·", category: "other", headline: s };
}

// ---------- REQ coverage matrix ----------

type ReqCoverage = {
  reqId: string;
  reqName?: string;
  criteriaTotal: number;
  criteriaDelivered: number;
  tracks: string[]; // track-ids covering this REQ
};

function computeReqCoverage(catalog: ReturnType<typeof loadCatalogFull>, tracks: ReturnType<typeof loadTrackMetas>, commits: CommitRow[]): ReqCoverage[] {
  const out: ReqCoverage[] = [];
  for (const r of catalog) {
    const covers = tracks.filter((t) => (t.source_of_truth?.req_ids ?? []).includes(r.id));
    const delivered = covers.filter((t) => commits.some((c) => c.subject.includes(`[merge] ${t.track_id}`))).length;
    const criteriaDelivered = covers.length > 0 ? Math.round((delivered / covers.length) * r.criteria.length) : 0;
    out.push({
      reqId: r.id,
      reqName: r.name,
      criteriaTotal: r.criteria.length,
      criteriaDelivered,
      tracks: covers.map((t) => t.track_id),
    });
  }
  return out;
}

// ---------- snapshot ----------

export type CaptainSnapshot = {
  ts: string;
  fetchInfo: { fetched: boolean; ms: number; error?: string };
  audits: AuditEntry[];
  closures: ClosureLesson[];
  workers: WorkerStatus[];
  queue: CaptainQueueItem[];
  activity: InterpretedActivity[];
  reqCoverage: ReqCoverage[];
  currentWave: number;
  managerState: WorkerStatus | null;
  kpis: {
    findingsTotal: number;
    findingsOpen: number;
    auditsTotal: number;
    auditsApproved: number;
    auditsRejected: number;
    cyclesRun: number;
  };
};

// ---------- per-section caches (each section refreshes on its own cadence) ----------
type CacheEntry<T> = { value: T; at: number };
const _cache = new Map<string, CacheEntry<unknown>>();
function memo<T>(key: string, ttlMs: number, fn: () => T): T {
  const now = Date.now();
  const hit = _cache.get(key) as CacheEntry<T> | undefined;
  if (hit && now - hit.at < ttlMs) return hit.value;
  const v = fn();
  _cache.set(key, { value: v, at: now });
  return v;
}

// Quick sections — refresh frequently
export function sectionHero(): { ts: string; currentWave: number; manager: WorkerStatus | null; runningWorkers: number; stalledWorkers: number; queueCount: number; auditsTotal: number; auditsApproved: number; auditsRejected: number; cyclesRun: number; findingsTotal: number; findingsOpen: number; fetchInfo: { fetched: boolean; ms: number; error?: string } } {
  return memo("hero", 5_000, () => {
    const fetchInfo = gitFetch();
    const commits = memo("commits", 5_000, () => gitLog());
    const tracks = memo("tracks", 30_000, () => loadTrackMetas());
    const workers = memo("workers", 3_000, () => loadWorkers());
    // For hero we use cached or fresh audit count — keep cheap; fall through to whatever's cached.
    const audits = (_cache.get("audits") as CacheEntry<AuditEntry[]> | undefined)?.value ?? [];
    const queue = (_cache.get("queue") as CacheEntry<CaptainQueueItem[]> | undefined)?.value
      ?? computeCaptainQueue(audits, commits, workers);
    const findingsTotal = audits.reduce((s, a) => s + a.findings.length, 0);
    const findingsOpen = audits.filter((a) => a.verdict === "rejected").reduce((s, a) => s + a.findings.length, 0);
    return {
      ts: new Date().toISOString(),
      currentWave: inferCurrentWave(commits, tracks),
      manager: workers.find((w) => w.name === "manager") ?? null,
      runningWorkers: workers.filter((w) => w.classification === "running-healthy").length,
      stalledWorkers: workers.filter((w) => w.classification === "running-stalled").length,
      queueCount: queue.length,
      auditsTotal: audits.length,
      auditsApproved: audits.filter((a) => a.verdict === "approved").length,
      auditsRejected: audits.filter((a) => a.verdict === "rejected").length,
      cyclesRun: audits.reduce((s, a) => s + a.cycle, 0),
      findingsTotal,
      findingsOpen,
      fetchInfo,
    };
  });
}

export function sectionQueue(): CaptainQueueItem[] {
  return memo("queue", 8_000, () => {
    const commits = memo("commits", 5_000, () => gitLog());
    const audits = memo("audits", 60_000, () => loadAudits());
    const workers = memo("workers", 3_000, () => loadWorkers());
    return computeCaptainQueue(audits, commits, workers);
  });
}

export function sectionStalls(): WorkerStatus[] {
  return memo("workers", 3_000, () => loadWorkers()).filter((w) => w.classification === "running-stalled");
}

export function sectionWorkers(): WorkerStatus[] {
  return memo("workers", 3_000, () => loadWorkers());
}

export function sectionActivity(): InterpretedActivity[] {
  const commits = memo("commits", 5_000, () => gitLog());
  return commits.slice(0, 80).map(interpretCommit);
}

export function sectionTimeline(): Array<{ wave: number; status: "closed" | "in-flight" | "pending"; auditsCount: number; findings: number; cycles: number; tracksTotal: number }> {
  const commits = memo("commits", 5_000, () => gitLog());
  const audits = memo("audits", 60_000, () => loadAudits());
  const containers = memo("containers", 3_000, () => {
    try {
      const out = scionList();
      return out;
    } catch { return ""; }
  });
  const out: Array<{ wave: number; status: "closed" | "in-flight" | "pending"; auditsCount: number; findings: number; cycles: number; tracksTotal: number }> = [];
  for (let n = 0; n <= 10; n++) {
    const audW = audits.filter((a) => a.wave === n);
    // Explicit close marker on trunk.
    const closeRe = new RegExp(
      `^\\[close\\]\\s+(?:wave-${n}\\b(?!\\.).*closed|Wave\\s+${n}\\b.*CLOSED|wave-${n}\\b\\s+batch-\\S+\\s+closed)`,
      "i",
    );
    const closed = commits.some((c) => closeRe.test(c.subject));
    // Activity: running container OR commit that's clearly dispatch / merge / impl work.
    let inflight = false;
    if (!closed) {
      if (new RegExp(`\\bw${n}-[\\w-]+\\b`).test(containers)) inflight = true;
      else {
        const trackRe = new RegExp(`\\bw${n}-[\\w-]+\\b`);
        const waveRe = new RegExp(`(wave-${n}\\b|W${n}\\.B\\d+)`);
        for (const c of commits.slice(0, 400)) {
          const s = c.subject;
          if (!(trackRe.test(s) || waveRe.test(s))) continue;
          if (
            s.includes("[complete:") || s.includes("[fix-complete:") ||
            s.includes("[fix-batch]") || s.includes("[merge]") ||
            s.includes("[audit-prompt") || (s.includes("[w") && s.includes("-prep]"))
          ) { inflight = true; break; }
        }
      }
    }
    out.push({
      wave: n,
      status: closed ? "closed" : inflight ? "in-flight" : "pending",
      auditsCount: audW.length,
      findings: audW.reduce((s, a) => s + a.findings.length, 0),
      cycles: audW.reduce((s, a) => s + a.cycle, 0),
      tracksTotal: new Set(audW.flatMap((a) => (Array.isArray(a.auditedBranches) ? a.auditedBranches : []).map((b) => b.split("@")[0]))).size,
    });
  }
  return out;
}

export function sectionAudits(): AuditEntry[] {
  return memo("audits", 60_000, () => loadAudits());
}

export function sectionCoverage(): ReqCoverage[] {
  return memo("coverage", 30_000, () => {
    const catalog = memo("catalog", 60_000, () => loadCatalogFull());
    const tracks = memo("tracks", 30_000, () => loadTrackMetas());
    const commits = memo("commits", 5_000, () => gitLog());
    return computeReqCoverage(catalog, tracks, commits);
  });
}

export function sectionLessons(): ClosureLesson[] {
  return memo("lessons", 60_000, () => loadClosures());
}

export function invalidateAllSections(): void {
  _cache.clear();
}

export function buildCaptainSnapshot(): CaptainSnapshot {
  const t = (label: string, fn: () => unknown) => {
    const s = Date.now();
    const out = fn();
    if (process.env["CAPTAIN_PROFILE"]) console.error(`  [profile] ${label}: ${Date.now() - s}ms`);
    return out;
  };
  const fetchInfo = t("gitFetch", () => gitFetch()) as ReturnType<typeof gitFetch>;
  const commits = t("gitLog", () => memo("commits", 5_000, () => gitLog())) as ReturnType<typeof gitLog>;
  const tracks = t("loadTrackMetas", () => memo("tracks", 30_000, () => loadTrackMetas())) as ReturnType<typeof loadTrackMetas>;
  const catalog = t("loadCatalogFull", () => memo("catalog", 60_000, () => loadCatalogFull())) as ReturnType<typeof loadCatalogFull>;
  const audits = t("loadAudits", () => memo("audits", 60_000, () => loadAudits())) as ReturnType<typeof loadAudits>;
  const closures = t("loadClosures", () => memo("lessons", 60_000, () => loadClosures())) as ReturnType<typeof loadClosures>;
  const workers = t("loadWorkers", () => memo("workers", 3_000, () => loadWorkers())) as ReturnType<typeof loadWorkers>;
  const queue = computeCaptainQueue(audits, commits, workers);
  const activity = commits.slice(0, 80).map(interpretCommit);
  const reqCoverage = computeReqCoverage(catalog, tracks, commits);

  const currentWave = inferCurrentWave(commits, tracks);
  const managerState = workers.find((w) => w.name === "manager") ?? null;

  const findingsTotal = audits.reduce((s, a) => s + a.findings.length, 0);
  const findingsOpen = audits
    .filter((a) => a.verdict === "rejected")
    .reduce((s, a) => s + a.findings.length, 0);
  const auditsTotal = audits.length;
  const auditsApproved = audits.filter((a) => a.verdict === "approved").length;
  const auditsRejected = audits.filter((a) => a.verdict === "rejected").length;
  const cyclesRun = audits.reduce((s, a) => s + a.cycle, 0);

  return {
    ts: new Date().toISOString(),
    fetchInfo,
    audits,
    closures,
    workers,
    queue,
    activity,
    reqCoverage,
    currentWave,
    managerState,
    kpis: { findingsTotal, findingsOpen, auditsTotal, auditsApproved, auditsRejected, cyclesRun },
  };
}

function inferCurrentWave(commits: CommitRow[], tracks: ReturnType<typeof loadTrackMetas>): number {
  // Highest wave with an active prep-or-dispatch commit AND tracks not yet merged to trunk.
  for (let w = 10; w >= 1; w--) {
    const prep = commits.find((c) => c.subject.includes(`w${w}-batch`) && c.subject.includes("prep"));
    const close = commits.find((c) => c.subject.includes(`[close] Wave ${w}`) || c.subject.includes(`Wave ${w} CLOSED`));
    if (prep && !close) return w;
  }
  // Fallback: last closed + 1
  for (let w = 10; w >= 1; w--) {
    if (commits.some((c) => c.subject.includes(`[close] Wave ${w}`) || c.subject.includes(`Wave ${w} CLOSED`))) return w + 1;
  }
  return 0;
}

// ---------- HTML render ----------

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"));
}

function severityColor(s: Finding["severity"] | CaptainQueueItem["severity"]): string {
  switch (s) {
    case "critical": case "blocker": return "#ff4757";
    case "high": return "#ff7f50";
    case "medium": return "#ffb84d";
    case "low": case "info": return "#7bc6ff";
    default: return "#888";
  }
}

function categoryColor(c: InterpretedActivity["category"]): string {
  return {
    "wave-close": "#22c55e",
    "batch-merge": "#22c55e",
    "track-merge": "#16a34a",
    "track-complete": "#16a34a",
    "audit-approve": "#3b82f6",
    "audit-reject": "#ef4444",
    "fix-batch": "#f97316",
    "audit-prompt": "#a855f7",
    "docs": "#94a3b8",
    "prep": "#06b6d4",
    "merge": "#22c55e",
    "other": "#64748b",
  }[c];
}

// ---------- Template-native Captain extensions ----------
//
// Injects Captain-specific sections into the existing Phase-2 template
// (the one in tools/swarm-dashboard/template/). The new sections use the
// template's own CSS tokens + classes (.section, .panel, .panel-head,
// .feed, .feed-item, .kpi, .kpi-strip, .wave-tag, etc.) so the page reads
// as a cohesive extension of the designer's work — same fonts, colors,
// shadows, spacing.

const CAPTAIN_EXT_CSS = `
  /* ----- Captain extensions — same tokens, just new patterns ----- */
  .cap-section .freshness {
    font-family: var(--mono); font-size: 11px; color: var(--fg-faint);
    margin-left: 8px; transition: opacity .2s, color .2s;
  }
  .cap-section .freshness.loading { color: var(--warning); }
  .cap-section .freshness.error   { color: var(--danger); }
  .cap-section .freshness.fresh   { color: var(--success); opacity: .9; }
  .cap-section .freshness.stale   { color: var(--fg-faint); opacity: .55; }

  .cap-list { display: flex; flex-direction: column; }
  .cap-list .cap-row {
    display: flex; gap: 12px; align-items: center;
    padding: 10px 16px; border-bottom: 1px solid var(--border);
    cursor: pointer; transition: background .12s;
  }
  .cap-list .cap-row:last-child { border-bottom: 0; }
  .cap-list .cap-row:hover { background: var(--surface-2); }
  .cap-list .cap-row .col-l { min-width: 200px; }
  .cap-list .cap-row .col-c { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .cap-list .cap-row .col-r { color: var(--fg-faint); font-size: 11.5px; font-family: var(--mono); white-space: nowrap; }

  details.cap-d { border-bottom: 1px solid var(--border); background: transparent; }
  details.cap-d:last-child { border-bottom: 0; }
  details.cap-d > summary {
    list-style: none;
    padding: 10px 16px;
    display: flex; align-items: center; gap: 10px;
    cursor: pointer; transition: background .12s;
  }
  details.cap-d > summary::-webkit-details-marker { display: none; }
  details.cap-d > summary::before {
    content: "▸"; color: var(--fg-faint); font-size: 9px;
    transition: transform .15s; display: inline-block; width: 8px;
  }
  details.cap-d[open] > summary::before { transform: rotate(90deg); }
  details.cap-d > summary:hover { background: var(--surface-2); }
  details.cap-d > .cap-detail {
    padding: 4px 16px 14px 36px;
    color: var(--fg-muted); font-size: 12.5px;
    line-height: 1.55;
  }
  details.cap-d > .cap-detail pre {
    background: var(--surface-2);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    font-family: var(--mono); font-size: 11.5px;
    white-space: pre-wrap; word-break: break-word;
    overflow-x: auto; margin: 6px 0;
  }
  details.cap-d > .cap-detail strong { color: var(--fg); font-weight: 500; }

  .cap-pill {
    display: inline-flex; align-items: center;
    padding: 1px 8px; border-radius: 10px;
    font-family: var(--mono); font-size: 10.5px;
    background: var(--neutral-100); color: var(--fg-muted);
    letter-spacing: .02em;
    border: 1px solid transparent;
  }
  .cap-pill.crit, .cap-pill.high, .cap-pill.blocker { background: var(--danger-100); color: var(--danger); }
  .cap-pill.medium { background: var(--warning-100); color: #a06b00; }
  [data-theme="dark"] .cap-pill.medium { color: var(--warning); }
  .cap-pill.low, .cap-pill.info { background: var(--primary-100); color: var(--primary); }
  .cap-pill.ok    { background: var(--success-100); color: var(--success); }
  .cap-pill.rej   { background: var(--danger-100);  color: var(--danger); }

  .cap-pip {
    width: 6px; height: 6px; border-radius: 50%;
    flex-shrink: 0; background: var(--neutral-200);
  }
  .cap-pip.green { background: var(--success); }
  .cap-pip.amber { background: var(--warning); }
  .cap-pip.red   { background: var(--danger); }
  .cap-pip.cyan  { background: var(--primary); }
  .cap-pip.purple{ background: var(--purple); }

  /* Captain queue cards (more prominent) */
  .cap-queue {
    display: flex; flex-direction: column;
    border-top: 1px solid var(--border);
  }
  .cap-queue .cap-q-row {
    display: grid;
    grid-template-columns: 70px 1fr 110px;
    gap: 14px; align-items: center;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    cursor: default;
  }
  .cap-queue .cap-q-row:last-child { border-bottom: 0; }
  .cap-queue .cap-q-row.blocker { background: var(--danger-100); }
  [data-theme="dark"] .cap-queue .cap-q-row.blocker { background: rgba(255,85,119,0.08); }
  .cap-queue .cap-q-row.high { background: var(--warning-100); }
  [data-theme="dark"] .cap-queue .cap-q-row.high { background: rgba(255,191,61,0.06); }
  .cap-queue .cap-q-row .title { font-weight: 500; color: var(--fg); margin-bottom: 2px; }
  .cap-queue .cap-q-row .detail { color: var(--fg-muted); font-size: 12.5px; line-height: 1.45; }
  .cap-queue .cap-q-row .src    { font-family: var(--mono); font-size: 11px; color: var(--fg-faint); }

  /* REQ coverage matrix using template tokens */
  .cap-cov {
    max-height: 480px; overflow-y: auto;
  }
  .cap-cov .cap-cov-row {
    display: grid;
    grid-template-columns: minmax(0,1fr) 90px 120px minmax(0,1fr);
    gap: 14px; align-items: center;
    padding: 9px 16px;
    border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  .cap-cov .cap-cov-row:last-child { border-bottom: 0; }
  .cap-cov .cap-cov-row .reqid {
    font-family: var(--mono); font-size: 11.5px; color: var(--fg);
  }
  .cap-cov .cap-cov-row .reqname { color: var(--fg-muted); font-size: 11.5px; }
  .cap-cov .cap-cov-row .count {
    font-family: var(--mono); color: var(--fg-muted); font-variant-numeric: tabular-nums;
  }
  .cap-cov .cap-cov-row .bar {
    background: var(--neutral-100); border-radius: 3px;
    height: 6px; position: relative; overflow: hidden;
  }
  .cap-cov .cap-cov-row .bar .fill {
    position: absolute; left: 0; top: 0; bottom: 0;
    background: var(--primary); border-radius: 3px; transition: width .3s;
  }
  .cap-cov .cap-cov-row .bar .fill.full { background: var(--success); }
  .cap-cov .cap-cov-row .trks {
    font-family: var(--mono); font-size: 11px;
    color: var(--fg-muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .cap-cov .cap-cov-row.empty .trks { color: var(--fg-faint); font-style: italic; }

  /* Recipe lesson rows */
  .cap-lesson summary .letter {
    font-family: var(--mono); font-weight: 600; color: var(--primary);
    margin-right: 8px;
  }
  .cap-lesson summary .title { font-weight: 500; flex: 1; }
  .cap-lesson summary .wave-pill {
    font-family: var(--mono); font-size: 10.5px;
    color: var(--fg-faint);
    padding: 1px 7px; border-radius: 3px;
    background: var(--neutral-100);
  }

  /* Stall row — like worker pulse */
  .cap-stall-row {
    display: grid;
    grid-template-columns: 14px 240px 1fr 200px;
    gap: 12px; align-items: center;
    padding: 9px 16px; border-bottom: 1px solid var(--border);
    font-size: 12.5px;
  }
  .cap-stall-row:last-child { border-bottom: 0; }
  .cap-stall-row .name { font-family: var(--mono); }

  /* Empty state in panel */
  .cap-empty {
    padding: 20px 16px;
    color: var(--fg-faint);
    font-style: italic;
    text-align: center;
  }
`;

function captainExtensionHtml(): string {
  // Section bodies are placeholders; the client-side script fills them in
  // from /api/captain/<section>. Each section header includes a freshness
  // indicator so the user knows when its data was last refreshed.
  return `
  <!-- ===== Captain extensions ===== -->
  <section class="section cap-section" id="cap-sec-queue">
    <div class="section-head">
      <div>
        <div class="section-title">Captain queue <span class="cap-pill" id="cap-queue-count">0</span></div>
        <div class="section-sub">decisions Captain owes — dual-approve awaiting merge, rejected audits awaiting fix-batch, stalls, preflight items</div>
      </div>
      <span class="freshness loading" id="cap-fresh-queue">loading…</span>
    </div>
    <div class="panel"><div class="cap-queue" id="cap-queue-content"><div class="cap-empty">loading…</div></div></div>
  </section>

  <section class="section cap-section" id="cap-sec-stalls">
    <div class="section-head">
      <div>
        <div class="section-title">Stall detector <span class="cap-pill" id="cap-stalls-count">0</span></div>
        <div class="section-sub">workers or auditors idle &gt; 10 min — likely TUI-prompt / rate-limit dialog</div>
      </div>
      <span class="freshness loading" id="cap-fresh-stalls">loading…</span>
    </div>
    <div class="panel"><div id="cap-stalls-content"><div class="cap-empty">loading…</div></div></div>
  </section>

  <section class="section cap-section" id="cap-sec-audits">
    <div class="section-head">
      <div>
        <div class="section-title">Audit findings explorer <span class="cap-pill" id="cap-audits-count">0</span></div>
        <div class="section-sub">every CR-CDX-* and SA-* finding ever filed; expand to drill into target track + observation + fix</div>
      </div>
      <span class="freshness loading" id="cap-fresh-audits">loading…</span>
    </div>
    <div class="panel"><div id="cap-audits-content"><div class="cap-empty">loading audit verdicts (this may take a few seconds the first time)…</div></div></div>
  </section>

  <section class="section cap-section" id="cap-sec-coverage">
    <div class="section-head">
      <div>
        <div class="section-title">REQ coverage matrix <span class="cap-pill" id="cap-coverage-count">0</span></div>
        <div class="section-sub">every REQ-*.md — criteria delivered / total, plus which tracks carry it</div>
      </div>
      <span class="freshness loading" id="cap-fresh-coverage">loading…</span>
    </div>
    <div class="panel"><div class="cap-cov" id="cap-coverage-content"><div class="cap-empty">loading…</div></div></div>
  </section>

  <section class="section cap-section" id="cap-sec-lessons">
    <div class="section-head">
      <div>
        <div class="section-title">Recipe lessons <span class="cap-pill" id="cap-lessons-count">0</span></div>
        <div class="section-sub">closure-report lessons from each wave (Lesson A, B, … BB, CC, …); expand to read the full note</div>
      </div>
      <span class="freshness loading" id="cap-fresh-lessons">loading…</span>
    </div>
    <div class="panel"><div id="cap-lessons-content"><div class="cap-empty">loading…</div></div></div>
  </section>
  `;
}

const CAPTAIN_EXT_JS = String.raw`
(() => {
  const POLL = { queue: 8000, stalls: 5000, audits: 60000, coverage: 60000, lessons: 120000 };
  const sevRank = { blocker: 0, critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c]));
  function ago(iso) {
    if (!iso) return '';
    const d = new Date(iso); const ms = Date.now() - d.getTime();
    if (ms < 60000) return Math.round(ms/1000) + 's ago';
    if (ms < 3600000) return Math.round(ms/60000) + 'm ago';
    if (ms < 86400000) return Math.round(ms/3600000) + 'h ago';
    return d.toISOString().slice(0,16).replace('T',' ');
  }
  function setFresh(name, ms, status) {
    const el = document.getElementById('cap-fresh-' + name);
    if (!el) return;
    el.className = 'freshness ' + (status || 'fresh');
    if (status === 'loading') el.textContent = 'loading…';
    else if (status === 'error') el.textContent = 'error';
    else el.textContent = ms + 'ms · just now';
    setTimeout(() => { if (el.classList.contains('fresh')) el.classList.replace('fresh', 'stale'); }, 30000);
  }
  const RENDERERS = {
    queue(rows) {
      document.getElementById('cap-queue-count').textContent = rows.length;
      if (!rows.length) {
        document.getElementById('cap-queue-content').innerHTML = '<div class="cap-empty">No outstanding Captain decisions. 🎯</div>';
        return;
      }
      rows.sort((a,b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
      document.getElementById('cap-queue-content').innerHTML = rows.map(q =>
        '<div class="cap-q-row ' + esc(q.severity) + '">' +
          '<span class="cap-pill ' + esc(q.severity) + '">' + esc(q.severity) + '</span>' +
          '<div>' +
            '<div class="title">' + esc(q.title) + '</div>' +
            '<div class="detail">' + esc(q.detail) + '</div>' +
          '</div>' +
          '<div class="src">' + esc(q.source) + '</div>' +
        '</div>'
      ).join('');
    },
    stalls(rows) {
      document.getElementById('cap-stalls-count').textContent = rows.length;
      if (!rows.length) {
        document.getElementById('cap-stalls-content').innerHTML = '<div class="cap-empty">All running workers responsive within 10 min. ✓</div>';
        return;
      }
      document.getElementById('cap-stalls-content').innerHTML = rows.map(w =>
        '<div class="cap-stall-row">' +
          '<div class="cap-pip amber"></div>' +
          '<div class="name">' + esc(w.name) + '</div>' +
          '<div>' + esc(w.lastActivity) + ' · container: ' + esc(w.containerUp) + '</div>' +
          '<div class="src">scion look ' + esc(w.name) + '</div>' +
        '</div>'
      ).join('');
    },
    audits(rows) {
      const totalFindings = rows.reduce((s,a) => s + ((a.findings||[]).length), 0);
      document.getElementById('cap-audits-count').textContent = totalFindings;
      const byBatch = {};
      for (const a of rows) {
        const k = 'w' + a.wave + '.b' + a.batch;
        (byBatch[k] = byBatch[k] || []).push(a);
      }
      const keys = Object.keys(byBatch).sort();
      if (!keys.length) {
        document.getElementById('cap-audits-content').innerHTML = '<div class="cap-empty">No audits found.</div>';
        return;
      }
      document.getElementById('cap-audits-content').innerHTML = keys.map(key => {
        const batch = byBatch[key];
        const findings = batch.flatMap(a => a.findings || []);
        const open = batch.some(a => a.verdict === 'rejected');
        const crit = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
        const auditPills = batch.sort((a,b) => a.cycle - b.cycle).map(a =>
          '<span class="cap-pill ' + (a.verdict === 'approved' ? 'ok' : a.verdict === 'rejected' ? 'rej' : '') + '">' +
            esc(a.auditor) + ' cycle-' + a.cycle + ': ' + esc(a.verdict) +
          '</span>'
        ).join(' ');
        const findingRows = !findings.length
          ? '<div class="cap-empty" style="text-align:left;padding-left:36px;">No findings — clean audit.</div>'
          : findings.map(f =>
              '<details class="cap-d">' +
                '<summary>' +
                  '<span class="cap-pill ' + esc(f.severity) + '">' + esc(f.severity) + '</span>' +
                  '<span style="font-family:var(--mono);font-size:11.5px;min-width:160px;">' + esc(f.id) + '</span>' +
                  '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(((f.observation||'').split('\n')[0]||f.id).slice(0,140)) + '</span>' +
                  '<span style="font-family:var(--mono);font-size:11px;color:var(--fg-faint);">' + esc(f.targetTrack||'') + '</span>' +
                '</summary>' +
                '<div class="cap-detail">' +
                  (f.file ? '<div><strong>file</strong> &middot; <span style="font-family:var(--mono);">' + esc(f.file) + (f.line ? (':'+f.line) : '') + '</span></div>' : '') +
                  (f.kind ? '<div><strong>kind</strong> &middot; ' + esc(f.kind) + '</div>' : '') +
                  (f.observation ? '<div style="margin-top:6px;"><strong>observation</strong></div><pre>' + esc(f.observation) + '</pre>' : '') +
                  (f.whyItMatters ? '<div><strong>why it matters</strong></div><pre>' + esc(f.whyItMatters) + '</pre>' : '') +
                  (f.suggestedFix ? '<div><strong>suggested fix</strong></div><pre>' + esc(f.suggestedFix) + '</pre>' : '') +
                '</div>' +
              '</details>'
            ).join('');
        return '<details class="cap-d" ' + (open ? 'open' : '') + '>' +
          '<summary>' +
            '<span class="cap-pill ' + (open ? 'rej' : 'ok') + '">' + (open ? 'open' : 'closed') + '</span>' +
            '<span style="font-family:var(--mono);min-width:90px;">' + esc(key) + '</span>' +
            '<span style="flex:1;">' + auditPills + '</span>' +
            '<span style="color:var(--fg-faint);font-size:11.5px;">' + findings.length + ' findings · ' + crit + ' critical+high</span>' +
          '</summary>' +
          '<div class="cap-detail" style="padding:0;">' + findingRows + '</div>' +
        '</details>';
      }).join('');
    },
    coverage(rows) {
      document.getElementById('cap-coverage-count').textContent = rows.length;
      rows.sort((a,b) => b.criteriaTotal - a.criteriaTotal);
      document.getElementById('cap-coverage-content').innerHTML = rows.map(r => {
        const pct = r.criteriaTotal > 0 ? Math.round((r.criteriaDelivered / r.criteriaTotal) * 100) : 0;
        const empty = r.tracks.length === 0 ? ' empty' : '';
        const fullCls = pct >= 100 ? ' full' : '';
        return '<div class="cap-cov-row' + empty + '">' +
          '<div><div class="reqid">' + esc(r.reqId) + '</div><div class="reqname">' + esc(r.reqName||'') + '</div></div>' +
          '<div class="count">' + r.criteriaDelivered + '/' + r.criteriaTotal + '</div>' +
          '<div class="bar"><div class="fill' + fullCls + '" style="width:' + pct + '%"></div></div>' +
          '<div class="trks">' + (r.tracks.length ? esc(r.tracks.join(', ')) : 'no track') + '</div>' +
        '</div>';
      }).join('');
    },
    lessons(rows) {
      document.getElementById('cap-lessons-count').textContent = rows.length;
      if (!rows.length) {
        document.getElementById('cap-lessons-content').innerHTML = '<div class="cap-empty">No closure-report lessons indexed yet.</div>';
        return;
      }
      rows.sort((a,b) => a.wave - b.wave || a.letter.localeCompare(b.letter));
      document.getElementById('cap-lessons-content').innerHTML = rows.map(l =>
        '<details class="cap-d cap-lesson">' +
          '<summary>' +
            '<span class="letter">' + esc(l.letter) + '</span>' +
            '<span class="title">' + esc(l.title) + '</span>' +
            '<span class="wave-pill">W' + l.wave + '</span>' +
          '</summary>' +
          '<div class="cap-detail"><pre>' + esc(l.body.slice(0,2400)) + '</pre></div>' +
        '</details>'
      ).join('');
    },
  };
  async function loadSection(name) {
    setFresh(name, 0, 'loading');
    const start = Date.now();
    try {
      const r = await fetch('/api/captain/' + name, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      RENDERERS[name](data);
      setFresh(name, Date.now() - start);
    } catch (err) {
      setFresh(name, 0, 'error');
      console.error('captain section ' + name + ' failed:', err);
    } finally {
      setTimeout(() => loadSection(name), POLL[name] || 60000);
    }
  }
  // Force-refresh via 'R' key (without conflicting with template's existing handlers).
  document.addEventListener('keydown', e => {
    if (e.key !== 'R') return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    Object.keys(RENDERERS).forEach(loadSection);
  });
  // Bootstrap.
  Object.keys(RENDERERS).forEach(loadSection);
})();
`;

/**
 * Splice Captain-specific sections into a legacy-rendered template page.
 * The sections inherit the template's CSS tokens + design language; the
 * Captain client-side JS lazy-loads each section from /api/captain/* so
 * the page stays snappy on warm caches and degrades gracefully on cold.
 */
export function injectCaptainExtensions(html: string): string {
  // 1. Add the Captain CSS just before `</style>` of the first <style> block.
  html = html.replace(/<\/style>/, `${CAPTAIN_EXT_CSS}\n</style>`);
  // 2. Splice Captain section HTML just before the drawer markup at end of <main>.
  //    Anchor: `<!-- Drawer (track detail) -->` if present, else just before `</main>`.
  const ext = captainExtensionHtml();
  if (/<!-- Drawer/.test(html)) {
    html = html.replace(/<!-- Drawer/, ext + "\n  <!-- Drawer");
  } else if (/<\/main>/.test(html)) {
    html = html.replace(/<\/main>/, ext + "\n</main>");
  } else {
    html = html.replace(/<\/body>/, ext + "\n</body>");
  }
  // 3. Append Captain JS just before </body>.
  html = html.replace(/<\/body>/, `<script>${CAPTAIN_EXT_JS}</script>\n</body>`);
  return html;
}

// ---------- HTML/CSS/JS constants for the live skeleton ----------

const CAPTAIN_CSS = `
  :root {
    --bg: #0b0f17;
    --panel: #131826;
    --panel-2: #1a2030;
    --border: #232a3d;
    --text: #e6edf3;
    --text-dim: #8b95a8;
    --text-soft: #c7d0dc;
    --accent: #7bc6ff;
    --green: #22c55e;
    --red: #ef4444;
    --amber: #f59e0b;
    --purple: #a855f7;
    --cyan: #06b6d4;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 13px/1.5 -apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif; }
  .mono { font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Monaco, monospace; }
  header.top { position: sticky; top: 0; z-index: 50; background: linear-gradient(180deg, rgba(11,15,23,0.96) 0%, rgba(11,15,23,0.85) 100%); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); padding: 12px 24px; display: flex; align-items: center; gap: 24px; }
  header.top .title { font-weight: 600; font-size: 14px; letter-spacing: 0.02em; }
  header.top .sub { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
  header.top .spacer { flex: 1; }
  header.top .live { color: var(--green); font-size: 11px; }
  header.top .live::before { content: "● "; }
  header.top .live.error { color: var(--red); }
  header.top .live.loading { color: var(--amber); }
  .container { max-width: 1480px; margin: 0 auto; padding: 16px 24px 48px; }
  section { margin-bottom: 28px; }
  section > h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--text-dim); margin: 0 0 10px; display: flex; align-items: baseline; gap: 10px; }
  section > h2 .badge { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 1px 7px; font-size: 10px; letter-spacing: 0.04em; color: var(--text-soft); }
  section > h2 .freshness { color: var(--text-dim); font-size: 10px; font-family: "SF Mono", ui-monospace, monospace; margin-left: auto; text-transform: none; letter-spacing: 0; opacity: 0.6; transition: opacity 0.2s; }
  section > h2 .freshness.fresh { opacity: 1; color: var(--green); }
  section > h2 .freshness.stale { color: var(--amber); }
  section > h2 .freshness.error { color: var(--red); }
  .hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
  .tile { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
  .tile .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); margin-bottom: 6px; }
  .tile .value { font-size: 22px; font-weight: 600; line-height: 1.1; }
  .tile .sub { font-size: 11px; color: var(--text-soft); margin-top: 4px; }
  .tile.ok .value { color: var(--green); }
  .tile.warn .value { color: var(--amber); }
  .tile.bad .value { color: var(--red); }
  .tile.loading .value { color: var(--text-dim); opacity: 0.4; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); transition: background 0.1s; }
  .row:last-child { border-bottom: none; }
  .row:hover { background: var(--panel-2); }
  .row .pip { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .row .pip.green { background: var(--green); }
  .row .pip.red { background: var(--red); }
  .row .pip.amber { background: var(--amber); }
  .row .pip.cyan { background: var(--cyan); }
  .row .pip.purple { background: var(--purple); }
  .row .pip.dim { background: var(--text-dim); }
  .row .when { color: var(--text-dim); font-size: 11px; min-width: 110px; }
  .row .body { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row .right { color: var(--text-dim); font-size: 11px; }
  details.row-d { background: transparent; border-bottom: 1px solid var(--border); }
  details.row-d:last-child { border-bottom: none; }
  details.row-d summary { display: flex; align-items: center; gap: 12px; padding: 10px 16px; cursor: pointer; list-style: none; }
  details.row-d summary::-webkit-details-marker { display: none; }
  details.row-d summary::before { content: "▸"; color: var(--text-dim); font-size: 9px; transition: transform 0.15s; flex-shrink: 0; }
  details.row-d[open] summary::before { transform: rotate(90deg); }
  details.row-d summary:hover { background: var(--panel-2); }
  details.row-d .detail { padding: 0 16px 14px 36px; color: var(--text-soft); font-size: 12px; }
  details.row-d .detail pre { background: var(--panel-2); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; white-space: pre-wrap; }
  .pill { display: inline-block; padding: 1px 8px; border-radius: 10px; font-size: 10px; letter-spacing: 0.03em; background: var(--panel-2); color: var(--text-soft); border: 1px solid var(--border); }
  .pill.green { background: rgba(34,197,94,0.12); color: #4ade80; border-color: rgba(34,197,94,0.3); }
  .pill.red { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
  .pill.amber { background: rgba(245,158,11,0.12); color: #fbbf24; border-color: rgba(245,158,11,0.3); }
  .pill.cyan { background: rgba(6,182,212,0.12); color: #67e8f9; border-color: rgba(6,182,212,0.3); }
  .pill.purple { background: rgba(168,85,247,0.12); color: #c084fc; border-color: rgba(168,85,247,0.3); }
  .activity .row { padding: 8px 16px; gap: 14px; }
  .activity .icon { font-size: 14px; min-width: 18px; text-align: center; }
  .activity .when { min-width: 84px; }
  .activity .cat { min-width: 110px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
  .gantt { padding: 14px 16px; }
  .gantt-row { display: grid; grid-template-columns: 60px 1fr 220px; gap: 12px; align-items: center; padding: 6px 0; }
  .gantt-bar { background: var(--panel-2); border-radius: 4px; height: 18px; position: relative; overflow: hidden; }
  .gantt-bar .fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 4px; transition: width 0.3s; }
  .gantt-bar .fill.closed { background: linear-gradient(90deg, #16a34a 0%, #22c55e 100%); }
  .gantt-bar .fill.in-flight { background: linear-gradient(90deg, #06b6d4 0%, #0ea5e9 100%); }
  .gantt-bar .fill.pending { background: var(--panel-2); }
  .gantt-row .label { font-weight: 600; }
  .gantt-row .stat { color: var(--text-dim); font-size: 11px; text-align: right; }
  .filter-bar { padding: 8px 16px; border-bottom: 1px solid var(--border); display: flex; gap: 8px; flex-wrap: wrap; background: var(--panel-2); }
  .filter-bar button { background: var(--panel); color: var(--text-soft); border: 1px solid var(--border); padding: 3px 10px; font-size: 11px; border-radius: 12px; cursor: pointer; }
  .filter-bar button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
  .filter-bar input.search { background: var(--panel); color: var(--text); border: 1px solid var(--border); padding: 4px 10px; font-size: 12px; border-radius: 4px; min-width: 220px; font-family: "SF Mono", ui-monospace, monospace; }
  .filter-bar .right { margin-left: auto; color: var(--text-dim); font-size: 11px; }
  .matrix { padding: 4px 16px; max-height: 480px; overflow-y: auto; }
  .matrix-row { display: grid; grid-template-columns: 1fr 100px 100px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); align-items: center; }
  .matrix-row:last-child { border-bottom: none; }
  .matrix-row .reqid { font-family: "SF Mono", ui-monospace, monospace; font-size: 11px; color: var(--text-soft); }
  .matrix-row .name { color: var(--text-dim); font-size: 11px; }
  .matrix-row .bar { background: var(--panel-2); border-radius: 4px; height: 10px; position: relative; overflow: hidden; }
  .matrix-row .bar .fill { position: absolute; top: 0; bottom: 0; left: 0; background: var(--accent); border-radius: 4px; }
  .lesson { padding: 10px 16px; border-bottom: 1px solid var(--border); }
  .lesson .letter { font-family: "SF Mono", ui-monospace, monospace; font-weight: 600; color: var(--accent); margin-right: 8px; }
  .lesson .title { font-weight: 600; }
  .lesson .body { color: var(--text-soft); font-size: 12px; margin-top: 6px; white-space: pre-wrap; }
  .lesson .wave-pill { font-family: "SF Mono", ui-monospace, monospace; font-size: 10px; color: var(--text-dim); margin-left: 8px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 1024px) { .grid-2 { grid-template-columns: 1fr; } }
  .empty { padding: 20px 16px; color: var(--text-dim); font-style: italic; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .kbd { background: var(--panel-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 10px; }
  .footer { margin-top: 36px; padding: 16px 24px; color: var(--text-dim); font-size: 11px; text-align: center; border-top: 1px solid var(--border); }
  @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 0.8; } }
  .loading .value, .loading .label { animation: pulse 1.5s ease-in-out infinite; }
`;

const CLIENT_JS = String.raw`
const POLL = { hero: 5000, queue: 8000, stalls: 5000, timeline: 20000, activity: 8000, audits: 60000, workers: 5000, coverage: 60000, lessons: 120000 };

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[c])); }
function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso); const ms = Date.now() - d.getTime();
  if (ms < 60000) return Math.round(ms/1000) + 's ago';
  if (ms < 3600000) return Math.round(ms/60000) + 'm ago';
  if (ms < 86400000) return Math.round(ms/3600000) + 'h ago';
  return d.toISOString().slice(0,16).replace('T',' ');
}
function sevPill(s) { return (s==='critical'||s==='blocker'||s==='high')?'red':(s==='medium'?'amber':'cyan'); }
function categoryColor(c) { return ({'wave-close':'#22c55e','batch-merge':'#22c55e','track-merge':'#16a34a','track-complete':'#16a34a','audit-approve':'#3b82f6','audit-reject':'#ef4444','fix-batch':'#f97316','audit-prompt':'#a855f7','docs':'#94a3b8','prep':'#06b6d4','merge':'#22c55e','other':'#64748b'}[c] || '#64748b'); }

const RENDERERS = {
  hero(d) {
    document.getElementById('ts').textContent = '<your-service> · ' + d.ts.slice(0,19) + 'Z';
    const tiles = [
      { label: 'Current Wave', value: 'W' + d.currentWave, sub: '' },
      { label: 'Manager', value: esc(d.manager ? d.manager.phase : '—'), sub: esc(d.manager ? d.manager.lastActivity : ''), cls: d.manager && d.manager.phase === 'running' ? 'ok' : '' },
      { label: 'Workers running', value: d.runningWorkers + d.stalledWorkers, sub: d.stalledWorkers > 0 ? (d.stalledWorkers + ' stalled') : 'all responsive', cls: d.stalledWorkers > 0 ? 'warn' : 'ok' },
      { label: 'Captain queue', value: d.queueCount, sub: '', cls: d.queueCount > 0 ? 'warn' : 'ok' },
      { label: 'Audit cycles run', value: d.cyclesRun, sub: d.auditsApproved + '✓ · ' + d.auditsRejected + '✗' },
      { label: 'Findings', value: d.findingsTotal, sub: d.findingsOpen + ' open' },
    ];
    document.getElementById('hero-content').innerHTML = tiles.map(t =>
      '<div class="tile ' + (t.cls||'') + '"><div class="label">' + esc(t.label) + '</div><div class="value">' + esc(t.value) + '</div><div class="sub">' + (t.sub||'') + '</div></div>'
    ).join('');
  },
  queue(rows) {
    document.getElementById('queue-count').textContent = rows.length;
    if (!rows.length) { document.getElementById('queue-content').innerHTML = '<div class="empty">No outstanding Captain decisions. 🎯</div>'; return; }
    const rank = { blocker: 0, high: 1, medium: 2, info: 3 };
    rows.sort((a,b) => (rank[a.severity]||9) - (rank[b.severity]||9));
    document.getElementById('queue-content').innerHTML = rows.map(q =>
      '<details class="row-d"><summary><span class="pill ' + sevPill(q.severity) + '">' + esc(q.severity) + '</span><span style="flex:1;">' + esc(q.title) + '</span><span style="color:var(--text-dim);font-size:11px;">' + esc(q.source) + '</span></summary><div class="detail">' + esc(q.detail) + '</div></details>'
    ).join('');
  },
  stalls(rows) {
    document.getElementById('stalls-count').textContent = rows.length;
    if (!rows.length) { document.getElementById('stalls-content').innerHTML = '<div class="empty">All running workers responsive within 10 min. ✓</div>'; return; }
    document.getElementById('stalls-content').innerHTML = rows.map(w =>
      '<div class="row"><div class="pip amber"></div><div class="mono" style="min-width:240px;">' + esc(w.name) + '</div><div class="body">' + esc(w.lastActivity) + ' · container: ' + esc(w.containerUp) + '</div><div class="right">scion look ' + esc(w.name) + '</div></div>'
    ).join('');
  },
  timeline(rows) {
    document.getElementById('timeline-content').innerHTML = '<div class="gantt">' + rows.map(r => {
      const pct = r.status === 'closed' ? 100 : r.status === 'in-flight' ? 35 : 0;
      const label = r.status === 'closed' ? ('closed · ' + r.auditsCount + ' audits, ' + r.findings + ' findings, ' + r.cycles + ' cycles')
                  : r.status === 'in-flight' ? ('in-flight · ' + r.auditsCount + ' audits, ' + r.findings + ' findings')
                  : 'pending';
      return '<div class="gantt-row"><div class="label mono">W' + r.wave + '</div><div class="gantt-bar"><div class="fill ' + r.status + '" style="width:' + pct + '%"></div></div><div class="stat">' + label + '</div></div>';
    }).join('') + '</div>';
  },
  activity(rows) {
    document.getElementById('activity-count').textContent = rows.length;
    document.getElementById('activity-content').innerHTML = rows.slice(0,80).map(a =>
      '<div class="row" data-cat="' + esc(a.category) + '"><div class="when mono">' + esc(ago(a.iso)) + '</div><div class="icon" style="color:' + categoryColor(a.category) + '">' + esc(a.icon) + '</div><div class="cat">' + esc(a.category) + '</div><div class="body">' + esc(a.headline) + '</div><div class="right mono">' + esc(a.shortSha) + '</div></div>'
    ).join('');
    applyActivityFilter();
  },
  audits(rows) {
    const totalFindings = rows.reduce((s,a) => s + (a.findings ? a.findings.length : 0), 0);
    document.getElementById('audits-count').textContent = totalFindings;
    const byBatch = {};
    for (const a of rows) {
      const k = 'w' + a.wave + '.b' + a.batch;
      (byBatch[k] = byBatch[k] || []).push(a);
    }
    const keys = Object.keys(byBatch).sort();
    if (!keys.length) { document.getElementById('audits-content').innerHTML = '<div class="empty">No audits found.</div>'; return; }
    document.getElementById('audits-content').innerHTML = keys.map(key => {
      const batch = byBatch[key];
      const findings = batch.flatMap(a => a.findings || []);
      const open = batch.some(a => a.verdict === 'rejected');
      const crit = findings.filter(f => f.severity === 'critical' || f.severity === 'high').length;
      const auditPills = batch.sort((a,b) => a.cycle - b.cycle).map(a =>
        '<span class="pill ' + (a.verdict === 'approved' ? 'green' : a.verdict === 'rejected' ? 'red' : '') + '">' + esc(a.auditor) + ' cycle-' + a.cycle + ': ' + esc(a.verdict) + '</span>'
      ).join(' ');
      const findingRows = !findings.length
        ? '<div class="empty" style="padding-left:36px;">No findings — clean audit.</div>'
        : findings.map(f =>
            '<details class="row-d"><summary><span class="pill ' + sevPill(f.severity) + '">' + esc(f.severity) + '</span><span class="mono" style="min-width:160px;font-size:11px;">' + esc(f.id) + '</span><span style="flex:1;">' + esc((f.observation||'').split('\\n')[0]||f.id).slice(0,130) + '</span><span style="color:var(--text-dim);font-size:10px;" class="mono">' + esc(f.targetTrack||'') + '</span></summary><div class="detail">' +
              (f.file ? '<div><strong>file:</strong> <span class="mono">' + esc(f.file) + (f.line ? (':'+f.line) : '') + '</span></div>' : '') +
              (f.kind ? '<div><strong>kind:</strong> ' + esc(f.kind) + '</div>' : '') +
              (f.observation ? '<div style="margin-top:8px;"><strong>observation:</strong></div><pre>' + esc(f.observation) + '</pre>' : '') +
              (f.whyItMatters ? '<div><strong>why it matters:</strong></div><pre>' + esc(f.whyItMatters) + '</pre>' : '') +
              (f.suggestedFix ? '<div><strong>suggested fix:</strong></div><pre>' + esc(f.suggestedFix) + '</pre>' : '') +
              '</div></details>'
          ).join('');
      return '<details class="row-d" ' + (open ? 'open' : '') + '><summary><span class="pill ' + (open ? 'red' : 'green') + '">' + (open ? 'open' : 'closed') + '</span><span class="mono" style="min-width:90px;">' + esc(key) + '</span><span style="flex:1;">' + auditPills + '</span><span style="color:var(--text-dim);font-size:11px;">' + findings.length + ' findings · ' + crit + ' critical+high</span></summary><div class="detail" style="padding:0;">' + findingRows + '</div></details>';
    }).join('');
  },
  workers(rows) {
    const byClass = (cls) => rows.filter(w => w.classification === cls);
    const renderRow = (w) => {
      const pip = w.classification === 'running-healthy' ? 'green' : w.classification === 'running-stalled' ? 'amber' : w.classification === 'manager' ? 'cyan' : 'dim';
      return '<div class="row"><div class="pip ' + pip + '"></div><div class="mono" style="min-width:240px;font-size:11px;">' + esc(w.name) + '</div><div class="body" style="font-size:11px;color:var(--text-soft);">' + esc(w.template) + '</div><div class="right">' + esc(w.lastActivity || w.containerUp) + '</div></div>';
    };
    const healthy = byClass('running-healthy'), stopped = byClass('stopped-normal'), manager = rows.find(w => w.classification === 'manager');
    document.getElementById('workers-content').innerHTML =
      '<div class="grid-2">' +
        '<div class="panel">' +
          '<div class="filter-bar"><strong style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);text-transform:uppercase;">Running healthy</strong><span class="right">' + healthy.length + '</span></div>' +
          (manager ? renderRow(manager) : '') +
          (healthy.length ? healthy.map(renderRow).join('') : '<div class="empty">none</div>') +
        '</div>' +
        '<div class="panel">' +
          '<div class="filter-bar"><strong style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);text-transform:uppercase;">Stopped (reaped)</strong><span class="right">' + stopped.length + '</span></div>' +
          (stopped.length ? stopped.slice(0,15).map(renderRow).join('') : '<div class="empty">none</div>') +
        '</div>' +
      '</div>';
  },
  coverage(rows) {
    document.getElementById('coverage-count').textContent = rows.length;
    rows.sort((a,b) => b.criteriaTotal - a.criteriaTotal);
    document.getElementById('coverage-content').innerHTML = '<div class="matrix">' + rows.map(r => {
      const pct = r.criteriaTotal > 0 ? Math.round((r.criteriaDelivered / r.criteriaTotal) * 100) : 0;
      return '<div class="matrix-row"><div><div class="reqid">' + esc(r.reqId) + '</div><div class="name">' + esc(r.reqName||'') + '</div></div><div class="mono" style="color:var(--text-soft);font-size:11px;">' + r.criteriaDelivered + '/' + r.criteriaTotal + '</div><div class="bar"><div class="fill" style="width:' + pct + '%"></div></div><div class="mono" style="font-size:10px;color:var(--text-dim);">' + (r.tracks.length ? esc(r.tracks.join(', ')) : '<em>no track</em>') + '</div></div>';
    }).join('') + '</div>';
  },
  lessons(rows) {
    document.getElementById('lessons-count').textContent = rows.length;
    if (!rows.length) { document.getElementById('lessons-content').innerHTML = '<div class="empty">No closure-report lessons indexed yet.</div>'; return; }
    rows.sort((a,b) => a.wave - b.wave || a.letter.localeCompare(b.letter));
    document.getElementById('lessons-content').innerHTML = rows.map(l =>
      '<details class="row-d"><summary><span class="letter mono">' + esc(l.letter) + '</span><span class="title" style="flex:1;">' + esc(l.title) + '</span><span class="wave-pill mono">W' + l.wave + '</span></summary><div class="detail"><div class="body" style="white-space:pre-wrap;">' + esc(l.body.slice(0,1500)) + '</div></div></details>'
    ).join('');
  },
};

function setFresh(name, ms, status) {
  const el = document.getElementById(name + '-fresh');
  if (!el) return;
  el.className = 'freshness ' + (status || 'fresh');
  if (status === 'loading') el.textContent = 'loading…';
  else if (status === 'error') el.textContent = 'error';
  else el.textContent = ms + 'ms · just now';
  // Tick to "stale" after 1 cycle.
  setTimeout(() => { if (el.classList.contains('fresh')) el.classList.replace('fresh','stale'); }, 30000);
}

async function loadSection(name) {
  setFresh(name, 0, 'loading');
  const start = Date.now();
  try {
    const resp = await fetch('/api/captain/' + name, { cache: 'no-store' });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    const fn = RENDERERS[name];
    if (fn) fn(data);
    setFresh(name, Date.now() - start);
  } catch (err) {
    setFresh(name, 0, 'error');
    console.error('section ' + name + ' failed:', err);
  } finally {
    setTimeout(() => loadSection(name), POLL[name] || 30000);
  }
}

// Activity filter + search
function applyActivityFilter() {
  const active = document.querySelector('#sec-activity .filter-bar button.active');
  const filter = (active && active.dataset.filter) || 'all';
  const filters = filter === 'all' ? null : filter.split(',');
  const q = (document.getElementById('actsearch').value || '').toLowerCase();
  document.querySelectorAll('#activity-content .row').forEach(r => {
    const cat = r.dataset.cat;
    const txt = r.textContent.toLowerCase();
    const ok = (!filters || filters.includes(cat)) && (!q || txt.includes(q));
    r.style.display = ok ? '' : 'none';
  });
}
document.querySelectorAll('#sec-activity .filter-bar button').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('#sec-activity .filter-bar button').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  applyActivityFilter();
}));
document.getElementById('actsearch').addEventListener('input', applyActivityFilter);

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  const search = document.getElementById('actsearch');
  if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); return; }
  if (e.key === 'Escape') { search.blur(); search.value = ''; applyActivityFilter(); return; }
  if (document.activeElement === search) return;
  if (e.key === 'j') window.scrollBy(0, 80);
  if (e.key === 'k') window.scrollBy(0, -80);
  if (e.key === 'r') Object.keys(RENDERERS).forEach(loadSection);
});

// Bootstrap — fire all loads in parallel.
Object.keys(RENDERERS).forEach(loadSection);
`;

/**
 * Live skeleton: returns HTML in <100ms. Sections fetch their own data via
 * /api/captain/<section> endpoints in parallel; each renders + polls
 * independently. This is the default page; `renderCaptainHtml` is kept for
 * `pnpm captain` (offline file-render).
 */
export function renderCaptainSkeleton(opts: { refreshSeconds?: number } = {}): { html: string } {
  const refresh = opts.refreshSeconds ?? 30;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Captain Dashboard · <your-service></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${CAPTAIN_CSS}</style>
</head><body>
<header class="top">
  <div>
    <div class="title">CAPTAIN DASHBOARD</div>
    <div class="sub mono" id="ts"><your-service> · booting…</div>
  </div>
  <div class="spacer"></div>
  <div class="sub mono">refresh: ${refresh}s</div>
  <div class="live" id="live-indicator">live</div>
</header>
<main class="container">

  <section id="sec-hero">
    <div class="hero" id="hero-content"><div class="tile loading"><div class="label">loading…</div><div class="value">·</div></div></div>
  </section>

  <section id="sec-queue">
    <h2>captain queue <span class="badge" id="queue-count">·</span> <span class="freshness" id="queue-fresh"></span></h2>
    <div class="panel" id="queue-content"><div class="empty">loading…</div></div>
  </section>

  <section id="sec-stalls">
    <h2>stall detector <span class="badge" id="stalls-count">·</span> <span class="freshness" id="stalls-fresh"></span></h2>
    <div class="panel" id="stalls-content"><div class="empty">loading…</div></div>
  </section>

  <section id="sec-timeline">
    <h2>wave timeline <span class="freshness" id="timeline-fresh"></span></h2>
    <div class="panel" id="timeline-content"><div class="empty">loading…</div></div>
  </section>

  <section id="sec-activity">
    <h2>live activity <span class="badge" id="activity-count">·</span> <span class="freshness" id="activity-fresh"></span></h2>
    <div class="panel activity">
      <div class="filter-bar">
        <input class="search" placeholder="search subjects…  / to focus" id="actsearch" autocomplete="off">
        <button data-filter="all" class="active">all</button>
        <button data-filter="wave-close">wave</button>
        <button data-filter="batch-merge,track-merge,merge">merge</button>
        <button data-filter="track-complete,fix-batch">complete/fix</button>
        <button data-filter="audit-approve,audit-reject,audit-prompt">audit</button>
        <button data-filter="docs">docs</button>
        <span class="right">press <span class="kbd">j</span>/<span class="kbd">k</span> to scroll</span>
      </div>
      <div id="activity-content"><div class="empty">loading…</div></div>
    </div>
  </section>

  <section id="sec-audits">
    <h2>audit findings explorer <span class="badge" id="audits-count">·</span> <span class="freshness" id="audits-fresh"></span></h2>
    <div class="panel" id="audits-content"><div class="empty">loading audit verdicts (this may take a few seconds the first time)…</div></div>
  </section>

  <section id="sec-workers">
    <h2>worker pulse <span class="freshness" id="workers-fresh"></span></h2>
    <div id="workers-content"><div class="empty">loading…</div></div>
  </section>

  <section id="sec-coverage">
    <h2>req coverage matrix <span class="badge" id="coverage-count">·</span> <span class="freshness" id="coverage-fresh"></span></h2>
    <div class="panel" id="coverage-content"><div class="empty">loading…</div></div>
  </section>

  <section id="sec-lessons">
    <h2>recipe lessons <span class="badge" id="lessons-count">·</span> <span class="freshness" id="lessons-fresh"></span></h2>
    <div class="panel" id="lessons-content"><div class="empty">loading…</div></div>
  </section>

  <div class="footer" id="footer">page rendered ${new Date().toISOString()}; sections fetch independently · keyboard: <span class="kbd">/</span> search · <span class="kbd">j</span>/<span class="kbd">k</span> scroll · <span class="kbd">r</span> force-refresh all</div>
</main>

<script>
${CLIENT_JS}
</script>
</body></html>`;
  return { html };
}

export function renderCaptainHtml(opts: { refreshSeconds?: number; snapshot?: CaptainSnapshot } = {}): { html: string; snapshot: CaptainSnapshot } {
  const snapshot = opts.snapshot ?? buildCaptainSnapshot();
  const refresh = opts.refreshSeconds ?? 30;

  const css = `
    :root {
      --bg: #0b0f17;
      --panel: #131826;
      --panel-2: #1a2030;
      --border: #232a3d;
      --text: #e6edf3;
      --text-dim: #8b95a8;
      --text-soft: #c7d0dc;
      --accent: #7bc6ff;
      --green: #22c55e;
      --red: #ef4444;
      --amber: #f59e0b;
      --purple: #a855f7;
      --cyan: #06b6d4;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0; padding: 0;
      background: var(--bg); color: var(--text);
      font: 13px/1.5 -apple-system, "SF Pro Text", BlinkMacSystemFont, "Helvetica Neue", system-ui, sans-serif;
    }
    .mono { font-family: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Monaco, monospace; }
    header.top {
      position: sticky; top: 0; z-index: 50;
      background: linear-gradient(180deg, rgba(11,15,23,0.96) 0%, rgba(11,15,23,0.85) 100%);
      backdrop-filter: blur(8px);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex; align-items: center; gap: 24px;
    }
    header.top .title { font-weight: 600; font-size: 14px; letter-spacing: 0.02em; }
    header.top .sub { color: var(--text-dim); font-size: 11px; text-transform: uppercase; letter-spacing: 0.1em; }
    header.top .spacer { flex: 1; }
    header.top .live { color: var(--green); font-size: 11px; }
    header.top .live::before { content: "● "; }
    .container { max-width: 1480px; margin: 0 auto; padding: 16px 24px 48px; }
    section { margin-bottom: 28px; }
    section > h2 {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.18em;
      color: var(--text-dim); margin: 0 0 10px;
      display: flex; align-items: baseline; gap: 10px;
    }
    section > h2 .badge {
      background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
      padding: 1px 7px; font-size: 10px; letter-spacing: 0.04em;
      color: var(--text-soft);
    }
    .hero { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .tile {
      background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
      padding: 14px 16px;
    }
    .tile .label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.14em; color: var(--text-dim); margin-bottom: 6px; }
    .tile .value { font-size: 22px; font-weight: 600; line-height: 1.1; }
    .tile .sub { font-size: 11px; color: var(--text-soft); margin-top: 4px; }
    .tile.ok .value { color: var(--green); }
    .tile.warn .value { color: var(--amber); }
    .tile.bad .value { color: var(--red); }
    .panel {
      background: var(--panel); border: 1px solid var(--border); border-radius: 8px;
      overflow: hidden;
    }
    .row {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; border-bottom: 1px solid var(--border);
      cursor: pointer; transition: background 0.1s;
    }
    .row:last-child { border-bottom: none; }
    .row:hover { background: var(--panel-2); }
    .row .pip { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .row .pip.green { background: var(--green); }
    .row .pip.red { background: var(--red); }
    .row .pip.amber { background: var(--amber); }
    .row .pip.cyan { background: var(--cyan); }
    .row .pip.purple { background: var(--purple); }
    .row .pip.dim { background: var(--text-dim); }
    .row .when { color: var(--text-dim); font-size: 11px; min-width: 110px; }
    .row .body { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .row .right { color: var(--text-dim); font-size: 11px; }
    details.row-d { background: transparent; border-bottom: 1px solid var(--border); }
    details.row-d:last-child { border-bottom: none; }
    details.row-d summary {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; cursor: pointer; list-style: none;
    }
    details.row-d summary::-webkit-details-marker { display: none; }
    details.row-d summary::before { content: "▸"; color: var(--text-dim); font-size: 9px; transition: transform 0.15s; flex-shrink: 0; }
    details.row-d[open] summary::before { transform: rotate(90deg); }
    details.row-d summary:hover { background: var(--panel-2); }
    details.row-d .detail { padding: 0 16px 14px 36px; color: var(--text-soft); font-size: 12px; }
    details.row-d .detail pre { background: var(--panel-2); padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 11px; }
    .pill {
      display: inline-block; padding: 1px 8px; border-radius: 10px;
      font-size: 10px; letter-spacing: 0.03em;
      background: var(--panel-2); color: var(--text-soft); border: 1px solid var(--border);
    }
    .pill.green { background: rgba(34,197,94,0.12); color: #4ade80; border-color: rgba(34,197,94,0.3); }
    .pill.red { background: rgba(239,68,68,0.12); color: #f87171; border-color: rgba(239,68,68,0.3); }
    .pill.amber { background: rgba(245,158,11,0.12); color: #fbbf24; border-color: rgba(245,158,11,0.3); }
    .pill.cyan { background: rgba(6,182,212,0.12); color: #67e8f9; border-color: rgba(6,182,212,0.3); }
    .pill.purple { background: rgba(168,85,247,0.12); color: #c084fc; border-color: rgba(168,85,247,0.3); }
    .activity .row { padding: 8px 16px; gap: 14px; }
    .activity .icon { font-size: 14px; min-width: 18px; text-align: center; }
    .activity .when { min-width: 84px; }
    .activity .cat { min-width: 110px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-dim); }
    .gantt { padding: 14px 16px; }
    .gantt-row { display: grid; grid-template-columns: 60px 1fr 120px; gap: 12px; align-items: center; padding: 6px 0; }
    .gantt-bar { background: var(--panel-2); border-radius: 4px; height: 18px; position: relative; overflow: hidden; }
    .gantt-bar .fill { position: absolute; top: 0; bottom: 0; left: 0; border-radius: 4px; transition: width 0.3s; }
    .gantt-bar .fill.closed { background: linear-gradient(90deg, #16a34a 0%, #22c55e 100%); }
    .gantt-bar .fill.inflight { background: linear-gradient(90deg, #06b6d4 0%, #0ea5e9 100%); }
    .gantt-bar .fill.pending { background: var(--panel-2); }
    .gantt-row .label { font-weight: 600; }
    .gantt-row .stat { color: var(--text-dim); font-size: 11px; text-align: right; }
    .filter-bar {
      padding: 8px 16px;
      border-bottom: 1px solid var(--border);
      display: flex; gap: 8px; flex-wrap: wrap;
      background: var(--panel-2);
    }
    .filter-bar button {
      background: var(--panel); color: var(--text-soft); border: 1px solid var(--border);
      padding: 3px 10px; font-size: 11px; border-radius: 12px; cursor: pointer;
    }
    .filter-bar button.active { background: var(--accent); color: var(--bg); border-color: var(--accent); }
    .filter-bar input.search {
      background: var(--panel); color: var(--text); border: 1px solid var(--border);
      padding: 4px 10px; font-size: 12px; border-radius: 4px; min-width: 220px;
      font-family: "SF Mono", ui-monospace, monospace;
    }
    .filter-bar .right { margin-left: auto; color: var(--text-dim); font-size: 11px; }
    .matrix { padding: 4px 16px; }
    .matrix-row { display: grid; grid-template-columns: 1fr 100px 100px 1fr; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--border); align-items: center; }
    .matrix-row:last-child { border-bottom: none; }
    .matrix-row .reqid { font-family: "SF Mono", ui-monospace, monospace; font-size: 11px; color: var(--text-soft); }
    .matrix-row .name { color: var(--text-dim); font-size: 11px; }
    .matrix-row .bar { background: var(--panel-2); border-radius: 4px; height: 10px; position: relative; overflow: hidden; }
    .matrix-row .bar .fill { position: absolute; top: 0; bottom: 0; left: 0; background: var(--accent); border-radius: 4px; }
    .lesson { padding: 10px 16px; border-bottom: 1px solid var(--border); }
    .lesson:last-child { border-bottom: none; }
    .lesson .letter { font-family: "SF Mono", ui-monospace, monospace; font-weight: 600; color: var(--accent); margin-right: 8px; }
    .lesson .title { font-weight: 600; }
    .lesson .body { color: var(--text-soft); font-size: 12px; margin-top: 6px; white-space: pre-wrap; }
    .lesson .wave-pill { font-family: "SF Mono", ui-monospace, monospace; font-size: 10px; color: var(--text-dim); margin-left: 8px; }
    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 1024px) { .grid-2 { grid-template-columns: 1fr; } }
    .empty { padding: 20px 16px; color: var(--text-dim); font-style: italic; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .kbd { background: var(--panel-2); border: 1px solid var(--border); padding: 1px 5px; border-radius: 3px; font-family: monospace; font-size: 10px; }
    .footer { margin-top: 36px; padding: 16px 24px; color: var(--text-dim); font-size: 11px; text-align: center; border-top: 1px solid var(--border); }
  `;

  const reqRows = snapshot.reqCoverage
    .sort((a, b) => b.criteriaTotal - a.criteriaTotal)
    .map((r) => {
      const pct = r.criteriaTotal > 0 ? Math.round((r.criteriaDelivered / r.criteriaTotal) * 100) : 0;
      return `
        <div class="matrix-row" data-reqid="${esc(r.reqId)}">
          <div>
            <div class="reqid">${esc(r.reqId)}</div>
            <div class="name">${esc(r.reqName ?? "")}</div>
          </div>
          <div class="mono" style="color:var(--text-soft);font-size:11px;">${r.criteriaDelivered}/${r.criteriaTotal}</div>
          <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
          <div class="mono" style="font-size:10px;color:var(--text-dim);">${r.tracks.length ? r.tracks.join(", ") : "<no track>"}</div>
        </div>`;
    })
    .join("");

  const queueRows = snapshot.queue.length === 0
    ? `<div class="empty">No outstanding Captain decisions. 🎯</div>`
    : snapshot.queue
        .sort((a, b) => sevRank(a.severity) - sevRank(b.severity))
        .map((q) => `
          <details class="row-d">
            <summary>
              <span class="pill ${severityPillClass(q.severity)}">${esc(q.severity)}</span>
              <span style="flex:1;">${esc(q.title)}</span>
              <span style="color:var(--text-dim);font-size:11px;">${esc(q.source)}</span>
            </summary>
            <div class="detail">${esc(q.detail)}</div>
          </details>`)
        .join("");

  const stalls = snapshot.workers.filter((w) => w.classification === "running-stalled");
  const stallsBlock = stalls.length === 0
    ? `<div class="empty">All running workers responsive within 10 min. ✓</div>`
    : stalls.map((w) => `
        <div class="row">
          <div class="pip amber"></div>
          <div class="mono" style="min-width:240px;">${esc(w.name)}</div>
          <div class="body">${esc(w.lastActivity)} · container: ${esc(w.containerUp)}</div>
          <div class="right">scion look ${esc(w.name)}</div>
        </div>`)
        .join("");

  const activityRows = snapshot.activity.slice(0, 50).map((a) => `
    <div class="row" data-cat="${esc(a.category)}">
      <div class="when mono">${esc(formatRelative(a.iso))}</div>
      <div class="icon" style="color:${categoryColor(a.category)};">${a.icon}</div>
      <div class="cat">${esc(a.category)}</div>
      <div class="body">${esc(a.headline)}</div>
      <div class="right mono">${esc(a.shortSha)}</div>
    </div>`).join("");

  const auditCategories = ["all", "open", "closed", "rejected", "critical+"] as const;

  const auditsByWaveBatch = new Map<string, AuditEntry[]>();
  for (const a of snapshot.audits) {
    const k = `w${a.wave}.b${a.batch}`;
    if (!auditsByWaveBatch.has(k)) auditsByWaveBatch.set(k, []);
    auditsByWaveBatch.get(k)!.push(a);
  }
  const auditBlocks = [...auditsByWaveBatch.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, batch]) => {
      const findings = batch.flatMap((a) => a.findings);
      const open = batch.some((a) => a.verdict === "rejected");
      const crit = findings.filter((f) => f.severity === "critical" || f.severity === "high").length;
      const findingRows = findings.length === 0
        ? `<div class="empty" style="padding-left:36px;">No findings — clean audit.</div>`
        : findings.map((f) => `
            <details class="row-d" data-sev="${esc(f.severity)}">
              <summary>
                <span class="pill ${severityPillClass(f.severity)}">${esc(f.severity)}</span>
                <span class="mono" style="min-width:160px;font-size:11px;">${esc(f.id)}</span>
                <span style="flex:1;">${esc((f.observation ?? "").split("\n")[0] ?? f.id).slice(0, 130)}</span>
                <span style="color:var(--text-dim);font-size:10px;" class="mono">${esc(f.targetTrack ?? "")}</span>
              </summary>
              <div class="detail">
                <div><strong>file:</strong> <span class="mono">${esc(f.file ?? "(unspecified)")}${f.line ? ":" + f.line : ""}</span></div>
                <div><strong>kind:</strong> ${esc(f.kind ?? "(unspecified)")}</div>
                ${f.observation ? `<div style="margin-top:8px;"><strong>observation:</strong></div><pre>${esc(f.observation)}</pre>` : ""}
                ${f.whyItMatters ? `<div><strong>why it matters:</strong></div><pre>${esc(f.whyItMatters)}</pre>` : ""}
                ${f.suggestedFix ? `<div><strong>suggested fix:</strong></div><pre>${esc(f.suggestedFix)}</pre>` : ""}
              </div>
            </details>`).join("");
      return `
        <details class="row-d" data-batch="${esc(key)}" data-open="${open ? "1" : "0"}" ${open ? "open" : ""}>
          <summary>
            <span class="pill ${open ? "red" : "green"}">${open ? "open" : "closed"}</span>
            <span class="mono" style="min-width:90px;">${esc(key)}</span>
            <span style="flex:1;">${batch.map((a) => `<span class="pill ${a.verdict === "approved" ? "green" : a.verdict === "rejected" ? "red" : ""}">${esc(a.auditor)} cycle-${a.cycle}: ${esc(a.verdict)}</span>`).join(" ")}</span>
            <span style="color:var(--text-dim);font-size:11px;">${findings.length} findings · ${crit} critical+high</span>
          </summary>
          <div class="detail" style="padding:0;">
            ${findingRows}
          </div>
        </details>`;
    }).join("");

  const workersByClass = (cls: WorkerStatus["classification"]) => snapshot.workers.filter((w) => w.classification === cls);
  const workerBlock = `
    <div class="grid-2">
      <div class="panel">
        <div class="filter-bar"><strong style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);text-transform:uppercase;">Running healthy</strong><span class="right">${workersByClass("running-healthy").length}</span></div>
        ${workersByClass("running-healthy").map(workerRow).join("") || `<div class="empty">none</div>`}
      </div>
      <div class="panel">
        <div class="filter-bar"><strong style="font-size:11px;letter-spacing:0.1em;color:var(--text-dim);text-transform:uppercase;">Stopped (reaped)</strong><span class="right">${workersByClass("stopped-normal").length}</span></div>
        ${workersByClass("stopped-normal").slice(0, 12).map(workerRow).join("") || `<div class="empty">none</div>`}
      </div>
    </div>`;

  // Wave timeline (gantt)
  const waveGantt = (() => {
    const rows: string[] = [];
    for (let n = 0; n <= 10; n++) {
      const tracksWaveN = snapshot.audits.filter((a) => a.wave === n).length;
      const closed = snapshot.activity.some((a) => a.category === "wave-close" && a.raw.includes(`Wave ${n} CLOSED`));
      const inflight = !closed && snapshot.activity.some((a) => a.raw.includes(`w${n}-`));
      const audits = snapshot.audits.filter((a) => a.wave === n);
      const auditsCount = audits.length;
      const findings = audits.reduce((s, a) => s + a.findings.length, 0);
      const cycles = audits.reduce((s, a) => s + a.cycle, 0);
      const status = closed ? "closed" : inflight ? "inflight" : "pending";
      const widthPct = closed ? 100 : inflight ? 35 : 0;
      const label = closed ? `closed · ${auditsCount} audits, ${findings} findings, ${cycles} cycles` : inflight ? `in-flight · ${auditsCount}/${tracksWaveN} audits` : "pending";
      rows.push(`
        <div class="gantt-row">
          <div class="label mono">W${n}</div>
          <div class="gantt-bar"><div class="fill ${status}" style="width:${widthPct}%"></div></div>
          <div class="stat">${label}</div>
        </div>`);
    }
    return rows.join("");
  })();

  // Closure lessons
  const closureBlock = snapshot.closures.length === 0
    ? `<div class="empty">No closure-report lessons indexed yet.</div>`
    : snapshot.closures
        .sort((a, b) => a.wave - b.wave || a.letter.localeCompare(b.letter))
        .map((l) => `
          <details class="row-d">
            <summary>
              <span class="letter mono">${esc(l.letter)}</span>
              <span class="title" style="flex:1;">${esc(l.title)}</span>
              <span class="wave-pill mono">W${l.wave}</span>
            </summary>
            <div class="detail"><div class="body" style="white-space:pre-wrap;">${esc(l.body.slice(0, 1000))}</div></div>
          </details>`).join("");

  // Hero KPI tiles
  const hero = `
    <div class="hero">
      <div class="tile">
        <div class="label">Current Wave</div>
        <div class="value">W${snapshot.currentWave}</div>
        <div class="sub">${snapshot.activity.find((a) => a.category === "wave-close")?.headline.slice(0, 50) ?? "—"}</div>
      </div>
      <div class="tile ${snapshot.managerState?.classification === "manager" ? "ok" : ""}">
        <div class="label">Manager</div>
        <div class="value mono" style="font-size:14px;">${esc(snapshot.managerState?.phase ?? "unknown")}</div>
        <div class="sub">${esc(snapshot.managerState?.lastActivity ?? "—")}</div>
      </div>
      <div class="tile">
        <div class="label">Workers running</div>
        <div class="value">${workersByClass("running-healthy").length + workersByClass("running-stalled").length}</div>
        <div class="sub">${workersByClass("running-stalled").length > 0 ? `${workersByClass("running-stalled").length} stalled` : "all responsive"}</div>
      </div>
      <div class="tile ${snapshot.queue.filter((q) => q.severity === "blocker").length > 0 ? "bad" : snapshot.queue.length > 0 ? "warn" : "ok"}">
        <div class="label">Captain queue</div>
        <div class="value">${snapshot.queue.length}</div>
        <div class="sub">${snapshot.queue.filter((q) => q.severity === "blocker" || q.severity === "high").length} need attention</div>
      </div>
      <div class="tile">
        <div class="label">Audit cycles run</div>
        <div class="value">${snapshot.kpis.cyclesRun}</div>
        <div class="sub">${snapshot.kpis.auditsApproved}✓ · ${snapshot.kpis.auditsRejected}✗</div>
      </div>
      <div class="tile">
        <div class="label">Findings</div>
        <div class="value">${snapshot.kpis.findingsTotal}</div>
        <div class="sub">${snapshot.kpis.findingsOpen} open</div>
      </div>
    </div>`;

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>Captain Dashboard · <your-service></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh > 0 ? `<meta http-equiv="refresh" content="${refresh}">` : ""}
<style>${css}</style>
</head><body>
<header class="top">
  <div>
    <div class="title">CAPTAIN DASHBOARD</div>
    <div class="sub mono"><your-service> · ${esc(snapshot.ts.slice(0, 19))}Z</div>
  </div>
  <div class="spacer"></div>
  <div class="sub mono">refresh: ${refresh}s</div>
  <div class="live">live</div>
</header>
<main class="container">

  <section>
    ${hero}
  </section>

  <section>
    <h2>captain queue <span class="badge">${snapshot.queue.length}</span></h2>
    <div class="panel">${queueRows}</div>
  </section>

  <section>
    <h2>stall detector <span class="badge">${stalls.length}</span></h2>
    <div class="panel">${stallsBlock}</div>
  </section>

  <section>
    <h2>wave timeline</h2>
    <div class="panel"><div class="gantt">${waveGantt}</div></div>
  </section>

  <section>
    <h2>live activity <span class="badge">${snapshot.activity.length}</span></h2>
    <div class="panel activity">
      <div class="filter-bar">
        <input class="search" placeholder="search subjects…  / to focus" id="actsearch" autocomplete="off">
        <button data-filter="all" class="active">all</button>
        <button data-filter="wave-close">wave</button>
        <button data-filter="batch-merge,track-merge,merge">merge</button>
        <button data-filter="track-complete,fix-batch">complete/fix</button>
        <button data-filter="audit-approve,audit-reject,audit-prompt">audit</button>
        <button data-filter="docs">docs</button>
        <span class="right">press <span class="kbd">j</span>/<span class="kbd">k</span> to scroll</span>
      </div>
      ${activityRows}
    </div>
  </section>

  <section>
    <h2>audit findings explorer <span class="badge">${snapshot.kpis.findingsTotal}</span></h2>
    <div class="panel">${auditBlocks || `<div class="empty">No audits loaded.</div>`}</div>
  </section>

  <section>
    <h2>worker pulse</h2>
    ${workerBlock}
  </section>

  <section>
    <h2>req coverage matrix <span class="badge">${snapshot.reqCoverage.length}</span></h2>
    <div class="panel"><div class="matrix">${reqRows}</div></div>
  </section>

  <section>
    <h2>recipe lessons <span class="badge">${snapshot.closures.length}</span></h2>
    <div class="panel">${closureBlock}</div>
  </section>

  <div class="footer">
    Generated ${esc(snapshot.ts)} · git fetched ${snapshot.fetchInfo.fetched ? `${snapshot.fetchInfo.ms}ms` : "skipped"}${snapshot.fetchInfo.error ? ` (${esc(snapshot.fetchInfo.error)})` : ""}
  </div>
</main>

<script>
  // Activity filter
  const buttons = document.querySelectorAll('.activity .filter-bar button');
  const rows = document.querySelectorAll('.activity .row');
  const search = document.getElementById('actsearch');
  function applyFilter() {
    const active = document.querySelector('.activity .filter-bar button.active');
    const filter = (active && active.dataset.filter) || 'all';
    const filters = filter === 'all' ? null : filter.split(',');
    const q = (search.value || '').toLowerCase();
    rows.forEach(r => {
      const cat = r.dataset.cat;
      const txt = r.textContent.toLowerCase();
      const ok = (!filters || filters.includes(cat)) && (!q || txt.includes(q));
      r.style.display = ok ? '' : 'none';
    });
  }
  buttons.forEach(b => b.addEventListener('click', () => {
    buttons.forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    applyFilter();
  }));
  search.addEventListener('input', applyFilter);
  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== search) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape') { search.blur(); search.value = ''; applyFilter(); }
    if (e.key === 'j' && document.activeElement !== search) window.scrollBy(0, 80);
    if (e.key === 'k' && document.activeElement !== search) window.scrollBy(0, -80);
  });
</script>
</body></html>`;

  return { html, snapshot };
}

function workerRow(w: WorkerStatus): string {
  const pip = w.classification === "running-healthy" ? "green"
    : w.classification === "running-stalled" ? "amber"
    : w.classification === "manager" ? "cyan"
    : "dim";
  return `
    <div class="row">
      <div class="pip ${pip}"></div>
      <div class="mono" style="min-width:240px;font-size:11px;">${esc(w.name)}</div>
      <div class="body" style="font-size:11px;color:var(--text-soft);">${esc(w.template)}</div>
      <div class="right">${esc(w.lastActivity || w.containerUp)}</div>
    </div>`;
}

function formatRelative(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function sevRank(s: CaptainQueueItem["severity"]): number {
  return s === "blocker" ? 0 : s === "high" ? 1 : s === "medium" ? 2 : 3;
}

function severityPillClass(s: Finding["severity"] | CaptainQueueItem["severity"]): string {
  if (s === "critical" || s === "blocker" || s === "high") return "red";
  if (s === "medium") return "amber";
  return "cyan";
}

export function captainRenderToFile(): void {
  const { html, snapshot } = renderCaptainHtml();
  if (!existsSync(dirname(DIST))) mkdirSync(dirname(DIST), { recursive: true });
  writeFileSync(DIST, html, "utf-8");
  console.log(`Wrote ${DIST}`);
  console.log(
    `  audits=${snapshot.audits.length}  findings=${snapshot.kpis.findingsTotal}  ` +
    `closures=${snapshot.closures.length}  workers=${snapshot.workers.length}  ` +
    `queue=${snapshot.queue.length}  reqs=${snapshot.reqCoverage.length}  ` +
    `currentWave=${snapshot.currentWave}`,
  );
}

const isMain = (() => {
  try {
    const argv = process.argv[1] ?? "";
    return argv.endsWith("captain.ts") || argv.endsWith("captain.js");
  } catch { return false; }
})();
if (isMain) captainRenderToFile();
