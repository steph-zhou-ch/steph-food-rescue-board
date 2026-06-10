# Spec-adherence verdict — `w1-audit-api`

> Auditor: `spec-adherence-agent` (Claude harness)
> Audited track: `w1-api-items` @ `origin/swarm/w1-api-items` HEAD `76ccf82` `[complete:w1-api-items]`
> Wave / batch: w1 / batch 3 · cycle 1
> Verdict: **APPROVED**

---

## Section 1 — narrative summary

**Totals:** 19 criteria in scope across 6 REQs. **19 PASS, 0 FAIL, 0 PARTIAL.**
0 predicate-drift, 0 missing-coverage, 0 sham-assertions, 0 wave-level
structural gaps. Every `severity: critical` and `severity: high`
criterion has at least one correctly-tagged `@req … @criterion …`
vitest test, and each test asserts the REQ's YAML predicate (including
its `negative_cases`) rather than a weaker or unrelated proxy.

**Layering is correct and the predicates are honored where they
actually live, not just where the test happens to look:**

- **Pure state machine (`libs/domain/src/item-status.ts`).** The legal
  transition table is the single source of truth for
  `REQ-INV-ITEM-LIFECYCLE`. `lifecycle-01` is verified exhaustively:
  the test iterates every `(status × action)` pair and confirms only
  the four legal edges succeed (`available→claimed`,
  `claimed→picked_up`, `claimed→available`, `any→removed`) while every
  other pair throws `TransitionError`. The three named negative cases
  (`available→picked_up`, `picked_up→claimed`, `removed→available`)
  are each individually asserted. `lifecycle-02` pins the closed
  four-value enum, asserts new items are always `available`, and uses
  a type-level `expectTypeOf` to guarantee the entity `status` field is
  the closed union — so a null/empty/unknown status is unrepresentable,
  which is exactly the predicate's intent.

- **Impl-honors-predicate beyond the test surface.** The illegal
  transition is rejected in the pure domain (`transition()` throws),
  and the service maps `TransitionError → 409` and
  `ItemNotFoundError → 404` centrally in `mapError`. This means the 409
  guarantees (`claim` on claimed, `confirm_pickup` on
  available/picked_up, `unclaim` on available) hold for **all**
  status-mutating endpoints, not only the paths the integration tests
  drive — the predicate's full intent is implemented, not just the
  sampled cases.

- **Soft-delete is genuinely soft.** `remove-01`'s negative case
  ("must NOT physically delete the record") is asserted by GETting the
  item *after* DELETE and confirming `status: 'removed'` is still
  retrievable. The store mutates status via the same transition table
  (`any → removed`) rather than dropping the map entry — predicate
  honored at the impl level. `remove-04` idempotency is real:
  `removed → removed` is an explicit legal edge, so double-DELETE
  returns 200 both times rather than 409.

- **Feed filtering composes all three rules.** `ItemStore.list`
  filters `status === 'available'`, drops expired
  (`expiresAt > now`), applies the optional category narrow, and sorts
  `createdAt` descending. `browse-01` (integration) confirms claimed
  and removed items are absent and every returned item is `available`;
  `browse-02`/`browse-04` (unit) pin expiry and sort determinism using
  caller-supplied `now`/`id` (no wall-clock mocking); `browse-03`
  confirms an invalid `category` returns **400** (via the zod enum),
  satisfying the "must NOT return empty results" negative case rather
  than silently yielding `[]`.

- **Validation is pre-storage and names fields.** `post-02` iterates
  every required field, deletes it, and asserts a 400 whose body
  *contains the field name* (the zod pipe joins `path: message`), and
  explicitly asserts the failure is **not** 500. `post-03` asserts the
  four length ceilings reject with 400 **and** that an exactly-100-char
  title round-trips intact (the "must NOT truncate silently" negative
  case). The server also forces `status: 'available'` on create
  regardless of input, covering `post-01`'s status-injection negative
  case.

**Especially-good pattern adoption.** Clock discipline is exemplary:
the domain and application layers never read the wall clock — `now`
and `id` are caller-supplied, so expiry and sort behavior are tested
deterministically without time mocks. Production wiring binds the
`Clock` port to `SystemClock` in `items.module.ts` with no
placeholder/throwing providers. The integration suite boots the
**real** `AppModule` over the HTTP transport (supertest), so a mutation
wired to the controller but unreachable through the app graph would
fail — this is stronger than a `TestingModule`-with-fakes harness and
closes the "test passes but app is misconfigured" gap.

**No sham assertions found.** I specifically looked for
`toBeDefined()`-style weak assertions, happy-path tests masquerading as
error-condition coverage, and `.skip`/`xit` smuggling — none present.
Negative cases are asserted with concrete status codes and field
checks.

