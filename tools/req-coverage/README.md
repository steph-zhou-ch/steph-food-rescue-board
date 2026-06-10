# `tools/req-coverage/`

REQ catalog → tagged-test coverage validator. Asserts that every
acceptance criterion at or above the gated severity level (default:
`critical`, `high`) has at least one
`describe('@req <REQ-ID> @criterion <criterion-id>', …)`-tagged vitest
test under `apps/`, `libs/`, or `contracts/`.

Referenced from
[`requirements/README.md`](../../requirements/README.md) ("How to use
these" step 4) and
[`docs/typescript-swarm-playbook.md` §"TDD discipline"](../../docs/typescript-swarm-playbook.md#tdd-discipline)
(the `@req`/`@criterion` tag pattern that `req-coverage` looks for).

## What it checks

| Finding rule | Level | Meaning |
|---|---|---|
| `coverage-missing` | error | A gated-severity criterion has no `@req <REQ-ID> @criterion <criterion-id>`-tagged test |
| `test-drift` | warning | A test tag references a `REQ-ID::criterion-id` that isn't in the catalog (REQ or criterion renamed/removed) |

## CLI

```bash
# Strict mode (default): fails the build if any critical/high criterion is uncovered
pnpm req-coverage

# Advisory mode: prints findings but exits 0
pnpm req-coverage --soft

# Gate only critical
pnpm req-coverage --gate-severity critical

# Custom test roots (default: apps libs contracts)
pnpm req-coverage --test-root apps/app --test-root libs/domain

# Custom catalog
pnpm req-coverage --catalog requirements
```

Exit codes:
- `0` — every gated criterion has at least one tagged test (or `--soft`)
- `1` — one or more gated criteria are uncovered
- `2` — bad invocation

## When to run it

| Phase | Why |
|---|---|
| Phase 1 — Catalog authoring | After every 3-5 REQs to surface coverage drift early (per `requirements/README.md`). At this phase coverage is expected to be 0% — useful to confirm the catalog parses and to baseline the criterion count. |
| Phase 4 — Wave planning | The wave plan claims a track delivers REQ-X — `req-coverage` after the wave verifies that claim. |
| Phase 6/7 — Manager audits | Run by the spec-adherence audit as part of the per-batch verdict. The `coverage-missing` rule maps to `finding_kind: coverage-completeness` in the audit's YAML output (`orchestration/reviews/<wave>-spec-adherence.md`). |
| Phase 9 — Goal 1 verification | Final coverage check before declaring a milestone done. |

## Tag pattern (recap)

The vitest `describe(…)` block name must contain BOTH tags, separated
by whitespace. The order is fixed:
`@req <REQ-ID>` then `@criterion <criterion-id>`. The regex is:

```
/@req\s+(REQ-[A-Z]+-[A-Z0-9-]+)\s+@criterion\s+([A-Za-z0-9][A-Za-z0-9-]*)/g
```

Example:

```ts
describe('@req REQ-CAP-BOOK-APPOINTMENT @criterion slot-grid-conformance', () => {
  it('rejects bookings against slots that fall outside the program grid', () => {
    // …
  });
});
```

The tags can appear in the description before or after human-readable
prose; the regex matches anywhere in the `describe(…)` string. They
can also appear in `it(…)` descriptions if the team prefers per-test
tagging — req-coverage scans the full file text, not just `describe`
calls.
