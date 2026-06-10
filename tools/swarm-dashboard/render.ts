/**
 * Swarm dashboard renderer.
 *
 * Uses tools/swarm-dashboard/template/Phase-2 Swarm Dashboard.html as the
 * template. Reads catalog (requirements/REQ-*.md) + track-metas + events log
 * + git log; builds a JSON snapshot in the design's expected shape; injects
 * it into the template's <script id="swarm-data"> block + replaces the
 * ACTIVITY const. Output: dist/swarm-dashboard.html. Run via `pnpm render`
 * (or `pnpm open`).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
const TEMPLATE_PATH = join(import.meta.dirname, "template", "Phase-2 Swarm Dashboard.html");
const DIST = join(import.meta.dirname, "dist", "swarm-dashboard.html");

const WAVE_COLORS: Record<number, string> = {
  1: "#0a7f29",
  2: "#0066cc",
  3: "#7700cc",
  4: "#ffaa00",
  5: "#cc0033",
  6: "#0a7f29",
  7: "#0066cc",
  8: "#7700cc",
  9: "#ffaa00",
  10: "#cc0033",
};

type TrackMeta = {
  track_id: string;
  agent_class?: string;
  phase?: number;
  wave?: number;
  spec_adherence_check?: boolean;
  track_summary?: string;
  source_of_truth?: { catalog_md?: string[]; req_ids?: string[] };
};

type EventEntry = {
  event_id: string;
  timestamp: string;
  wave?: number;
  event_kind: string;
  verdict?: string;
  findings_count?: number;
  cycle?: number;
  fix_dispatched_to?: Array<{ target_track: string; finding_ids: string[]; fix_cycle: number }>;
  duration_minutes?: number;
  total_findings_ever?: number;
  fix_cycles?: number;
  catalog_defects?: number;
  audit_runs?: number;
  [k: string]: unknown;
};

type CommitRow = { sha: string; shortSha: string; author: string; iso: string; subject: string };


let lastFetchAt = 0;
const FETCH_THROTTLE_MS = 30_000;
const FETCH_TIMEOUT_MS = 3000;
let backgroundFetchInProgress = false;

/**
 * Best-effort. Returns immediately if a fetch is already in flight, or if
 * one ran within FETCH_THROTTLE_MS. Otherwise kicks off a background fetch
 * (non-blocking) — the dashboard renders against whatever's currently in
 * `refs/remotes/origin/*`. This keeps page renders snappy even on a slow
 * uplink; stale-ness is bounded by FETCH_THROTTLE_MS + the fetch wall-time.
 *
 * For one-shot CLI use (no daemon process keeping state), pass force=true
 * AND tolerate the wall-time.
 */
