#!/usr/bin/env python3
"""
Session transcript analyzer.

Distills the QUALITY of the Captain↔Claude-Code↔swarm-manager interaction from
rendered SESSION-LOG markdown archives (the `tools/session-log/render.py` output).

It is deliberately read-only and heuristic: it surfaces high-signal moments
(corrections, friction, infra incidents, manager comms, audit churn) compactly
enough for a human (or a model) to reason over, without loading 8 MB of
transcript into context.

Usage:
  python3 tools/session-analyzer/analyze.py SESSION-LOG-archive-*.md SESSION-LOG.md
  python3 tools/session-analyzer/analyze.py --section captain  FILE...   # one section
  python3 tools/session-analyzer/analyze.py --max 60 FILE...             # cap rows/section
"""
from __future__ import annotations
import argparse, re, sys
from collections import Counter, defaultdict

TURN_RE = re.compile(r'^## Turn (\d+) — (\w+)(?:.*?·\s*(\d\d:\d\d:\d\d))?')
TOOLCALL_RE = re.compile(r'tool call:\**\s*`([^`]+)`')

# Captain-side (USER turn) signal lexicons — bounded set, judged by a human after.
SIG = {
    'correction': re.compile(r"\b(no|nope|nah|wrong|don'?t|do not|stop|actually|instead|"
                             r"revert|undo|mistake|incorrect|isn'?t|that'?s not|not what|"
                             r"shouldn'?t|never mind|hold on)\b", re.I),
    'frustration': re.compile(r"(!!!+|\?\?\?+|\bugh\b|come on|seriously|why (did|are|is|would)|"
                              r"again\?|how many times|for the (last|nth) time|NO+\b)"),
    'praise': re.compile(r"\b(great|perfect|nice|good (job|work|stuff)|love it|exactly|"
                         r"awesome|well done|beautiful|excellent)\b", re.I),
    'directive_new': re.compile(r"\b(let'?s|i want|build|create|add|write|fix|implement|"
                                r"set up|design)\b", re.I),
}
# Infra / process incidents — applied to ALL turns, bucketed.
INCIDENTS = {
    'auth-401/403': re.compile(r"\b(401|403)\b|auth resolution failed|unauthor", re.I),
    'rate-limit': re.compile(r"rate.?limit|\b429\b|overloaded", re.I),
    'broker/5xx': re.compile(r"\b50[023]\b|broker.*(fail|error|closed)|control channel", re.I),
    'stall/watchdog': re.compile(r"stall|watchdog|nudge|heartbeat|no main advance|idle", re.I),
    'trust-dialog': re.compile(r"trust dialog|trust this workspace|--raw.*\\r|carriage return", re.I),
    'hub-size-drop': re.compile(r"size-drop|message.?size|on-disk prompt|prompt.?read|oversized", re.I),
    'base-divergence': re.compile(r"base-diverg|diverg|rebase|ancestry", re.I),
    'codex-trouble': re.compile(r"codex.{0,30}(fail|reject|won'?t|auth|fallback|drift)|gpt-5\.[45]", re.I),
    'token-leak': re.compile(r"GITHUB_TOKEN|token leak|secret.*leak|redact", re.I),
    'manager-restart': re.compile(r"restart manager|fresh container|scion start manager|resume.*manager", re.I),
    'crash/recovery': re.compile(r"crash|reboot|podman machine|cold-start|host-crash", re.I),
    'escalation': re.compile(r"escalat", re.I),
    'gate-fail': re.compile(r"gate.{0,15}(fail|red|broke)|typecheck fail|test.*fail", re.I),
}
MGR_CMD = re.compile(r"scion (message|message --raw|start|stop|look|logs|dispatch|create|delete) ([a-z0-9\-]*manager|manager)", re.I)
MGR_MSG = re.compile(r"scion message (?:--raw )?manager\b", re.I)
CYCLE_RE = re.compile(r"cycle-([1-9])\b", re.I)
VERDICT_RE = re.compile(r"\b(approve[d]?|reject(?:ed)?)\b", re.I)
LESSON_RE = re.compile(r"recipe-lesson", re.I)
# user-role turns that are NOT the human typing (tool results, injected notices).
NONHUMAN = re.compile(r"📥 tool result|tool result:|<task-notification|<system-reminder|"
                      r"Caveat: The messages below|local-command-stdout|<command-name|"
                      r"\[SYSTEM NOTIFICATION", re.I)


def clean(s: str, n: int = 170) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"[`*>#]", "", s)
    return (s[:n] + "…") if len(s) > n else s


class Turn:
    __slots__ = ("n", "role", "ts", "body", "file")
    def __init__(self, n, role, ts, file):
        self.n, self.role, self.ts, self.file = n, role, ts, file
        self.body: list[str] = []
    def text(self): return "\n".join(self.body)


