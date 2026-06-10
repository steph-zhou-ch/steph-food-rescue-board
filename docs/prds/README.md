# `prds/`

The service-level PRD plus any per-capability deep dives the PM
chooses to surface as standalone docs. PRDs compile vision +
glossary + selected REQs into a single PM-readable narrative — the
artifact stakeholders and partner teams read end-to-end.

| File | Owner | What it covers |
|---|---|---|
| [`service-prd.md`](./service-prd.md) | PM | Service-level PRD: what this service is, why, who uses it, the headline capabilities, success metrics, dependencies, rollout shape. ~5-15 pages |
| `prd-<capability>.md` (per as needed) | PM | Per-capability deep dives. Most capabilities don't need one — the REQ Product Contract is enough. PRDs exist when a capability needs more context (a clinical rationale, a regulator-facing story, a partner-team migration story) |

Copy [`_template-service-prd.md`](./_template-service-prd.md) to
start `service-prd.md`.

## Authorship lifecycle

| Phase | Actor | Action |
|---|---|---|
| Phase 1.4 (Captain) | PM | First draft of `service-prd.md` — anchors on `00-overview/vision.md` + `assumptions.md` + the headline-REQ subset |
| Phase 2 (catalog readiness) | PM | Re-read against the audit's verdict — if the catalog has shifted, the PRD must shift too |
| Per-wave (PM) | PM | Append a "Wave N delivered" section when each wave closes; keep narrative current |
| Pre-cutover (PM) | PM | Add the migration story; partner teams read this section |

## Relationship to REQs

- The PRD does **not duplicate** REQs — it summarizes + sequences them.
- Each PRD section cites the relevant REQ(s) by id. Detail lives in
  the REQ; PRD provides the narrative thread.
- If you find yourself copying REQ contents into the PRD, restructure —
  either the REQ is too narrow, or the PRD is too detailed.

## Sign-off

The PRD is the artifact stakeholders sign off on. The signoff table at
the bottom of `service-prd.md` is the **stop-and-think gate** for
Phase 2 (USER-GUIDE.md §Phase 1.4). Until the four roles
(PM + Tech Lead + Clinical owner if applicable + Operations owner if
applicable) sign, the wave plan can't be finalized.