export function gitFetch(force = false): { fetched: boolean; ms: number; error?: string } {
  const now = Date.now();
  if (!force && (backgroundFetchInProgress || now - lastFetchAt < FETCH_THROTTLE_MS)) {
    return { fetched: false, ms: 0 };
  }
  if (!force) {
    // Kick off in background; mark in-flight so we don't spawn duplicates.
    backgroundFetchInProgress = true;
    try {
      execSync(
        `( git -C "${REPO_ROOT}" fetch origin main --quiet >/dev/null 2>&1 ; echo $? > /tmp/.captain-fetch-status ) &`,
        { encoding: "utf-8", timeout: 200, stdio: ["ignore", "ignore", "ignore"] },
      );
    } catch { /* fire-and-forget */ }
    lastFetchAt = now;
    // Reset in-flight flag after typical fetch wall-time.
    setTimeout(() => { backgroundFetchInProgress = false; }, 30_000);
    return { fetched: true, ms: 0 };
  }
  // Force path: actually wait.
  const start = Date.now();
  try {
    execSync(`git -C "${REPO_ROOT}" fetch origin main --quiet 2>&1`, {
      encoding: "utf-8",
      timeout: FETCH_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    });
    lastFetchAt = now;
    return { fetched: true, ms: Date.now() - start };
  } catch (err) {
    return { fetched: false, ms: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

export function gitShow(relPath: string): string | null {
  try {
    return execSync(
      `git -C "${REPO_ROOT}" show origin/main:${relPath} 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    return null;
  }
}

export function gitLsTree(prefix: string): string[] {
  try {
    const out = execSync(
      `git -C "${REPO_ROOT}" ls-tree --name-only -r origin/main -- ${prefix}`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function safeParseYamlString<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return parseYaml(text) as T;
  } catch {
    return fallback;
  }
}

export function gitLog(): CommitRow[] {
  try {
    const out = execSync(
      `git -C "${REPO_ROOT}" log --pretty=format:"%H|%an|%aI|%s" origin/main -2000`,
      { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, author, iso, ...rest] = line.split("|");
        return {
          sha: sha ?? "",
          shortSha: (sha ?? "").slice(0, 8),
          author: author ?? "",
          iso: iso ?? "",
          subject: rest.join("|") ?? "",
        };
      });
  } catch {
    return [];
  }
}

type WorkerBranchInfo = { hasComplete: boolean; hasFixComplete: boolean; aheadOfTrunk: number; tipSha: string };

function gitWorkerBranches(): Map<string, WorkerBranchInfo> {
  // List `origin/swarm/<track-id>` branches and, for each, count commits ahead of trunk
  // + scan their subjects for [complete:<track>] / [fix-complete:<track>] markers.
  // This lets the dashboard distinguish "in-flight" (commits, no complete marker) from
  // "complete" (worker pushed its complete marker; awaiting audit + merge).
  const out = new Map<string, WorkerBranchInfo>();
  let branches: string[] = [];
  try {
    const raw = execSync(
      `git -C "${REPO_ROOT}" for-each-ref --format='%(refname:short)' refs/remotes/origin/swarm/`,
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );
    branches = raw.split("\n").map((s) => s.replace(/^'|'$/g, "")).filter(Boolean);
  } catch {
    return out;
  }
  for (const ref of branches) {
    const trackId = ref.replace(/^origin\/swarm\//, "");
    try {
      const log = execSync(
        `git -C "${REPO_ROOT}" log ${ref} ^origin/main --pretty=format:'%H|%s' -100`,
        { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
      );
      const lines = log.split("\n").filter(Boolean);
      let hasComplete = false, hasFixComplete = false;
      const subjs: string[] = [];
      let tipSha = "";
      for (const line of lines) {
        const [sha, ...rest] = line.split("|");
        const subj = rest.join("|");
        if (!tipSha) tipSha = (sha ?? "").slice(0, 8);
        subjs.push(subj);
        if (subj.includes(`[complete:${trackId}]`)) hasComplete = true;
        if (subj.includes(`[fix-complete:${trackId}]`)) hasFixComplete = true;
      }
      out.set(trackId, { hasComplete, hasFixComplete, aheadOfTrunk: subjs.length, tipSha });
    } catch {
      // Branch may not exist, be empty, or ref-resolve might fail; skip silently.
    }
  }
  return out;
}

export function scionList(): string {
  try {
    return execSync("scion list 2>/dev/null", { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 });
  } catch {
    return "(scion CLI unavailable; container snapshot skipped)";
  }
}

export function loadTrackMetas(): TrackMeta[] {
  // Read from origin/main via git show (working tree may be out-of-sync).
  const files = gitLsTree("orchestration/track-meta/");
  return files
    .filter((p) => p.endsWith(".yaml") && !p.split("/").pop()!.startsWith("_"))
    .map((p) => safeParseYamlString<TrackMeta>(gitShow(p), { track_id: p.split("/").pop() ?? p }));
}

export function loadEvents(): EventEntry[] {
  const text = gitShow("orchestration/reviews/spec-adherence-events.yaml");
  if (!text) return [];
  const parsed = safeParseYamlString<{ events?: EventEntry[] }>(text, { events: [] });
  return parsed.events ?? [];
}

export type AuditStatsByWave = Map<number, { audits: number; findings: number; fixCycles: number; cycles: number }>;

/**
 * Current repo does not write `spec-adherence-events.yaml` (the prior repo's
 * event log). Audit cycles, findings, and fix cycles are recovered from:
 *   - audit branch verdict files (`orchestration/reviews/*.md` on each
 *     `swarm/w<N>-batch-<M>-(code-review-codex|spec-adherence)` branch)
 *   - trunk commit subjects (`[fix-batch] W<N>.B<M> cycle-K ...`)
 *
 * Each audit branch may carry multiple verdict files (one per cycle), each
 * overwriting the same path. To recover priors, we walk `git log` on the
 * branch and `git show` the file at each cycle-marker commit.
 */
export function loadAuditStatsByWave(commits: CommitRow[]): AuditStatsByWave {
  const out: AuditStatsByWave = new Map();

  // 1. Walk audit branches; recover per-cycle verdict files.
  let branchRefs = "";
  try {
    branchRefs = execSync(
      `git -C "${REPO_ROOT}" for-each-ref --format='%(refname:short)' refs/remotes/origin/swarm/ 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );
  } catch { /* ignore */ }
  const branches = branchRefs
    .split("\n")
    .map((b) => b.replace(/^'|'$/g, "").trim())
    .filter((b) => b.includes("-code-review-codex") || b.includes("-spec-adherence"));

  for (const br of branches) {
    const waveMatch = br.match(/w(\d+)/);
    if (!waveMatch) continue;
    const wave = Number(waveMatch[1]);
    const wstat = out.get(wave) ?? { audits: 0, findings: 0, fixCycles: 0, cycles: 0 };

    // Gather candidate commits: tip + every [complete:...-cycle-...] commit on this branch.
    const shas: string[] = [];
    try {
      const tipSha = execSync(`git -C "${REPO_ROOT}" rev-parse ${br} 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (tipSha) shas.push(tipSha);
    } catch { /* ignore */ }
    try {
      const log = execSync(
        `git -C "${REPO_ROOT}" log --pretty=format:%H ${br} --grep='^\\[complete:.*\\]' 2>/dev/null`,
        { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
      );
      for (const sha of log.split("\n").filter(Boolean)) if (!shas.includes(sha)) shas.push(sha);
    } catch { /* ignore */ }

    const seenCycles = new Set<number>();
    for (const sha of shas) {
      let files = "";
      try {
        files = execSync(
          `git -C "${REPO_ROOT}" ls-tree --name-only -r ${sha} -- orchestration/reviews/ 2>/dev/null`,
          { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
        );
      } catch { continue; }
      for (const f of files.split("\n").filter(Boolean)) {
        if (!f.endsWith(".md") || f.endsWith("README.md")) continue;
        let text = "";
        try {
          text = execSync(
            `git -C "${REPO_ROOT}" show ${sha}:${f} 2>/dev/null`,
            { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
          );
        } catch { continue; }
        const fm = text.match(/^---\n([\s\S]*?)\n---/);
        if (!fm?.[1]) continue;
        const frontmatter = safeParseYamlString<{ cycle?: number | string }>(fm[1], {});
        const cycle = Number(frontmatter.cycle ?? 1);
        if (seenCycles.has(cycle)) continue;
        seenCycles.add(cycle);
        // Count findings in YAML fenced block.
        let findingsCount = 0;
        const fenceRe = /```ya?ml\n([\s\S]*?)\n```/g;
        let m: RegExpExecArray | null;
        while ((m = fenceRe.exec(text)) !== null) {
          const body = m[1] ?? "";
          if (!/^findings:|^\s*-\s*id:\s*(CR-CDX|SA-w)/m.test(body)) continue;
          const parsed = safeParseYamlString<{ findings?: unknown[] }>(body, {});
          if (Array.isArray(parsed?.findings)) findingsCount += parsed.findings.length;
        }
        wstat.audits += 1;
        wstat.findings += findingsCount;
        wstat.cycles = Math.max(wstat.cycles, cycle);
      }
    }
    out.set(wave, wstat);
  }

  // 2. Fix cycles: count `[fix-batch] W<N>.B<M> ...` commits on trunk.
  for (const c of commits) {
    const m = c.subject.match(/^\[fix-batch\]\s+W(\d+)\.B/);
    if (!m) continue;
    const wave = Number(m[1]);
    const wstat = out.get(wave) ?? { audits: 0, findings: 0, fixCycles: 0, cycles: 0 };
    wstat.fixCycles += 1;
    out.set(wave, wstat);
  }

  return out;
}

type CatalogReq = { id: string; name?: string; criteria: Array<{ id: string; name: string; predicate?: string }> };

/**
 * Current repo stores requirements as per-REQ markdown files at
 * `requirements/REQ-*.md`. Each file has YAML frontmatter (id, name, ...)
 * and embedded fenced ```yaml blocks containing `criterion:` definitions
 * (one block per acceptance criterion). This parser walks those files via
 * `git show` (so it reads the trunk view, same as everything else) and
 * builds the same shape the old REQUIREMENTS-CATALOG.yaml produced.
 */
function parseReqMarkdown(reqId: string, text: string): CatalogReq {
  // Frontmatter: between leading `---` and the next `---`.
  let name: string | undefined;
  const fmMatch = text.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch?.[1]) {
    const fm = safeParseYamlString<{ id?: string; name?: string }>(fmMatch[1], {});
    name = fm.name;
  }
  // Criteria: every fenced ```yaml block whose body parses with a top-level
  // `criterion:` key. Carve fenced blocks, parse, keep the ones that match.
  const criteria: CatalogReq["criteria"] = [];
  const fenceRe = /```ya?ml\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(text)) !== null) {
    const body = m[1] ?? "";
    if (!/^criterion:/m.test(body)) continue;
    const parsed = safeParseYamlString<{ criterion?: { id?: string; name?: string; predicate?: string } }>(body, {});
    const c = parsed.criterion;
    if (c?.id) criteria.push({ id: c.id, name: c.name ?? c.id, predicate: c.predicate });
  }
  return { id: reqId, name, criteria };
}

export function loadCatalogFull(): CatalogReq[] {
  const files = gitLsTree("requirements/");
  return files
    .filter((p) => p.endsWith(".md") && (p.split("/").pop() ?? "").startsWith("REQ-"))
    .map((p) => {
      const reqId = (p.split("/").pop() ?? "").replace(/\.md$/, "");
      const text = gitShow(p) ?? "";
      return parseReqMarkdown(reqId, text);
    });
}

function loadCatalog(): Array<{ id: string; criteriaCount: number }> {
  return loadCatalogFull().map((r) => ({ id: r.id, criteriaCount: r.criteria.length }));
}

function loadWavePlan(): Map<number, number> {
  /**
   * Returns per-wave criteria totals used when track-metas don't yet exist
   * for future waves. Override this with your engagement's wave-plan estimates
   * once you have them (from the Phase 2 catalog kickoff brief).
   *
   * When track-metas ARE authored, the dashboard uses their actual criteria
   * counts instead of these defaults.
   */
  const totals = new Map<number, number>();
  // Placeholder: 10 waves with equal distribution. Replace with your
  // engagement's actual per-wave criteria estimates from the wave plan.
  for (let w = 1; w <= 10; w++) totals.set(w, 0);
  return totals;
}

function isImplTrack(t: TrackMeta): boolean {
  // Exclude auditor track-metas. Current repo only has swarm tracks (no
  // legacy Phase-1 to filter out); accept any phase value the track declares.
  return (
    t.spec_adherence_check !== true &&
    !t.track_id.includes("spec-adherence") &&
    !t.track_id.includes("code-review")
  );
}

function trackReqIds(track: TrackMeta): string[] {
  // Current repo uses source_of_truth.req_ids; old repo used catalog_md paths.
  // Support both so the renderer is layout-agnostic.
  if (track.source_of_truth?.req_ids?.length) return track.source_of_truth.req_ids;
  const mds = track.source_of_truth?.catalog_md ?? [];
  return mds
    .map((md) => (md.split("/").pop() ?? "").replace(/\.md$/, ""))
    .filter((r) => r.startsWith("REQ-"));
}

function trackCriteriaCount(track: TrackMeta, catalog: ReturnType<typeof loadCatalog>): number {
  let total = 0;
  for (const reqId of trackReqIds(track)) {
    const r = catalog.find((c) => c.id === reqId);
    if (r) total += r.criteriaCount;
  }
  return total;
}

function trackReqList(track: TrackMeta): string {
  return trackReqIds(track).join(", ");
}

function trackStatusFromCommits(
  track: TrackMeta,
  commits: CommitRow[],
  containers = "",
  branches: Map<string, WorkerBranchInfo> = new Map(),
): {
  status: "merged" | "complete" | "audited" | "in-flight" | "pending";
  mergeAt?: string;
} {
  if (!isImplTrack(track)) return { status: "pending" };
  const completeSubj = `[complete:${track.track_id}]`;
  const fixCompleteSubj = `[fix-complete:${track.track_id}]`;
  // Current repo uses `[merge] <track-id> @ <sha> → swarm/stage/<batch>` for
  // individual track merges (which then land on trunk via batch merge).
  // Old repo used `[merge] swarm/<track-id>`. Match either.
  const mergeSubj = `[merge] ${track.track_id}`;
  const mergeSubjLegacy = `[merge] swarm/${track.track_id}`;
  const composeBaseSubj = `[compose-base] merge ${track.track_id}`;
  const stageSubj = `[stage] merge ${track.track_id}`;
  const recomposeSubj = `[recompose] merge ${track.track_id}`;
  const mergeBranchSubj = `origin/swarm/${track.track_id}`;
  let completeAt: string | undefined;
  let mergeAt: string | undefined;
  for (const c of commits) {
    if (!mergeAt && (
      c.subject.includes(mergeSubj) ||
      c.subject.includes(mergeSubjLegacy) ||
      c.subject.includes(composeBaseSubj) ||
      c.subject.includes(stageSubj) ||
      c.subject.includes(recomposeSubj) ||
      c.subject.includes(mergeBranchSubj) ||
      (c.subject.startsWith("[merge]") && c.subject.includes(track.track_id))
    )) mergeAt = c.iso;
    if (!completeAt && (c.subject.includes(completeSubj) || c.subject.includes(fixCompleteSubj))) completeAt = c.iso;
  }
  if (mergeAt) return { status: "merged", mergeAt };
  // Fallback: if the track is complete and its wave is closed, the track was
  // implicitly merged via the batch merge (meta-compose tracks, etc.).
  if (completeAt && track.wave != null) {
    const waveClosed = waveClosedAt(track.wave, commits);
    if (waveClosed) return { status: "merged", mergeAt: completeAt };
  }
  if (completeAt) return { status: "complete" };
  // Worker-branch awareness: the worker's [complete] marker often lives on origin/swarm/<track>,
  // not on trunk. If we see a complete marker on that branch, the track is "complete" (awaiting audit).
  const br = branches.get(track.track_id);
  if (br?.hasComplete || br?.hasFixComplete) return { status: "complete" };
  // In-flight signal: trunk subject mentions the track id (covers abbreviations),
  // OR the worker container is running for the track,
  // OR the worker's branch has commits ahead of trunk.
  const inflight =
    commits.some((c) => c.subject.includes(track.track_id)) ||
    containers.includes(track.track_id) ||
    (br?.aheadOfTrunk ?? 0) > 0;
  return { status: inflight ? "in-flight" : "pending" };
}

function countWaveAgents(n: number, containers: string, tracks: TrackMeta[]): number {
  // Distinct wN-* agent names from canonical sources only. We deliberately
  // do NOT count commit-subject mentions — those over-count (finding IDs
  // like `CR-CDX-w2-001` contain `w2-001` substrings, prep commits like
  // `[w2-batch-1-prep]` aren't actual agents, etc.). The sources used:
  //  1. Worker track-metas declared with `wave: N` (canonical worker names).
  //  2. Audit branches `origin/swarm/w<N>-batch-<M>-(code-review-codex|spec-adherence)`.
  //  3. Live scion list — catches stopped-but-not-deleted containers
  //     (closed waves whose agents weren't fully purged) + probes.
  // For waves whose agents were `scion delete`d (W0/W1 in this engagement),
  // sources 1+2 still give an accurate historical count.
  const names = new Set<string>();
  for (const t of tracks) if (t.wave === n) names.add(t.track_id);
  try {
    const refs = execSync(
      `git -C "${REPO_ROOT}" for-each-ref --format='%(refname:short)' refs/remotes/origin/swarm/ 2>/dev/null`,
      { encoding: "utf-8", maxBuffer: 5 * 1024 * 1024 },
    );
    // W0 only had one batch and named its auditors `w0-spec-adherence` (no
     // `-batch-X-` infix); later waves used `w<N>-batch-<M>-spec-adherence`.
     // Make the batch infix optional.
     const re = new RegExp(`\\bw${n}-(?:batch-[\\w.]+-)?(?:code-review-codex|spec-adherence)\\b`);
    for (const ref of refs.split("\n")) {
      const cleaned = ref.replace(/^'|'$/g, "").trim();
      const m = cleaned.match(re);
      if (m) names.add(m[0]);
    }
  } catch { /* ignore */ }
  // Pull agent names from scion list rows — first whitespace-delimited token
  // on each line that starts with `wN-`. Avoids matching finding IDs or
  // commit-subject substrings that the simple `wN-` regex would catch.
  for (const line of containers.split("\n")) {
    const m = line.match(new RegExp(`^(w${n}-[\\w.-]+)\\s`));
    if (m) names.add(m[1]!);
  }
  return names.size;
}

/**
 * A wave is CLOSED iff there's an explicit `[close]` marker on trunk. The
 * accepted subject shapes (current repo):
 *   [close] Wave <N> CLOSED on trunk @ <sha>
 *   [close] wave-<N> closed: …
 *   [close] wave-<N> batch-* closed  (W0 only had a single batch)
 *   [close] W<N>.B<M> CLOSED  (intermediate batch closure — not a full wave close)
 * We deliberately do NOT use the W<N>.B<M> form here — that's a batch close,
 * not a wave close.
 */
function waveClosedAt(n: number, commits: CommitRow[]): string | null {
  const re = new RegExp(
    `^\\[close\\]\\s+(?:wave-${n}\\b(?!\\.).*closed|Wave\\s+${n}\\b.*CLOSED|wave-${n}\\b\\s+batch-\\S+\\s+closed)`,
    "i",
  );
  const m = commits.find((c) => re.test(c.subject));
  return m?.iso ?? null;
}

/**
 * Has the wave actually started (vs. just being authored in preflight)?
 * Signals counted: a running worker container `wN-*`, OR a commit subject
 * with a wave-N-specific dispatch / merge / impl marker.
 */
function waveHasActivity(n: number, commits: CommitRow[], containers: string): boolean {
  if (new RegExp(`\\bw${n}-[\\w-]+\\b`).test(containers)) return true;
  const trackRe = new RegExp(`\\bw${n}-[\\w-]+\\b`);
  const waveRe = new RegExp(`(wave-${n}\\b|W${n}\\.B\\d+)`);
  for (const c of commits.slice(0, 400)) {
    const s = c.subject;
    if (!(trackRe.test(s) || waveRe.test(s))) continue;
    if (
      s.includes("[complete:") || s.includes("[fix-complete:") ||
      s.includes("[fix-batch]") || s.includes("[merge]") ||
      s.includes("[audit-prompt") || s.includes("[w") && s.includes("-prep]") ||
      s.includes("[close]")
    ) return true;
  }
  return false;
}

function waveStart(n: number, events: EventEntry[], commits: CommitRow[]): string | null {
  const waveEvents = events.filter((e) => e.wave === n && typeof e.timestamp === "string");
  if (waveEvents.length > 0) {
    return waveEvents.reduce((min, e) => (e.timestamp < min ? e.timestamp : min), waveEvents[0]!.timestamp);
  }
  // Fallback: earliest commit that's clearly wave-N WORK (not preflight track-meta authoring).
  const trackRe = new RegExp(`\\bw${n}-[\\w-]+\\b`);
  const waveRe = new RegExp(`(wave-${n}\\b|W${n}\\.B\\d+)`);
  const workMatches = commits.filter((c) => {
    const s = c.subject;
    if (!(trackRe.test(s) || waveRe.test(s))) return false;
    return s.includes("[complete:") || s.includes("[fix-complete:") || s.includes("[fix-batch]") ||
           s.includes("[merge]") || s.includes("[audit-prompt") || s.includes("-prep]") ||
           s.includes("[test]") || s.includes("[impl]");
  });
  // commits come newest-first; last match = earliest.
  return workMatches.length > 0 ? workMatches[workMatches.length - 1]!.iso : null;
}

function waveEnd(n: number, status: string, _events: EventEntry[], commits: CommitRow[]): string | null {
  if (status !== "closed") return null;
  return waveClosedAt(n, commits);
}

type CritStatus = "pass" | "fail" | "pending" | "fixed";
type AuditKind = "ok" | "rej" | "fix";
// Criteria tuple: [CRIT-NNN, name, status, predicate?]
//   - name: short title from catalog acceptance_criteria[].name
//   - predicate: full detailed predicate text from catalog (optional; if absent, no expand)
type TrackDetail = {
  summary: string;
  criteria: Array<[string, string, CritStatus, string?]>;
  findings: Array<{ fid: string; what: string; fix: string | null; resolved: boolean; resolvedAt?: string }>;
  audit: Array<[string, AuditKind, string]>;
};

function condenseSummary(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  // Take the first paragraph (up to first blank-line break), collapse whitespace, cap at 600 chars.
  const firstPara = raw.split(/\n\s*\n/)[0] ?? raw;
  const collapsed = firstPara.replace(/\s+/g, " ").trim();
  return collapsed.length > 600 ? `${collapsed.slice(0, 580)}…` : (collapsed || fallback);
}

function buildTrackDetails(
  tracks: TrackMeta[],
  events: EventEntry[],
  commits: CommitRow[],
  catalog: CatalogReq[],
  containers: string,
  branches: Map<string, WorkerBranchInfo>,
): Record<string, TrackDetail> {
  const out: Record<string, TrackDetail> = {};

  for (const t of tracks) {
    if (!isImplTrack(t)) continue;
    const trackStatus = trackStatusFromCommits(t, commits, containers, branches).status;
    // Scope per user: in-flight + merged (and the intermediate "complete" state).
    if (trackStatus === "pending") continue;

    const reqIds = trackReqIds(t);
    const summary = condenseSummary(t.track_summary, `${t.track_id} — ${reqIds.join(", ") || "scope TBD"}`);

    // Criteria: enumerate from catalog, build CRIT-NNN with status derived from track state.
    const criteria: Array<[string, string, CritStatus, string?]> = [];
    let critIdx = 1;
    for (const reqId of reqIds) {
      const reqEntry = catalog.find((c) => c.id === reqId);
      if (!reqEntry) continue;
      for (const crit of reqEntry.criteria) {
        const status: CritStatus = trackStatus === "merged" || trackStatus === "complete" ? "pass" : "pending";
        const predicate = crit.predicate?.trim() || undefined;
        criteria.push([`CRIT-${String(critIdx).padStart(3, "0")}`, crit.name || crit.id, status, predicate]);
        critIdx++;
      }
    }

    // Walk events to build (a) per-track audit timeline + (b) findings list w/ resolution.
    const audit: Array<[string, AuditKind, string]> = [];
    const findingsById = new Map<string, { fid: string; what: string; fix: string | null; resolved: boolean; resolvedAt?: string }>();
    const findingsOrder: string[] = [];

    for (const ev of events) {
      const kind = ev.event_kind;
      if (kind === "audit_complete") {
        const byTrack = ev["findings_by_target_track"] as Record<string, number> | undefined;
        if (byTrack && Object.prototype.hasOwnProperty.call(byTrack, t.track_id)) {
          const verdict = ev.verdict;
          const k: AuditKind = verdict === "approved" ? "ok" : "rej";
          const count = byTrack[t.track_id] ?? 0;
          const what = `${ev.event_id} — verdict: ${verdict ?? "?"}${count > 0 ? ` — ${count} findings against this track` : ""}`;
          audit.push([ev.timestamp, k, what]);
        }
      } else if (kind === "fix_dispatch") {
        const dispatches = ev["fix_dispatched_to"] as Array<{ target_track: string; finding_ids: string[]; fix_cycle: number }> | undefined;
        const fd = dispatches?.find((f) => f.target_track === t.track_id);
        if (fd) {
          audit.push([ev.timestamp, "fix", `Fix dispatched — ${fd.finding_ids.length} findings (cycle ${fd.fix_cycle})`]);
          for (const fid of fd.finding_ids) {
            if (!findingsById.has(fid)) {
              findingsById.set(fid, { fid, what: "(see audit notes for SAE event around this finding)", fix: null, resolved: false });
              findingsOrder.push(fid);
            }
          }
        }
      } else if (kind === "fix_complete") {
        const fc = ev["fix_complete_for"] as { target_track: string; fix_cycle: number } | undefined;
        if (fc?.target_track === t.track_id) {
          const marker = (ev["marker_commit"] as string | undefined) ?? "";
          audit.push([ev.timestamp, "fix", `Fix complete (cycle ${fc.fix_cycle})${marker ? ` — marker ${marker.slice(0, 8)}` : ""}`]);
          const addressed = (ev["finding_ids_addressed"] as string[] | undefined) ?? [];
          for (const fid of addressed) {
            const f = findingsById.get(fid);
            if (f) {
              f.resolved = true;
              f.resolvedAt = ev.timestamp;
              f.fix = `Addressed in fix-batch (cycle ${fc.fix_cycle})${marker ? ` @ ${marker.slice(0, 8)}` : ""}`;
            }
          }
        }
      } else if (kind === "track_complete") {
        // Two observed shapes: (a) ev.target_track directly, (b) nested under fix_complete_for.
        const tgt = (ev["target_track"] as string | undefined) ?? ((ev["fix_complete_for"] as { target_track?: string } | undefined)?.target_track);
        if (tgt === t.track_id) {
          const marker = (ev["marker_commit"] as string | undefined) ?? "";
          audit.push([ev.timestamp, "ok", `Track complete${marker ? ` @ ${marker.slice(0, 8)}` : ""}`]);
        }
      }
    }

    // Append merge event from git log.
    const mergeRe = new RegExp(`\\[merge\\] swarm/${t.track_id}(\\b|$)`);
    const mergeCommit = commits.find((c) => mergeRe.test(c.subject));
    if (mergeCommit) {
      audit.push([mergeCommit.iso, "ok", `Merged to trunk @ ${mergeCommit.shortSha}`]);
    }

    audit.sort((a, b) => a[0].localeCompare(b[0]));

    // After resolution-walk, mark fixed criteria heuristically: if track had a fix cycle, the
    // *count* of fixed criteria equals the resolved-findings count. Without a per-criterion
    // mapping in the events log, we mark the first N criteria as "fixed" (the rest as "pass")
    // when status is merged. This is a TODO — improve once we extract per-criterion fix mapping.
    const resolvedCount = Array.from(findingsById.values()).filter((f) => f.resolved).length;
    if ((trackStatus === "merged" || trackStatus === "complete") && resolvedCount > 0) {
      const toMark = Math.min(resolvedCount, criteria.length);
      for (let i = 0; i < toMark; i++) {
        criteria[i] = [criteria[i]![0], criteria[i]![1], "fixed", criteria[i]![3]];
      }
    }

    out[t.track_id] = {
      summary,
      criteria,
      findings: findingsOrder.map((fid) => findingsById.get(fid)!),
      audit,
    };
  }
  return out;
}

function buildSnapshot(): {
  generatedAt: string;
  kpis: { wavesClosed: number; wavesTotal: number; criteriaDelivered: number; criteriaTotal: number; auditCycles: number; findings: number; fixCycles: number };
  waves: Array<{ n: number; status: "closed" | "in-flight" | "pending"; delivered: number; total: number; tracks: number; audits: number; findings: number; fixCycles: number; agents: number; start: string | null; end: string | null }>;
  tracks: Array<{ wave: number; id: string; req: string; criteria: number; status: string; audits: number; findings: number; merged: string | null }>;
  burndown: { waves: Array<{ n: number; color: string; points: Array<[string, number]> }> };
  containers: string;
  activity: Array<[string, string, string | null, string, string | null]>;
  trackDetails: ReturnType<typeof buildTrackDetails>;
} {
  const tracks = loadTrackMetas();
  const events = loadEvents();
  const commits = gitLog();
  const catalogFull = loadCatalogFull();
  const catalog = catalogFull.map((r) => ({ id: r.id, criteriaCount: r.criteria.length }));
  const containers = scionList();
  const branches = gitWorkerBranches();
  const wavePlanTotals = loadWavePlan();

  // Audit + findings + fix-cycle counts derived from audit branches + trunk
  // commits (current repo doesn't write spec-adherence-events.yaml).
  const auditStatsByWave = loadAuditStatsByWave(commits);

  const waves: Array<{ n: number; status: "closed" | "in-flight" | "pending"; delivered: number; total: number; tracks: number; audits: number; findings: number; fixCycles: number; agents: number; start: string | null; end: string | null }> = [];
  for (let n = 0; n <= 10; n++) {
    const waveTracks = tracks.filter((t) => isImplTrack(t) && t.wave === n);
    const trackCount = waveTracks.length;
    const criteriaTotal = trackCount > 0
      ? waveTracks.reduce((s, t) => s + trackCriteriaCount(t, catalog), 0)
      : (wavePlanTotals.get(n) ?? 0);
    let delivered = 0;
    for (const t of waveTracks) {
      const st = trackStatusFromCommits(t, commits, containers, branches);
      if (st.status === "merged") delivered += trackCriteriaCount(t, catalog);
    }
    const auditStats = auditStatsByWave.get(n) ?? { audits: 0, findings: 0, fixCycles: 0, cycles: 0 };
    let audits = auditStats.audits;
    let findings = auditStats.findings;
    let fixCycles = auditStats.fixCycles;
    // Legacy events fallback (in case events.yaml ever lands).
    for (const ev of events) {
      if (ev.wave !== n) continue;
      if (ev.event_kind === "wave_outcome") {
        audits = (ev.audit_runs as number) ?? audits;
        findings = (ev.total_findings_ever as number) ?? findings;
        fixCycles = (ev.fix_cycles as number) ?? fixCycles;
      }
    }
    // Status determination — explicit close marker > activity heuristic > pending.
    // CRITICAL: do not flag waves "in-flight" just because their track-metas exist;
    // future waves may have track-metas authored in preflight while not yet dispatched.
    const closedAt = waveClosedAt(n, commits);
    let status: "closed" | "in-flight" | "pending";
    if (closedAt) status = "closed";
    else if (waveHasActivity(n, commits, containers)) status = "in-flight";
    else status = "pending";
    const agents = countWaveAgents(n, containers, tracks);
    const start = waveStart(n, events, commits);
    const end = closedAt;
    waves.push({ n, status, delivered, total: criteriaTotal, tracks: trackCount, audits, findings, fixCycles, agents, start, end });
  }

  const wavesClosed = waves.filter((w) => w.status === "closed").length;
  const criteriaDelivered = waves.reduce((s, w) => s + w.delivered, 0);
  const criteriaTotal = waves.reduce((s, w) => s + w.total, 0);
  const auditCycles = waves.reduce((s, w) => s + w.audits, 0);
  const findings = waves.reduce((s, w) => s + w.findings, 0);
  const fixCycles = waves.reduce((s, w) => s + w.fixCycles, 0);

  const trackRows = tracks
    .filter(isImplTrack)
    .map((t) => {
      const st = trackStatusFromCommits(t, commits, containers, branches);
      let trackFindings = 0;
      let trackAudits = 0;
      for (const ev of events) {
        if (ev.event_kind === "fix_dispatch" && Array.isArray(ev.fix_dispatched_to)) {
          for (const fd of ev.fix_dispatched_to) if (fd.target_track === t.track_id) trackFindings += (fd.finding_ids ?? []).length;
        }
        if (ev.event_kind === "audit_complete" && ev.wave === t.wave) trackAudits++;
      }
      return {
        wave: t.wave ?? 0,
        id: t.track_id,
        req: trackReqList(t),
        criteria: trackCriteriaCount(t, catalog),
        status: st.status,
        audits: trackAudits,
        findings: trackFindings,
        merged: st.mergeAt ?? null,
      };
    })
    .sort((a, b) => (b.wave - a.wave) || a.id.localeCompare(b.id));

  // Burn-down: per-wave step-up by merge timestamp.
  const burndown: { waves: Array<{ n: number; color: string; points: Array<[string, number]> }> } = { waves: [] };
  for (let n = 0; n <= 10; n++) {
    const waveTracks = tracks.filter((t) => isImplTrack(t) && t.wave === n);
    if (waveTracks.length === 0) continue;
    const points: Array<[string, number]> = [];
    let cumulative = 0;
    const ordered = [...commits].reverse();
    const matched = new Set<string>();
    for (const c of ordered) {
      for (const t of waveTracks) {
        if (matched.has(t.track_id)) continue;
        if (
          c.subject.includes(`[merge] ${t.track_id}`) ||
          c.subject.includes(`[merge] swarm/${t.track_id}`) ||
          c.subject.includes(`[compose-base] merge ${t.track_id}`) ||
          c.subject.includes(`[stage] merge ${t.track_id}`) ||
          c.subject.includes(`[recompose] merge ${t.track_id}`) ||
          c.subject.includes(`origin/swarm/${t.track_id}`) ||
          (c.subject.startsWith("[merge]") && c.subject.includes(t.track_id))
        ) {
          matched.add(t.track_id);
          cumulative += trackCriteriaCount(t, catalog);
          points.push([c.iso, cumulative]);
        }
      }
    }
    // Fallback: tracks in closed waves that had no explicit merge commit
    // (e.g. meta-compose tracks merged implicitly via batch). Use the
    // wave close timestamp or the track's [complete:] timestamp.
    const waveClosed = waveClosedAt(n, commits);
    if (waveClosed) {
      for (const t of waveTracks) {
        if (matched.has(t.track_id)) continue;
        const completeSubj = `[complete:${t.track_id}]`;
        const fixCompleteSubj = `[fix-complete:${t.track_id}]`;
        const completeCommit = ordered.find((c) =>
          c.subject.includes(completeSubj) || c.subject.includes(fixCompleteSubj));
        if (completeCommit) {
          matched.add(t.track_id);
          cumulative += trackCriteriaCount(t, catalog);
          points.push([completeCommit.iso, cumulative]);
        }
      }
    }
    if (points.length > 0) burndown.waves.push({ n, color: WAVE_COLORS[n] ?? "#0066cc", points });
  }

  // Activity: 60 most-recent items mixing events + interesting commits.
  // Each row gets a leading emoji for at-a-glance scanning:
  //   ✅ approved audit · 🚀 merge to trunk · 🏁 wave closed · 🎯 track complete
  //   🔧 fix-complete · 🛠️  fix dispatched · ❌ rejected verdict · 🚨 escalation
  //   ⛔ stall/block/error
  function rowEmoji(desc: string, kind: string, verdict: string | null): string {
    if (/escalation/i.test(desc)) return "🚨 ";
    if (verdict === "rej" || /verdict:\s*rejected/i.test(desc)) return "❌ ";
    if (/\b(stalled|stuck|blocked|failure|failed|error)\b/i.test(desc)) return "⛔ ";
    if (kind === "wave_outcome" || /wave\s*\d+\s*closed/i.test(desc)) return "🏁 ";
    if (/\[merge\]\s*swarm\//i.test(desc)) return "🚀 ";
    if (verdict === "ok" || /verdict:\s*approved/i.test(desc)) return "✅ ";
    if (/\[fix-complete:/i.test(desc) || (kind === "fix_dispatch" && /fix_complete/i.test(desc))) return "🔧 ";
    if (/\[complete:/i.test(desc) || kind === "track_complete") return "🎯 ";
    if (kind === "fix_dispatch" || /fix_dispatch/i.test(desc)) return "🛠️ ";
    return "";
  }

  const ACT: Array<[string, string, string | null, string, string | null]> = [];
  for (const ev of events) {
    const verdict = ev.verdict === "approved" ? "ok" : ev.verdict === "rejected" ? "rej" : null;
    const wavePart = ev.wave != null ? ` (wave ${ev.wave})` : "";
    let kind = ev.event_kind;
    if (!["commit", "audit_complete", "fix_dispatch", "track_complete", "wave_outcome"].includes(kind)) kind = "commit";
    const rawDesc = `${ev.event_id}${wavePart} — ${ev.event_kind}${ev.verdict ? ` — verdict: ${ev.verdict}` : ""}${ev.findings_count != null ? ` — ${ev.findings_count} findings` : ""}`;
    ACT.push([ev.timestamp, kind, null, rowEmoji(rawDesc, kind, verdict) + rawDesc, verdict]);
  }
  const interesting = /\[(review|merge|complete:|fix-complete:|escalation|wave-|dispatch|compose|status|event)/;
  for (const c of commits.slice(0, 80)) {
    if (interesting.test(c.subject)) {
      const verdictMatch = /verdict:\s*(approved|rejected)/.exec(c.subject);
      const verdict = verdictMatch ? (verdictMatch[1] === "approved" ? "ok" : "rej") : null;
      ACT.push([c.iso, "commit", c.shortSha, rowEmoji(c.subject, "commit", verdict) + c.subject, verdict]);
    }
  }
  ACT.sort((a, b) => (a[0] < b[0] ? 1 : -1));

  return {
    generatedAt: new Date().toISOString(),
    kpis: { wavesClosed, wavesTotal: 10, criteriaDelivered, criteriaTotal, auditCycles, findings, fixCycles },
    waves,
    tracks: trackRows,
    burndown,
    containers,
    activity: ACT.slice(0, 80),
    trackDetails: buildTrackDetails(tracks, events, commits, catalogFull, containers, branches),
  };
}

function injectIntoTemplate(snapshot: ReturnType<typeof buildSnapshot>): string {
  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found at ${TEMPLATE_PATH}; copy "Phase-2 Swarm Dashboard.html" into tools/swarm-dashboard/template/.`);
  }
  let html = readFileSync(TEMPLATE_PATH, "utf-8");

  // 1. Replace <script id="swarm-data" type="application/json"> ... </script>
  const dataBlock = JSON.stringify(
    {
      generatedAt: snapshot.generatedAt,
      kpis: snapshot.kpis,
      waves: snapshot.waves,
      tracks: snapshot.tracks,
      burndown: snapshot.burndown,
      containers: snapshot.containers,
    },
    null,
    2,
  );
  html = html.replace(
    /<script id="swarm-data" type="application\/json">[\s\S]*?<\/script>/,
    `<script id="swarm-data" type="application/json">\n${dataBlock}\n</script>`,
  );

  // 2. Replace const ACTIVITY = [ ... ];  (multi-line array literal in main script).
  const activityLines = snapshot.activity
    .map((row) => {
      const [ts, kind, sha, desc, verdict] = row;
      const shaPart = sha === null ? "null" : JSON.stringify(sha);
      const verdictPart = verdict === null ? "null" : JSON.stringify(verdict);
      return `  [${JSON.stringify(ts)}, ${JSON.stringify(kind)}, ${shaPart}, ${JSON.stringify(desc)}, ${verdictPart}],`;
    })
    .join("\n");
  html = html.replace(
    /const ACTIVITY = \[[\s\S]*?\n\];/,
    `const ACTIVITY = [\n${activityLines}\n];`,
  );

  // 3. Replace const TRACK_DETAILS = { ... };  (multi-line object literal).
  html = html.replace(
    /const TRACK_DETAILS = \{[\s\S]*?\n\};/,
    `const TRACK_DETAILS = ${JSON.stringify(snapshot.trackDetails, null, 2)};`,
  );

  // 4. Default the Tracks-pane sort to descending by wave (latest first).
  // Two coupled changes — the template's JS hardcodes the initial sort direction
  // separately from the th class, so we patch both for the page-load to be wave-desc
  // and to remain wave-desc across every 30s auto-refresh.
  html = html.replace(
    /<th data-key="wave"(\s+)class="sort sorted asc">Wave<span class="arrow">↑<\/span><\/th>/,
    `<th data-key="wave"$1class="sort sorted desc">Wave<span class="arrow">↓</span></th>`,
  );
  html = html.replace(
    /let sortKey = 'wave';\s*\n\s*let sortDir = 'asc';/,
    `let sortKey = 'wave';\n  let sortDir = 'desc';`,
  );

  // 5. Inject celebration animations (toast + confetti for new approval/merge events).
  html = injectCelebrations(html);

  // 6. Localize activity-feed timestamps to the browser's local timezone.
  // The design's renderFeed uses HH:mmZ (UTC) — patch fmt + fmtDay + the day-separator label
  // to render in the user's local TZ via Date.toLocaleTimeString / toLocaleDateString.
  html = html.replace(
    /function fmt\(ts\) \{[\s\S]*?return m\[1\] \+ ':' \+ m\[2\] \+ 'Z';\s*\}/,
    `function fmt(ts) { try { return new Date(ts).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', hour12:false}); } catch { return ts; } }`,
  );
  html = html.replace(
    /function fmtDay\(ts\) \{\s*return ts\.slice\(5, 10\);[\s\S]*?\}/,
    `function fmtDay(ts) { try { const d = new Date(ts); return String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); } catch { return ts.slice(5, 10); } }`,
  );
  html = html.replace(
    /\$\{ts\.slice\(0,\s*10\)\}/g,
    `\${(function(){try{const d=new Date(ts);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}catch{return ts.slice(0,10);}})()}`,
  );

  // 6b. Extend the Gantt bar color map to W6-W10. The design template hard-codes only W1-W5;
  // for W6+ it falls back to var(--neutral-400) which isn't defined → invisible bars.
  html = html.replace(
    /const colors = \{ 1:'#0a7f29', 2:'#0066cc', 3:'#7700cc', 4:'#ffaa00', 5:'#cc0033' \};/,
    `const colors = { 1:'#0a7f29', 2:'#0066cc', 3:'#7700cc', 4:'#ffaa00', 5:'#cc0033', 6:'#0a7f29', 7:'#0066cc', 8:'#7700cc', 9:'#ffaa00', 10:'#cc0033' };`,
  );

  // 6c. Localize ALL timestamps to the browser's local TZ. Inject helpers right after
  // the DATA parse so they're available throughout the template's main script.
  html = html.replace(
    /const DATA = JSON\.parse\(document\.getElementById\('swarm-data'\)\.textContent\);/,
    `const DATA = JSON.parse(document.getElementById('swarm-data').textContent);
window.__fmtLDT = function(ts) { try { const d=new Date(ts); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } catch (e) { return ts; } };
window.__fmtLT = function(ts) { try { const d=new Date(ts); return String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0'); } catch (e) { return ts; } };`,
  );

  // 6c-i. Header generated timestamp — drop the explicit UTC timeZone option.
  html = html.replace(
    /const opts = \{ dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' \};\s*\n\s*document\.getElementById\('gen-ts'\)\.textContent =\s*\n\s*'Generated ' \+ new Intl\.DateTimeFormat\('en-US', opts\)\.format\(d\) \+ ' UTC';/,
    `const opts = { dateStyle: 'medium', timeStyle: 'short' };\n  document.getElementById('gen-ts').textContent =\n    'Generated ' + new Intl.DateTimeFormat('en-US', opts).format(d);`,
  );

  // 6c-ii. fmtClock(ts) — used in Gantt popover; localize.
  html = html.replace(
    /function fmtClock\(ts\) \{\s*\n\s*if \(!ts\) return '—';\s*\n\s*const m = ts\.match\(\/T\(\\d\{2\}\):\(\\d\{2\}\)\/\);\s*\n\s*return m \? m\[1\] \+ ':' \+ m\[2\] : ts;\s*\n\}/,
    `function fmtClock(ts) {\n  if (!ts) return '—';\n  return window.__fmtLT(ts);\n}`,
  );

  // 6c-iii. fmtTs(ts) — Tracks-table "Merged" column.
  html = html.replace(
    /function fmtTs\(ts\) \{\s*\n\s*if \(!ts\) return '<span class="empty">— not merged<\/span>';\s*\n\s*return ts\.replace\('T', ' '\)\.replace\('Z', 'Z'\);\s*\n\s*\}/,
    `function fmtTs(ts) {\n      if (!ts) return '<span class="empty">— not merged</span>';\n      return window.__fmtLDT(ts);\n    }`,
  );

  // 6c-iv. Drawer head "merged" display.
  html = html.replace(
    /\$\{track\.merged\.replace\('T',' '\)\.replace\('Z','Z'\)\}/,
    `\${window.__fmtLDT(track.merged)}`,
  );

  // 6c-v. Audit-log timeline ts (short HH:mm form).
  html = html.replace(
    /const tsShort = ts\.replace\('T', ' '\)\.replace\('Z', 'Z'\);/,
    `const tsShort = window.__fmtLT(ts);`,
  );

  // 6c-vi. ETA in burndown chart.
  html = html.replace(
    /const etaFmt = etaDate\.toISOString\(\)\.replace\('T', ' '\)\.slice\(0, 16\) \+ 'Z';/,
    `const etaFmt = window.__fmtLDT(etaDate);`,
  );

  // 6c-vii. Burndown tooltip title.
  html = html.replace(
    /title: items => new Date\(items\[0\]\.parsed\.x\)\.toISOString\(\)\.replace\('T', ' '\)\.slice\(0, 16\) \+ 'Z',/,
    `title: items => window.__fmtLDT(new Date(items[0].parsed.x)),`,
  );

  // 6c-viii. Per-wave chart tooltip.
  html = html.replace(
    /return d\.toISOString\(\)\.replace\('T',' '\)\.slice\(0, 16\) \+ 'Z';/,
    `return window.__fmtLDT(d);`,
  );

  // 6c-ix. The template hardcodes the burndown start anchor to a date from
  //         the prior engagement (2026-05-11). Replace it with the first
  //         actual merge timestamp so velocity + ETA reflect the real run.
  //         Fallback: 24h before `now` to avoid a near-zero denominator.
  html = html.replace(
    /const startTs = '2026-05-11T05:00Z';/,
    `const startTs = (merges[0] && merges[0].t)
        ? merges[0].t
        : new Date(+new Date(DATA.generatedAt) - 86400000).toISOString();`,
  );

  // 6c-x. Gantt axis ticks: template uses UTC accessors (getUTCHours/UTCDate),
  // but the popover tooltips render in local time via __fmtLT. Convert the
  // axis to local time too so a wave's bar position and its tooltip times agree.
  html = html.replace(
    /startDate\.setUTCMinutes\(0, 0, 0\);\s*\n\s*startDate\.setUTCHours\(startDate\.getUTCHours\(\) \+ 1\);/,
    `startDate.setMinutes(0, 0, 0);\n  startDate.setHours(startDate.getHours() + 1);`,
  );
  html = html.replace(
    /const hh = String\(d\.getUTCHours\(\)\)\.padStart\(2, '0'\);\s*\n\s*const day = d\.getUTCDate\(\);/,
    `const hh = String(d.getHours()).padStart(2, '0');\n    const day = d.getDate();`,
  );
  // Day-separator label hardcodes 'May ' — swap to a proper localized
  // short-month format so the axis is correct outside May too.
  html = html.replace(
    /const dayLabel = \['May ' \+ day\]\[0\];/,
    `const dayLabel = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });`,
  );

  // 7. Patch the criteria renderer in the drawer to support 4th-element predicate
  // (expand-on-click). Replace the entire d.criteria.map(...) block.
  const newCritJs = [
    "const critItems = d.criteria.map(function(item) {",
    "  const cid = item[0], desc = item[1], st = item[2], predicate = item[3];",
    "  const cls = st === 'fail' ? 'fail' : st === 'pending' ? 'pending' : st === 'fixed' ? 'fixed' : '';",
    "  const tag = st === 'fail' ? 'FAIL' : st === 'pending' ? 'PEND' : st === 'fixed' ? 'FIXED' : 'PASS';",
    "  const esc = function(s) { return String(s).replace(/[&<>]/g, function(c) { return c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'; }); };",
    "  const hasPred = predicate && String(predicate).length > 0;",
    "  const liCls = cls + (hasPred ? ' has-pred' : '');",
    "  const click = hasPred ? ' onclick=\"this.classList.toggle(\\'expanded\\')\"' : '';",
    "  const chev = hasPred ? '<span class=\"cit-chev\">›</span>' : '';",
    "  const pre = hasPred ? '<pre class=\"predicate\">' + esc(predicate) + '</pre>' : '';",
    "  return '<li class=\"' + liCls + '\"' + click + '>' +",
    "    '<span class=\"cid\">' + cid + '</span>' +",
    "    '<span class=\"glyph\"></span>' +",
    "    '<span class=\"desc\">' + desc + chev + pre + '</span>' +",
    "    '<span class=\"tag-mini\">' + tag + '</span>' +",
    "  '</li>';",
    "}).join('');",
  ].join("\n      ");
  html = html.replace(
    /const critItems = d\.criteria\.map\(\(\[cid, desc, st\]\) => \{[\s\S]*?\}\)\.join\(''\);/,
    newCritJs,
  );

  return html;
}

function injectCelebrations(html: string): string {
  const css = `
<style>
/* === Recent activity pane: enlarge scroll window === */
.feed { max-height: 900px !important; }

/* === Track-detail drawer: criteria predicates expand on click === */
.crit-list li.has-pred { cursor: pointer; }
.crit-list li.has-pred .cit-chev {
  display: inline-block;
  margin-left: 4px;
  color: var(--fg-faint);
  font-size: 13px;
  transition: transform 160ms ease-out;
}
.crit-list li.has-pred.expanded .cit-chev { transform: rotate(90deg); }
.crit-list li .predicate {
  display: none;
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--surface-2);
  border-left: 2px solid var(--neutral-200);
  border-radius: 3px;
  font: 400 12px/1.5 "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fg-muted);
  white-space: pre-wrap;
  word-break: break-word;
}
.crit-list li.has-pred.expanded .predicate { display: block; }

/* === Celebration animations === */
@keyframes celebrate-toast-slide {
  0%   { transform: translateX(-50%) translateY(-120%); opacity: 0; }
  10%  { transform: translateX(-50%) translateY(0); opacity: 1; }
  85%  { transform: translateX(-50%) translateY(0); opacity: 1; }
  100% { transform: translateX(-50%) translateY(-20%); opacity: 0; }
}
.celebrate-toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 18px 10px 14px;
  background: var(--success, #0a7f29);
  color: #fff;
  border-radius: 999px;
  font: 500 13px 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  letter-spacing: 0.04em;
  box-shadow: 0 8px 32px rgba(0,0,0,0.22), 0 2px 6px rgba(0,0,0,0.12);
  z-index: 1000;
  pointer-events: none;
  white-space: nowrap;
  max-width: 92vw;
  overflow: hidden;
  text-overflow: ellipsis;
  animation: celebrate-toast-slide 5s cubic-bezier(.2,.7,.2,1) forwards;
}
.celebrate-toast.merge { background: var(--primary, #0066cc); }
.celebrate-toast .label { font-weight: 600; letter-spacing: 0.08em; }
.celebrate-toast .sub { opacity: 0.82; font-weight: 400; margin-left: 10px; font-size: 11.5px; }
.celebrate-toast.wave-close {
  padding: 16px 30px;
  font-size: 16px;
  letter-spacing: 0.10em;
  background: linear-gradient(135deg, #0a7f29 0%, #0066cc 22%, #7700cc 44%, #ffaa00 70%, #cc0033 100%);
  background-size: 220% 220%;
  animation: celebrate-toast-slide 7.6s cubic-bezier(.2,.7,.2,1) forwards, wc-rainbow-shift 4.5s linear infinite;
  box-shadow: 0 16px 56px rgba(0,0,0,0.36), 0 4px 12px rgba(0,0,0,0.18);
  text-shadow: 0 1px 3px rgba(0,0,0,0.35);
  display: flex;
  align-items: center;
  gap: 12px;
}
.celebrate-toast.wave-close .wc-emoji {
  font-size: 22px;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.35));
  text-shadow: none;
}
.celebrate-toast.wave-close .wc-label { font-weight: 700; }
@keyframes wc-rainbow-shift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
.confetti.big {
  width: 12px;
  height: 12px;
  animation-duration: 2.6s;
}
@keyframes confetti-fly {
  0%   { transform: translate(0,0) rotate(0deg); opacity: 1; }
  100% { transform: translate(var(--vx), var(--vy)) rotate(var(--rot)); opacity: 0; }
}
.confetti {
  position: fixed;
  width: 8px;
  height: 8px;
  pointer-events: none;
  z-index: 999;
  border-radius: 1px;
  animation: confetti-fly 1.9s cubic-bezier(.2,.7,.3,1) forwards;
  will-change: transform, opacity;
}
@keyframes feed-row-pulse-success {
  0%   { background: rgba(10,127,41,0.20); box-shadow: inset 4px 0 0 var(--success, #0a7f29); }
  100% { background: transparent; box-shadow: inset 4px 0 0 transparent; }
}
@keyframes feed-row-pulse-primary {
  0%   { background: rgba(0,102,204,0.20); box-shadow: inset 4px 0 0 var(--primary, #0066cc); }
  100% { background: transparent; box-shadow: inset 4px 0 0 transparent; }
}
.celebrate-row-success { animation: feed-row-pulse-success 2.6s ease-out; }
.celebrate-row-primary { animation: feed-row-pulse-primary 2.6s ease-out; }
</style>
`;
  const script = `
<script>
/* === Celebration runtime ===
 * Reads window.ACTIVITY (defined by the template's main script).
 * Tracks a localStorage watermark: events newer than the watermark are "new"
 * and trigger a toast (and confetti, for merge events).
 * Use ?celebrate-demo=1 in the URL to force-fire the most recent approval/merge
 * for visual verification without waiting for new events.
 */
(function celebrate() {
  if (!Array.isArray(window.ACTIVITY)) return;
  const KEY = 'phase2-celebrate-watermark';
  const SESSION_KEY = 'phase2-celebrate-session-fired';
  const url = new URL(window.location.href);
  const demo = url.searchParams.get('celebrate-demo');
  const replayParam = url.searchParams.get('celebrate-replay');
  const replayN = replayParam === null ? null : Math.max(1, Math.min(12, parseInt(replayParam, 10) || 8));
  const latest = ACTIVITY.length > 0 ? ACTIVITY[0][0] : '';
  let watermark = localStorage.getItem(KEY) || '';
  const sessionFired = sessionStorage.getItem(SESSION_KEY) === '1';

  let news;
  if (replayN !== null) {
    // Replay mode: fire the top N approval/merge events regardless of watermark.
    news = ACTIVITY.filter(matchesCelebration).slice(0, replayN).reverse();
  } else if (demo) {
    // Demo mode: fire the top 6 approval/merge events regardless of watermark
    // (covers a typical wave-close burst: ~3 merges + audit-approved + wave_outcome).
    news = ACTIVITY.filter(matchesCelebration).slice(0, 6).reverse();
  } else if (!sessionFired) {
    // First visit in this browser tab session — fire the celebration demo so the
    // user sees what's been happening recently. Then mark the session as "fired"
    // (sessionStorage persists across the 30s auto-refresh but resets on tab close)
    // so subsequent refreshes only fire on events newer than the watermark.
    news = ACTIVITY.filter(matchesCelebration).slice(0, 6).reverse();
    sessionStorage.setItem(SESSION_KEY, '1');
    if (latest) localStorage.setItem(KEY, latest);
  } else {
    // Subsequent refresh in same session — only celebrate events newer than the watermark.
    news = ACTIVITY.filter(([ts]) => ts > watermark).reverse();
    if (latest) localStorage.setItem(KEY, latest);
  }
  if (news.length === 0) return;

  let toastIdx = 0;
  news.forEach((event, i) => {
    if (!matchesCelebration(event)) return;
    const [ts, kind, sha, desc, verdict] = event;
    const wave = isWaveClose(event);
    const isMerge = !wave && (kind === 'commit' && /\\[merge\\] swarm\\//.test(desc));
    setTimeout(() => {
      if (wave) {
        celebrateWaveClose(desc, toastIdx++);
      } else if (isMerge) {
        showToast('merge', desc, toastIdx++);
        burstConfetti(false);
      } else {
        showToast('approval', desc, toastIdx++);
      }
    }, i * 700);
  });

  function isWaveClose(event) {
    if (!event) return false;
    const [, kind, , desc] = event;
    return kind === 'wave_outcome' || /\\bwave\\s*\\d+\\s*closed\\b/i.test(desc);
  }

  function matchesCelebration(event) {
    if (!event) return false;
    const [, kind, , desc, verdict] = event;
    if (isWaveClose(event)) return true;
    const isMerge = kind === 'commit' && /\\[merge\\] swarm\\//.test(desc);
    const isApproval = !isMerge && (verdict === 'ok' || (kind === 'commit' && /verdict:\\s*approved/i.test(desc)));
    return isMerge || isApproval;
  }

  function celebrateWaveClose(desc, stackIdx) {
    const waveMatch = /wave\\s*(\\d+)/i.exec(desc);
    const waveN = waveMatch ? waveMatch[1] : '?';
    showWaveCloseToast(waveN, stackIdx);
    // 4-burst confetti spectacle: center, left, right, center — staggered by ~250ms
    const W = window.innerWidth;
    burstConfetti(true, W * 0.5, 130, 56);
    setTimeout(function () { burstConfetti(true, W * 0.20, 180, 42); }, 220);
    setTimeout(function () { burstConfetti(true, W * 0.80, 180, 42); }, 440);
    setTimeout(function () { burstConfetti(true, W * 0.5, 110, 56); }, 660);
  }

  function showWaveCloseToast(waveN, stackIdx) {
    const t = document.createElement('div');
    t.className = 'celebrate-toast wave-close';
    t.style.top = (88 + stackIdx * 70) + 'px';
    const left = document.createElement('span'); left.className = 'wc-emoji'; left.textContent = '🏁';
    const label = document.createElement('span'); label.className = 'wc-label'; label.textContent = 'WAVE ' + waveN + ' CLOSED';
    const right = document.createElement('span'); right.className = 'wc-emoji'; right.textContent = '🎊';
    t.appendChild(left); t.appendChild(label); t.appendChild(right);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 7700);
  }

  function showToast(kind, desc, stackIdx) {
    const t = document.createElement('div');
    t.className = 'celebrate-toast' + (kind === 'merge' ? ' merge' : '');
    t.style.top = (96 + stackIdx * 56) + 'px';
    const label = kind === 'merge' ? 'MERGED' : 'APPROVED';
    const labelEl = document.createElement('span');
    labelEl.className = 'label';
    labelEl.textContent = label;
    const subEl = document.createElement('span');
    subEl.className = 'sub';
    subEl.textContent = trimDesc(desc);
    t.appendChild(labelEl);
    t.appendChild(subEl);
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 5100);
  }

  function trimDesc(d) {
    if (d.length <= 64) return d;
    return d.slice(0, 60) + '…';
  }

  function burstConfetti(big, cx, cy, count) {
    const colors = ['#0066cc', '#0a7f29', '#7700cc', '#ffaa00', '#cc0033'];
    if (typeof cx !== 'number') cx = window.innerWidth / 2;
    if (typeof cy !== 'number') cy = 120;
    const N = typeof count === 'number' ? count : (big ? 56 : 40);
    const velBase = big ? 280 : 220;
    const velSpread = big ? 280 : 200;
    const gravityBase = big ? 280 : 220;
    const lifeMs = big ? 2600 : 1900;
    for (let i = 0; i < N; i++) {
      const p = document.createElement('div');
      p.className = 'confetti' + (big ? ' big' : '');
      p.style.left = cx + 'px';
      p.style.top = cy + 'px';
      p.style.background = colors[i % colors.length];
      const spread = (Math.random() - 0.5) * Math.PI * (big ? 1.4 : 1.2);
      const vel = velBase + Math.random() * velSpread;
      const vx = Math.sin(spread) * vel;
      const vy = Math.cos(spread) * vel * (big ? 0.5 : 0.7) + gravityBase + Math.random() * (big ? 180 : 120);
      p.style.setProperty('--vx', vx + 'px');
      p.style.setProperty('--vy', vy + 'px');
      p.style.setProperty('--rot', (Math.random() * (big ? 1080 : 720) - (big ? 540 : 360)) + 'deg');
      document.body.appendChild(p);
      setTimeout(function () { p.remove(); }, lifeMs);
    }
  }
})();
</script>
`;
  html = html.replace(/<\/head>/i, css + "</head>");
  html = html.replace(/<\/body>/i, script + "</body>");
  return html;
}

export function renderHtml(options?: { refreshSeconds?: number; fetchInfo?: { fetched: boolean; ms: number; error?: string } }): { html: string; snapshot: ReturnType<typeof buildSnapshot> } {
  const snapshot = buildSnapshot();
  let html = injectIntoTemplate(snapshot);
  // Inject meta-refresh after <head> if requested.
  const refresh = options?.refreshSeconds;
  if (refresh && refresh > 0) {
    html = html.replace(/<head>/i, `<head>\n  <meta http-equiv="refresh" content="${refresh}">`);
  }
  // Inject a tiny footer note about server-side fetch status.
  if (options?.fetchInfo) {
    const fi = options.fetchInfo;
    const note = fi.error
      ? `git fetch FAILED (${fi.ms}ms): ${fi.error.slice(0, 80)}`
      : fi.fetched
      ? `git fetch ${fi.ms}ms ago`
      : `git fetch throttled (recent)`;
    html = html.replace(
      /<\/body>/i,
      `<div style="position:fixed;bottom:8px;right:12px;font:11px/1.4 -apple-system,monospace;color:#8a8d96;background:rgba(255,255,255,0.9);padding:4px 8px;border-radius:6px;box-shadow:0 1px 2px rgba(15,18,30,0.06);">${note}${refresh ? ` · auto-refresh ${refresh}s` : ""}</div></body>`,
    );
  }
  return { html, snapshot };
}

export function renderToFile(): void {
  const { html, snapshot } = renderHtml();
  mkdirSync(dirname(DIST), { recursive: true });
  writeFileSync(DIST, html, "utf-8");
  console.log(`Wrote ${DIST}`);
  console.log(
    `  waves=10  tracks=${snapshot.tracks.length}  activity=${snapshot.activity.length}  ` +
      `criteria=${snapshot.kpis.criteriaDelivered}/${snapshot.kpis.criteriaTotal}  ` +
      `wavesClosed=${snapshot.kpis.wavesClosed}/${snapshot.kpis.wavesTotal}`,
  );
}

// CLI entry — only run when executed directly, not when imported.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname, "render.ts");
if (invokedDirectly) {
  renderToFile();
}
