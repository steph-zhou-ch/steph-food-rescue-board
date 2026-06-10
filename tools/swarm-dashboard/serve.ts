/**
 * Local HTTP server for the swarm dashboard.
 *
 * GET /                  → Captain Dashboard (default home: forward-looking,
 *                          drill-down, what the Captain wants to see)
 * GET /legacy            → Phase-2 design template render (legacy view)
 * GET /api/snapshot      → JSON snapshot used by the legacy template
 * GET /api/captain       → JSON snapshot used by the Captain dashboard
 * GET /healthz           → "ok"
 *
 * Run via: `pnpm serve` (default port 4317; override via PORT env)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { renderHtml, gitFetch } from "./render.ts";
import {
  buildCaptainSnapshot,
  injectCaptainExtensions,
  invalidateAllSections,
  renderCaptainHtml,
  renderCaptainSkeleton,
  sectionActivity,
  sectionAudits,
  sectionCoverage,
  sectionHero,
  sectionLessons,
  sectionQueue,
  sectionStalls,
  sectionTimeline,
  sectionWorkers,
} from "./captain.ts";

// Simple TTL cache for the legacy template render (it's the slow path).
let _legacyHtmlCache: { html: string; at: number } | null = null;
const LEGACY_HTML_TTL_MS = 25_000;

const PORT = Number(process.env["PORT"] ?? 4317);
const HOST = process.env["HOST"] ?? "127.0.0.1";
const DEFAULT_REFRESH = Number(process.env["REFRESH_SECONDS"] ?? 30);

function parseRefresh(url: string): number {
  const qIdx = url.indexOf("?");
  const refreshParam = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx)).get("refresh") : null;
  return refreshParam !== null ? Number(refreshParam) : DEFAULT_REFRESH;
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";
  const started = Date.now();
  try {
    if (path === "/" || path === "/captain") {
      // Designer template (legacy view) + Captain extensions, all inline.
      // The legacy template provides the design DNA (KPI strip, wave grid,
      // burndowns, gantt, tracks/activity 2-col, containers, drawer
      // drill-down, theme toggle). Captain extensions append below using
      // the same CSS tokens + classes — same look-and-feel.
      const refreshSeconds = parseRefresh(url);
      const now = Date.now();
      let legacyHtml: string;
      if (_legacyHtmlCache && now - _legacyHtmlCache.at < LEGACY_HTML_TTL_MS) {
        legacyHtml = _legacyHtmlCache.html;
      } else {
        const fetchInfo = gitFetch();
        const r = renderHtml({ refreshSeconds, fetchInfo });
        legacyHtml = r.html;
        _legacyHtmlCache = { html: legacyHtml, at: now };
      }
      const html = injectCaptainExtensions(legacyHtml);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    } else if (path === "/skeleton") {
      // Lightweight skeleton (no template) — for debugging the per-section endpoints.
      const refreshSeconds = parseRefresh(url);
      const { html } = renderCaptainSkeleton({ refreshSeconds });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      res.end(html);
    } else if (path.startsWith("/api/captain/")) {
      const sectionName = path.slice("/api/captain/".length);
      const sectionLoaders: Record<string, () => unknown> = {
        hero: sectionHero,
        queue: sectionQueue,
        stalls: sectionStalls,
        timeline: sectionTimeline,
        activity: sectionActivity,
        audits: sectionAudits,
        workers: sectionWorkers,
        coverage: sectionCoverage,
        lessons: sectionLessons,
      };
      const loader = sectionLoaders[sectionName];
      if (!loader) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end(`unknown section: ${sectionName}`);
      } else {
        const start = Date.now();
        const data = loader();
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-section-ms": String(Date.now() - start),
        });
        res.end(JSON.stringify(data));
      }
    } else if (path === "/api/invalidate") {
      invalidateAllSections();
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("invalidated");
    } else if (path === "/static" || path === "/captain/static") {
      // Force a fully-rendered static page (legacy behaviour) for offline use.
      const refreshSeconds = parseRefresh(url);
      const snapshot = buildCaptainSnapshot();
      const { html } = renderCaptainHtml({ refreshSeconds, snapshot });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-captain-queue": String(snapshot.queue.length),
        "x-captain-findings": String(snapshot.kpis.findingsTotal),
        "x-captain-wave": String(snapshot.currentWave),
      });
      res.end(html);
    } else if (path === "/legacy") {
      const refreshSeconds = parseRefresh(url);
      const fetchInfo = gitFetch();
      const { html, snapshot } = renderHtml({ refreshSeconds, fetchInfo });
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-snapshot-tracks": String(snapshot.tracks.length),
        "x-snapshot-waves-closed": `${snapshot.kpis.wavesClosed}/${snapshot.kpis.wavesTotal}`,
        "x-git-fetch-ms": String(fetchInfo.ms),
        "x-git-fetched": String(fetchInfo.fetched),
      });
      res.end(html);
    } else if (path === "/api/snapshot") {
      const fetchInfo = gitFetch();
      const { snapshot } = renderHtml({ fetchInfo });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-git-fetch-ms": String(fetchInfo.ms),
      });
      res.end(JSON.stringify({ ...snapshot, _server: { gitFetch: fetchInfo } }, null, 2));
    } else if (path === "/api/captain") {
      const snapshot = buildCaptainSnapshot();
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(snapshot, null, 2));
    } else if (path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    } else {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    }
  } catch (err) {
    const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(`render failed:\n${msg}`);
  } finally {
    const ms = Date.now() - started;
    console.log(`[${new Date().toISOString()}] ${req.method} ${url} ${res.statusCode} ${ms}ms`);
  }
}

const server = createServer(handle);
server.listen(PORT, HOST, () => {
  console.log(`Swarm dashboard server listening on http://${HOST}:${PORT}/`);
  console.log(`  GET /                       Captain Dashboard skeleton (instant load; sections fetch via API)`);
  console.log(`  GET /api/captain/<section>  hero | queue | stalls | timeline | activity | audits | workers | coverage | lessons`);
  console.log(`  GET /api/invalidate         force re-read all sections on next fetch`);
  console.log(`  GET /static                 Legacy fully-rendered captain HTML (slow but self-contained)`);
  console.log(`  GET /legacy                 Phase-2 design template render`);
  console.log(`  GET /api/snapshot           Legacy JSON snapshot`);
  console.log(`  GET /api/captain            Full Captain JSON snapshot`);
  console.log(`  GET /healthz                liveness`);
});
