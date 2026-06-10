#!/usr/bin/env python3
"""
Render the active Claude Code session transcript to SESSION-LOG.md.

Reads the JSONL session file that Claude Code maintains under
~/.claude/projects/<project-slug>/<session-id>.jsonl and emits a
human-readable markdown rendering at <project-root>/SESSION-LOG.md.

Designed to be invoked from a Claude Code Stop hook so SESSION-LOG.md
stays current after every assistant turn. Also runnable standalone.

Crash/multi-session safety: each rendered SESSION-LOG.md carries an embedded
`<!-- session-id: ... -->` marker. When this script runs and finds that the
existing SESSION-LOG.md belongs to a DIFFERENT session (e.g. you started a
fresh session after a crash/reboot), it first archives the prior session's
render — SESSION-LOG.md plus its SESSION-LOG-NNN.md rotations — into a single
`SESSION-LOG-archive-<prior-session-id>.md` before overwriting. No session's
transcript render is ever clobbered by the next session.

Usage:
  python3 tools/session-log/render.py                 # render most-recent session
  python3 tools/session-log/render.py --session <id>  # render a specific session
  python3 tools/session-log/render.py --out <path>    # custom output path
"""

from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import re
import sys
from pathlib import Path

# Resolve project root from the script's location (tools/session-log/render.py → ../../)
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_OUT = PROJECT_ROOT / "SESSION-LOG.md"

# Claude Code stores per-project sessions under ~/.claude/projects/<slug>/<session-id>.jsonl
# The slug is the absolute project path with `/` AND `.` both replaced by `-`.
def project_slug(project_root: Path) -> str:
    abs_path = str(project_root.resolve())
    return "-" + abs_path[1:].replace("/", "-").replace(".", "-")

def find_session_files(project_root: Path) -> list[Path]:
    slug = project_slug(project_root)
    sessions_dir = Path.home() / ".claude" / "projects" / slug
    if not sessions_dir.is_dir():
        return []
    return sorted(sessions_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)

# ── content extraction ──────────────────────────────────────────────

def text_of_message(msg: dict) -> str:
    """Extract the text body of a Claude API message (assistant or user)."""
    content = msg.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for c in content:
            if not isinstance(c, dict):
                continue
            t = c.get("type")
            if t == "text":
                parts.append(c.get("text", ""))
            elif t == "tool_use":
                name = c.get("name", "?")
                inp = c.get("input", {})
                parts.append(format_tool_use(name, inp))
            elif t == "tool_result":
                tu_id = c.get("tool_use_id", "?")
                result = c.get("content")
                parts.append(format_tool_result(tu_id, result))
        return "\n\n".join(p for p in parts if p)
    return ""

def format_tool_use(name: str, inp: dict) -> str:
    """Render a tool call as a fenced block."""
    pretty = json.dumps(inp, indent=2, default=str)
    if len(pretty) > 4000:
        pretty = pretty[:4000] + f"\n... [truncated; original {len(pretty)} chars]"
    return f"**🔧 tool call:** `{name}`\n\n```json\n{pretty}\n```"

def format_tool_result(tool_use_id: str, result) -> str:
    """Render a tool result, truncating large outputs."""
    if isinstance(result, list):
        chunks = []
        for c in result:
            if isinstance(c, dict) and c.get("type") == "text":
                chunks.append(c.get("text", ""))
            else:
                chunks.append(json.dumps(c, default=str))
        body = "\n".join(chunks)
    elif isinstance(result, str):
        body = result
    else:
        body = json.dumps(result, default=str)
    if len(body) > 6000:
        body = body[:6000] + f"\n\n... [truncated; original {len(body)} chars]"
    return f"**📥 tool result:**\n\n```\n{body}\n```"

# ── multi-session archive guard ─────────────────────────────────────

# Embedded in every rendered SESSION-LOG.md so a later run can tell which
# session produced the file on disk. Invisible in rendered markdown.
MARKER_RE = re.compile(r"<!--\s*session-id:\s*([^\s>]+)\s*-->")
_SEG_RE = re.compile(r"^SESSION-LOG-(\d{3,})\.md$")