def parse(files):
    turns = []
    for f in files:
        cur = None
        try:
            fh = open(f, encoding="utf-8", errors="replace")
        except OSError as e:
            print(f"  !! cannot open {f}: {e}", file=sys.stderr); continue
        with fh:
            for line in fh:
                m = TURN_RE.match(line)
                if m:
                    if cur: turns.append(cur)
                    cur = Turn(int(m.group(1)), m.group(2), m.group(3) or "", f.split("/")[-1])
                elif cur is not None:
                    cur.body.append(line.rstrip("\n"))
            if cur: turns.append(cur)
    return turns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--section", default="all",
                    choices=["all", "metrics", "captain", "manager", "incidents", "timeline"])
    ap.add_argument("--max", type=int, default=80, help="cap rows per digest section")
    args = ap.parse_args()

    turns = parse(args.files)
    if not turns:
        print("no turns parsed", file=sys.stderr); return 2

    roles = Counter(t.role.lower() for t in turns)
    toolcalls = Counter()
    captain_turns, manager_comms, incidents = [], [], []
    inc_counts = Counter()
    cycles = Counter()
    verdicts = Counter()
    lessons = 0
    sig_counts = Counter()

    for t in turns:
        body = t.text()
        for tc in TOOLCALL_RE.findall(body):
            toolcalls[tc.split()[0]] += 1
        # Captain (human) turns — exclude tool-results / injected notifications,
        # which also carry role=user in the transcript. We want Ashok's words.
        if t.role.lower() == "user" and not NONHUMAN.search(body):
            tags = [k for k, rx in SIG.items() if rx.search(body)]
            for k in tags: sig_counts[k] += 1
            captain_turns.append((t.n, t.ts, t.file, tags, clean(body)))
        # manager comms (any turn issuing a manager scion verb)
        if MGR_CMD.search(body):
            verb = "MSG" if MGR_MSG.search(body) else "OPS"
            # grab the message payload line if present
            mline = next((clean(l, 220) for l in t.body if MGR_CMD.search(l)), clean(body, 220))
            manager_comms.append((t.n, t.ts, verb, mline))
        # incidents (all turns)
        for label, rx in INCIDENTS.items():
            if rx.search(body):
                inc_counts[label] += 1
                incidents.append((t.n, t.ts, t.role[:4], label, clean(body, 150)))
        cycles.update(int(x) for x in CYCLE_RE.findall(body))
        verdicts.update(v.lower().rstrip("ed").rstrip("d") for v in VERDICT_RE.findall(body))
        lessons += len(LESSON_RE.findall(body))

    S = args.section
    def show(name): return S in ("all", name)

    if show("metrics"):
        print("=" * 72); print("METRICS"); print("=" * 72)
        print(f"files analyzed     : {', '.join(sorted(set(t.file for t in turns)))}")
        print(f"total turns        : {len(turns)}  (user={roles.get('user',0)}, assistant={roles.get('assistant',0)})")
        print(f"tool calls (total) : {sum(toolcalls.values())}")
        print(f"  top tools        : {', '.join(f'{k}×{v}' for k,v in toolcalls.most_common(10))}")
        print(f"captain-turn tags  : {', '.join(f'{k}×{v}' for k,v in sig_counts.most_common())}")
        print(f"manager comms      : {len(manager_comms)}  (msgs={sum(1 for c in manager_comms if c[2]=='MSG')}, ops={sum(1 for c in manager_comms if c[2]=='OPS')})")
        print(f"audit cycles seen  : {dict(sorted(cycles.items()))}  (mentions, not distinct)")
        print(f"verdict mentions   : approve×{verdicts.get('approv',0)+verdicts.get('approve',0)}  reject×{verdicts.get('reject',0)}")
        print(f"recipe-lesson hits : {lessons}")
        print(f"INCIDENT buckets   :")
        for k, v in inc_counts.most_common():
            print(f"    {k:<18} {v}")
        print()

    if show("captain"):
        print("=" * 72); print(f"CAPTAIN (human) TURNS — full sequence [{len(captain_turns)}]"); print("=" * 72)
        for n, ts, f, tags, ex in captain_turns[:args.max]:
            tg = ("[" + ",".join(tags) + "] ") if tags else ""
            print(f"T{n:<5}{ts:>9} {tg}{ex}")
        if len(captain_turns) > args.max:
            print(f"  … +{len(captain_turns)-args.max} more (raise --max)")
        print()

    if show("manager"):
        print("=" * 72); print(f"CAPTAIN→MANAGER comms [{len(manager_comms)}]"); print("=" * 72)
        for n, ts, verb, ex in manager_comms[:args.max]:
            print(f"T{n:<5}{ts:>9} {verb} {ex}")
        if len(manager_comms) > args.max:
            print(f"  … +{len(manager_comms)-args.max} more")
        print()

    if show("incidents"):
        print("=" * 72); print(f"INCIDENTS (sampled, capped) [{len(incidents)} total]"); print("=" * 72)
        per = defaultdict(list)
        for row in incidents: per[row[3]].append(row)
        for label, rows in sorted(per.items(), key=lambda kv: -len(kv[1])):
            print(f"\n--- {label} ({len(rows)}) ---")
            for n, ts, role, _, ex in rows[: max(3, args.max // len(per))]:
                print(f"  T{n:<5}{ts:>9} {role} {ex}")
        print()

    if show("timeline"):
        print("=" * 72); print("TIMELINE — large gaps (≥10 min between consecutive timestamped turns)"); print("=" * 72)
        prev = None
        def to_s(ts):
            try:
                h, m, s = map(int, ts.split(":")); return h*3600 + m*60 + s
            except Exception: return None
        for t in turns:
            if not t.ts: continue
            cur = to_s(t.ts)
            if prev and cur is not None:
                d = cur - prev[1]
                if d >= 600 or d < -3600:  # gap or day-rollover
                    tag = "ROLLOVER" if d < -3600 else f"{d//60}m gap"
                    print(f"  T{prev[0]}→T{t.n}  {prev[2]}→{t.ts}  {tag}")
            if cur is not None: prev = (t.n, cur, t.ts)
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
