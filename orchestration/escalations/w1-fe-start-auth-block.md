# ESCALATION — Wave 1 FE workers cannot start (Hub/broker auth)

**When:** 2026-06-10T21:5x (manager, post-restart)
**Severity:** BLOCKING — all 3 batch-2 FE tracks cannot launch.

## Symptom
`scion start` fails for all three FE workers with TWO distinct errors,
split by agent owner:

| Track | Owner | Error |
|---|---|---|
| w1-fe-browse-feed | Captain (06b3ce00) | broker 500: `claude: auth type "api-key" selected but no API key found; set ANTHROPIC_API_KEY` |
| w1-fe-item-detail | manager (be67fbc9) | `env-gather failed: required env [GEMINI_API_KEY]` MISSING |
| w1-fe-post-form  | manager (be67fbc9) | `env-gather failed: required env [GEMINI_API_KEY]` MISSING |

## Root cause (confirmed)
1. The GEMINI_API_KEY placeholder fix is registered under the CAPTAIN's
   user scope (owner 06b3ce00) WITHOUT `--allow-progeny`. Manager-owned
   agents (be67fbc9) — item-detail, post-form — cannot read it.
2. Captain-owned browse-feed clears GEMINI but the broker cannot resolve
   ANTHROPIC_API_KEY for the claude harness (separate auth-resolution
   failure at the runtime broker).
3. Manager cannot self-remediate: `scion hub secret set/list` returns
   401 (manager lacks secret-write permission on the Hub).

## Also discovered
- `scion resume` verb does NOT exist on this build (use `start`).
- w1-fe-post-form AGENT RECORD is gone (404, `restore` 404) but its
  branch `origin/swarm/w1-fe-post-form` exists with **2 commits** ahead
  of main (config + 1 failing test) — NOT 4 as the brief stated. The
  agent must be recreated on its existing branch once auth is fixed.

## Ask of Captain
- Re-register GEMINI_API_KEY placeholder with `--allow-progeny`, OR set
  it under the manager's user scope (be67fbc9), so manager-owned agents
  resolve it.
- Fix broker ANTHROPIC_API_KEY resolution for claude-harness FE agents.
- Then manager will: recreate w1-fe-post-form on its existing branch,
  start all 3, dismiss welcome, dispatch pointers, resume poll loop.