def session_marker_of(path: Path) -> str | None:
    """Return the session id embedded in an existing SESSION-LOG.md, or None."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            head = f.read(4096)
    except OSError:
        return None
    m = MARKER_RE.search(head)
    return m.group(1) if m else None

def archive_prior_session(repo_root: Path, prior_id: str) -> Path | None:
    """
    Combine the prior session's render (SESSION-LOG-NNN.md rotations in order,
    then the live SESSION-LOG.md) into one SESSION-LOG-archive-<prior_id>.md,
    then remove the originals so the next render starts clean. Returns the
    archive path, or None if there was nothing to archive.
    """
    seg_files = sorted((p for p in repo_root.iterdir() if _SEG_RE.match(p.name)),
                       key=lambda p: p.name)
    live = repo_root / "SESSION-LOG.md"
    parts = [p.read_text(encoding="utf-8") for p in seg_files]
    if live.exists():
        parts.append(live.read_text(encoding="utf-8"))
    if not parts:
        return None
    archive = repo_root / f"SESSION-LOG-archive-{prior_id}.md"
    archive.write_text("\n\n<!-- segment break -->\n\n".join(parts), encoding="utf-8")
    for p in seg_files:
        try:
            p.unlink()
        except OSError:
            pass
    try:
        if live.exists():
            live.unlink()
    except OSError:
        pass
    return archive

# ── rendering ──────────────────────────────────────────────────────

# Approx 1 MB per segment (slightly under to keep some headroom for headers/footers).
# Override via --max-bytes for testing or to suit different storage policies.
SEGMENT_MAX_BYTES = 1_000_000

def _turn_blocks(entries: list[dict]) -> list[tuple[int, str, str]]:
    """Extract (turn_number, role, body) for renderable entries (user/assistant only)."""
    blocks: list[tuple[int, str, str]] = []
    turn = 0
    for e in entries:
        kind = e.get("type")
        if kind not in {"user", "assistant"}:
            continue
        msg = e.get("message") or {}
        role = msg.get("role") or kind
        body = text_of_message(msg)
        if not body.strip():
            continue
        ts = e.get("timestamp") or msg.get("timestamp") or ""
        ts_str = ""
        if ts:
            try:
                norm = ts.replace("Z", "+00:00")
                ts_str = " · " + dt.datetime.fromisoformat(norm).strftime("%H:%M:%S")
            except Exception:
                pass
        turn += 1
        block = f"## Turn {turn} — {role.title()}{ts_str}\n\n{body.rstrip()}\n\n---\n"
        blocks.append((turn, role, block))
    return blocks

def _segment_header(seg_idx: int, seg_total: int, turn_start: int, turn_end: int, is_live: bool, session_id: str = "") -> str:
    nav_prev = f"`SESSION-LOG-{seg_idx - 1:03d}.md`" if seg_idx > 1 else "_(none)_"
    if seg_idx == seg_total:
        nav_next = "_(none — this is the latest segment)_"
    elif seg_idx + 1 == seg_total:
        nav_next = "`SESSION-LOG.md` _(latest)_"
    else:
        nav_next = f"`SESSION-LOG-{seg_idx + 1:03d}.md`"
    title = "live transcript" if is_live else f"transcript segment {seg_idx} of {seg_total}"
    lines = [
        f"<!-- session-id: {session_id} -->",
        f"# Session log — {title}",
        "",
        f"> Auto-rendered by `tools/session-log/render.py`. Segment **{seg_idx} of {seg_total}** · turns **{turn_start}–{turn_end}** ·",
        f"> refreshed at {dt.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')}.",
        f"> Previous: {nav_prev} · Next: {nav_next}",
        "> Companion: `AUDIT-LOG.md` — structured audit of discoveries this session.",
        "",
        "---",
        "",
    ]
    return "\n".join(lines)

def render_segments(entries: list[dict], session_id: str = "", max_bytes: int = SEGMENT_MAX_BYTES) -> list[tuple[str, str, int, int]]:
    """
    Return a list of (filename, content, turn_start, turn_end).
    The last entry is always SESSION-LOG.md (live segment). Earlier segments
    are SESSION-LOG-001.md, SESSION-LOG-002.md, … in order.
    """
    blocks = _turn_blocks(entries)
    total_turns = len(blocks)
    if total_turns == 0:
        # Empty transcript: emit a stub SESSION-LOG.md.
        return [("SESSION-LOG.md", _segment_header(1, 1, 0, 0, True, session_id) + "_No renderable turns yet._\n", 0, 0)]

    # First pass: bucket turn-blocks into segments by byte size (rough — the
    # header is added later, so we under-budget the body by ~600 bytes).
    body_budget = max_bytes - 1024
    segments: list[list[tuple[int, str, str]]] = [[]]
    cur_size = 0
    for tno, role, block in blocks:
        block_size = len(block.encode("utf-8"))
        if cur_size + block_size > body_budget and segments[-1]:
            segments.append([])
            cur_size = 0
        segments[-1].append((tno, role, block))
        cur_size += block_size

    n = len(segments)
    results: list[tuple[str, str, int, int]] = []
    for idx, seg in enumerate(segments, start=1):
        turn_start = seg[0][0]
        turn_end = seg[-1][0]
        is_live = (idx == n)
        filename = "SESSION-LOG.md" if is_live else f"SESSION-LOG-{idx:03d}.md"
        header = _segment_header(idx, n, turn_start, turn_end, is_live, session_id)
        body = "".join(block for _, _, block in seg)
        footer = f"\n_Segment {idx} of {n} · turns {turn_start}–{turn_end} · " \
                 f"{'live' if is_live else 'archived'}._\n"
        results.append((filename, header + body + footer, turn_start, turn_end))
    return results

# ── main ───────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", help="Session UUID to render (default: most-recently-modified)")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help=f"Output markdown path (default: {DEFAULT_OUT})")
    ap.add_argument("--project-root", default=str(PROJECT_ROOT), help="Project root (default: inferred from script)")
    ap.add_argument("--max-bytes", type=int, default=SEGMENT_MAX_BYTES,
                    help=f"Approx max bytes per segment (default: {SEGMENT_MAX_BYTES:,}). "
                         "Smaller values force more rotation; useful for testing.")
    args = ap.parse_args()

    project_root = Path(args.project_root).resolve()
    sessions = find_session_files(project_root)
    if not sessions:
        print(f"[render.py] no session jsonl found under ~/.claude/projects/{project_slug(project_root)}/", file=sys.stderr)
        return 2

    if args.session:
        target = next((s for s in sessions if args.session in s.name), None)
        if target is None:
            print(f"[render.py] no session matching '{args.session}' (candidates: {[s.name for s in sessions]})", file=sys.stderr)
            return 2
    else:
        target = sessions[0]

    # The JSONL filename stem IS the Claude Code session id.
    session_id = target.stem

    # Read entries
    entries: list[dict] = []
    with open(target, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    segments = render_segments(entries, session_id=session_id, max_bytes=args.max_bytes)
    out_path = Path(args.out)
    out_dir = out_path.parent if out_path.name == "SESSION-LOG.md" else out_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    # If --out was passed with a custom name (anything other than SESSION-LOG.md),
    # collapse all segments into one file at that path (debugging / one-shot mode).
    if out_path.name != "SESSION-LOG.md":
        combined = "\n\n<!-- segment break -->\n\n".join(content for _, content, _, _ in segments)
        out_path.write_text(combined, encoding="utf-8")
        print(f"[render.py] rendered {len(entries)} entries → {out_path} (single-file mode; {len(combined)} chars across {len(segments)} segments)")
        return 0

    # Default mode: split across SESSION-LOG-NNN.md + SESSION-LOG.md (latest).
    # First, remove any stale SESSION-LOG-NNN.md files that exceed the current
    # segment count (they'd be left over from a longer prior render).
    repo_root = out_path.parent

    # Multi-session archive guard: if the SESSION-LOG.md on disk was rendered
    # from a DIFFERENT session (crash/reboot → fresh session), preserve it and
    # its rotations before this render overwrites them. A first render with no
    # marker yet is treated as same-session to avoid spurious archives.
    prior_id = session_marker_of(repo_root / "SESSION-LOG.md")
    if prior_id and prior_id != session_id:
        archived = archive_prior_session(repo_root, prior_id)
        if archived:
            print(f"[render.py] session change ({prior_id[:8]}… → {session_id[:8]}…); "
                  f"archived prior render → {archived.name}", file=sys.stderr)

    stale_pattern = re.compile(r"^SESSION-LOG-(\d{3,})\.md$")
    max_idx = len(segments) - 1  # number of archived segments
    for existing in repo_root.iterdir():
        m = stale_pattern.match(existing.name)
        if m and int(m.group(1)) > max_idx:
            try:
                existing.unlink()
            except Exception:
                pass

    written_total_bytes = 0
    for filename, content, _, _ in segments:
        seg_path = repo_root / filename
        seg_path.write_text(content, encoding="utf-8")
        written_total_bytes += len(content.encode("utf-8"))

    last_filename, _, last_start, last_end = segments[-1]
    print(f"[render.py] rendered {len(entries)} entries from {target.name} → {len(segments)} segment(s), "
          f"{written_total_bytes:,} bytes total; live: {last_filename} (turns {last_start}–{last_end})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