**TDD-hygiene observations (non-blocking).** The history shows clean
`lifecycle` and `post-01` `[test]`→`[impl]` pairs, but the later areas
were committed as batched green commits — e.g.
`[test] browse-01/02/03/04 passing (feed impl from earlier)`,
`[test] claim-01/02/03/04 passing`, `[test] remove-01/02/03/04 passing`
— with the impl authored "from earlier" and four criteria folded into
one commit. `base.md` §3 asks for one criterion per `[test]`/`[impl]`
pair and "Do not combine multiple criteria into a single commit batch."
This is a process-discipline deviation only; it does not affect
predicate fidelity, coverage, or correctness, so it does not gate the
merge. Flagging for the manager's TDD-hygiene ledger.

**Boundary observation (non-blocking, not a finding).** `browse-02`
excludes items via `expiresAt.getTime() > now` — an item whose
`expiresAt` equals `now` to the millisecond is treated as expired
(excluded). The predicate only mandates excluding items with
`expiresAt < now()`, so this stricter boundary does not violate the
predicate; noted for awareness only.

**Out-of-scope tags.** The `@criterion alpha|beta|deleted-criterion`
tags surfaced by a repo-wide grep live in
`tools/req-coverage/src/coverage.spec.ts` and pre-exist on `origin/main`
— they are fixtures for the coverage tool, not part of this track.

---

## Section 2 — machine-actionable findings

```yaml
verdict: approved
reviewer: spec-adherence-agent
model: claude-opus-4-7
audited_track: w1-api-items
audited_ref: 76ccf82
wave: w1
batch: 3
cycle: 1
summary:
  criteria_reviewed: 19
  criteria_passing: 19
  criteria_with_drift: 0
  criteria_missing_coverage: 0
  sham_assertions_flagged: 0
coverage:
  - req_id: REQ-CAP-POST-ITEM
    criteria:
      - { id: post-01-creates-available-item, severity: critical, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: post-02-validates-required-fields, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: post-03-enforces-length-limits, severity: medium, status: PASS, test: apps/api/test/items.spec.ts }
  - req_id: REQ-CAP-BROWSE-FEED
    criteria:
      - { id: browse-01-returns-available-only, severity: critical, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: browse-02-filters-expired, severity: high, status: PASS, test: libs/application/test/item-store.spec.ts }
      - { id: browse-03-category-filter, severity: medium, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: browse-04-newest-first, severity: medium, status: PASS, test: libs/application/test/item-store.spec.ts }
  - req_id: REQ-CAP-GET-ITEM
    criteria:
      - { id: get-item-01-returns-full-record, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: get-item-02-not-found, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
  - req_id: REQ-CAP-CLAIM-ITEM
    criteria:
      - { id: claim-01-available-to-claimed, severity: critical, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: claim-02-claimed-to-picked-up, severity: critical, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: claim-03-unclaim-returns-to-available, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: claim-04-not-found, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
  - req_id: REQ-CAP-REMOVE-LISTING
    criteria:
      - { id: remove-01-marks-removed, severity: critical, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: remove-02-any-status, severity: high, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: remove-03-not-found, severity: medium, status: PASS, test: apps/api/test/items.spec.ts }
      - { id: remove-04-idempotent, severity: medium, status: PASS, test: apps/api/test/items.spec.ts }
  - req_id: REQ-INV-ITEM-LIFECYCLE
    criteria:
      - { id: lifecycle-01-no-illegal-transitions, severity: critical, status: PASS, test: libs/domain/test/surplus-item.spec.ts }
      - { id: lifecycle-02-status-never-null, severity: critical, status: PASS, test: libs/domain/test/surplus-item.spec.ts }
findings: []
non_blocking_observations:
  - kind: tdd-hygiene
    target_track: w1-api-items
    observation: |
      browse-*, claim-*, and remove-* criteria were each committed as a
      single batched green commit (e.g. "[test] claim-01/02/03/04
      passing (PATCH impl from earlier)") with impl authored ahead of
      the test commit. base.md §3 asks for one criterion per
      [test]/[impl] pair and forbids batching multiple criteria into
      one commit. Predicate fidelity, coverage, and correctness are
      unaffected; flagged for the TDD-hygiene ledger only.
  - kind: boundary-note
    target_track: w1-api-items
    req_id: REQ-CAP-BROWSE-FEED
    criterion_id: browse-02-filters-expired
    observation: |
      Expiry filter uses `expiresAt > now`, so an item expiring exactly
      at `now` (millisecond-equal) is excluded. Predicate only requires
      excluding `expiresAt < now`, so this stricter boundary does not
      violate it. Noted for awareness, not a finding.
```
