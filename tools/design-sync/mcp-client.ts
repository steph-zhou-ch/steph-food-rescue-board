// Minimal streamable-HTTP MCP client for the Figma Dev Mode MCP server.
//
// The Figma server speaks JSON-RPC 2.0 over HTTP at /mcp. Responses come
// back as Server-Sent Events (`event: message\ndata: {...json...}\n\n`),
// even when the client did not request streaming, so we always parse SSE
// frames from the body.
//
// Session lifecycle:
//   1. POST `initialize` (no session yet) → server returns sessionId in
//      the `mcp-session-id` response header.
//   2. POST `notifications/initialized` with the sessionId.
//   3. POST `tools/call` (or any other request) with the sessionId.

import { randomUUID } from "node:crypto";

const ENDPOINT = process.env.FIGMA_MCP_URL ?? "http://127.0.0.1:3845/mcp";

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: number | string | null; result: unknown }
  | { jsonrpc: "2.0"; id: number | string | null; error: { code: number; message: string; data?: unknown } };

interface CallOpts {
  sessionId?: string;
  isNotification?: boolean;
}

let sessionId: string | undefined;
let nextId = 1;

function parseSseEvents(body: string): unknown[] {
  // SSE frames are separated by blank lines. We only care about `data:` lines.
  const events: unknown[] = [];
  for (const block of body.split(/\r?\n\r?\n/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trimStart());
    if (dataLines.length === 0) continue;
    const payload = dataLines.join("\n");
    try {
      events.push(JSON.parse(payload));
    } catch {
      // ignore non-JSON event payloads (heartbeats, etc.)
    }
  }
  return events;
}

async function postJsonRpc(body: object, opts: CallOpts = {}): Promise<{ response?: JsonRpcResponse; sessionId?: string }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (opts.sessionId) headers["mcp-session-id"] = opts.sessionId;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const newSessionId = res.headers.get("mcp-session-id") ?? undefined;

  if (opts.isNotification) {
    // Notifications return 202 No Content.
    return { sessionId: newSessionId };
  }

  if (!res.ok && res.status !== 200) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP HTTP ${res.status}: ${text || res.statusText}`);
  }

  const text = await res.text();
  const contentType = res.headers.get("content-type") ?? "";

  let parsed: unknown;
  if (contentType.includes("text/event-stream")) {
    const events = parseSseEvents(text);
    parsed = events.find((e: any) => e && (e.result !== undefined || e.error !== undefined)) ?? events[0];
  } else if (contentType.includes("application/json")) {
    parsed = JSON.parse(text);
  } else {
    // Fall back to SSE parsing — Figma's server uses SSE responses by default.
    const events = parseSseEvents(text);
    parsed = events[0] ?? JSON.parse(text);
  }

  return { response: parsed as JsonRpcResponse, sessionId: newSessionId };
}

async function ensureSession(): Promise<string> {
  if (sessionId) return sessionId;

  const initId = nextId++;
  const init = await postJsonRpc({
    jsonrpc: "2.0",
    id: initId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "design-sync", version: "0.0.0" },
    },
  });

  if (!init.sessionId) {
    throw new Error("MCP server did not return a session id on initialize. Is Figma Dev Mode MCP running at " + ENDPOINT + "?");
  }
  sessionId = init.sessionId;

  await postJsonRpc(
    { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
    { sessionId, isNotification: true },
  );

  return sessionId;
}

export async function callTool(name: string, args: Record<string, unknown>): Promise<{
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
}> {
  const sid = await ensureSession();
  const id = nextId++;
  const { response } = await postJsonRpc(
    {
      jsonrpc: "2.0",
      id,
      method: "tools/call",
      params: { name, arguments: args },
    },
    { sessionId: sid },
  );

  if (!response) throw new Error(`MCP tool ${name}: empty response`);
  if ("error" in response) {
    throw new Error(`MCP tool ${name} failed: ${response.error.message}`);
  }
  const result = response.result as { content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };
  if (!result?.content) throw new Error(`MCP tool ${name}: malformed response (no content)`);
  return { content: result.content };
}

export async function listTools(): Promise<Array<{ name: string; description?: string }>> {
  const sid = await ensureSession();
  const id = nextId++;
  const { response } = await postJsonRpc(
    { jsonrpc: "2.0", id, method: "tools/list" },
    { sessionId: sid },
  );
  if (!response || "error" in response) {
    throw new Error(`MCP tools/list failed: ${response && "error" in response ? response.error.message : "no response"}`);
  }
  return ((response.result as any)?.tools ?? []) as Array<{ name: string; description?: string }>;
}
