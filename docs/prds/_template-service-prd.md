---
status: draft | approved | superseded
owners:
  product: "@TODO-pm"
  technical: "@TODO-tech-lead"
  clinical: "@TODO-clinical-owner"     # if a clinical actor is in scope
  operations: "@TODO-ops-owner"        # if an operational actor is in scope
last_updated: TODO-YYYY-MM-DD
supersedes: (none)
---

# Service PRD — `<service-name>`

> The service-level Product Requirements Doc. Compiles vision +
> headline REQs + sequencing into a single PM-readable narrative.
> Read alongside [`requirements/`](../../requirements/) for the
> testable contracts and [`50-agents/wave-plan.md`](../design/50-agents/)
> for the delivery sequence.

## 1. Why this service

> 2-4 paragraphs synthesizing [`00-overview/vision.md`](../design/00-overview/).
> What's broken today, who hurts, why now.

## 2. Audience + actors

| Actor | Today's experience | What this service gives them |
|---|---|---|
| Patient |  |  |
| Clinician |  |  |
| Scheduling coordinator |  |  |
| Clinical supervisor |  |  |
| Operational PM |  |  |
| System cascades |  |  |

## 3. Headline capabilities

| Capability | REQ | Wave | One-line description |
|---|---|---|---|
| Book appointment | [`REQ-CAP-BOOK-APPOINTMENT`](../../requirements/REQ-CAP-BOOK-APPOINTMENT.md) | 1 | Book a session against a real slot with insurance + clinician matched |
| Cancel appointment | [`REQ-CAP-CANCEL-APPOINTMENT`](../../requirements/REQ-CAP-CANCEL-APPOINTMENT.md) | 2 | Cancel with timeliness evaluation; emits AppointmentCancelled |
| Reschedule appointment | [`REQ-CAP-RESCHEDULE-APPOINTMENT`](../../requirements/REQ-CAP-RESCHEDULE-APPOINTMENT.md) | 2 | Move to new slot with per-actor authority rules |

(extend to cover all headline capabilities; per-capability deep dives
go in this directory as `prd-<capability>.md`)

## 4. Cross-cutting invariants

The service honors a set of cross-cutting invariants that every
capability respects. Stakeholders care about three of these as
PM-visible commitments:

- **[`REQ-INV-TENANT-ISOLATION`](../../requirements/REQ-INV-TENANT-ISOLATION.md)** — no cross-tenant read or write succeeds; cross-tenant access surfaces as NotFoundError, never an existence leak.
- **[`REQ-INV-TIMEZONE-DST`](../../requirements/REQ-INV-TIMEZONE-DST.md)** — patients in Arizona / Mountain Time / non-DST states see appointment times in their actual local time, not a DST-shifted approximation.
- **[`REQ-INV-AUDIT-TRAIL`](../../requirements/REQ-INV-AUDIT-TRAIL.md)** — every appointment-state transition leaves a structured-log + status_history record reconstructible per-tenant.

The complete invariant set (16 invariants, all critical/high) lives
in [`requirements/REQ-INV-*`](../../requirements/) and is enforced by the
spec-adherence + code-review-codex audit cycles.

## 5. Integrations

This service has both sides of contracts with external systems:

| System | Direction | REQ | What we send | What we receive |
|---|---|---|---|---|
| Zoom | both | [`REQ-INT-ZOOM`](../../requirements/REQ-INT-ZOOM.md) | Meeting create/update on book/reschedule | meeting metadata, recording links |
| Iterable | outbound | [`REQ-INT-ITERABLE`](../../requirements/REQ-INT-ITERABLE.md) | Notification events | n/a |
| Salesforce/MyDot | both | [`REQ-INT-SALESFORCE-MYDOT`](../../requirements/REQ-INT-SALESFORCE-MYDOT.md) | Appointment-change events | clinician availability, capacity |
| World Model | both | [`REQ-INT-WORLD-MODEL`](../../requirements/REQ-INT-WORLD-MODEL.md) | Domain events | derived signals |
| Migration Bridge | both | [`REQ-INT-MIGRATION-BRIDGE`](../../requirements/REQ-INT-MIGRATION-BRIDGE.md) | V3 events → V2 | V2 events → V3 (during cutover) |
| Elation | (decommissioned Wave 10) | [`REQ-INT-ELATION`](../../requirements/REQ-INT-ELATION.md) | n/a after Wave 10 | n/a |

## 6. Success metrics

| Horizon | Metric | Baseline | Target |
|---|---|---|---|
|  |  |  |  |

## 7. Delivery sequence

Summarized from [`50-agents/wave-plan.md`](../design/50-agents/):

| Wave | Theme | REQ subset |
|---|---|---|
| 0 |  |  |
| 1 |  |  |
| 2 |  |  |

## 8. Rollout shape

Summarized from [`60-rollout/migration-plan.md`](../design/60-rollout/) +
[`60-rollout/comms-plan.md`](../design/60-rollout/):

- Strangler-fig pattern alongside the V2 service via
  [`REQ-INT-MIGRATION-BRIDGE`](../../requirements/REQ-INT-MIGRATION-BRIDGE.md).
- Per-tenant feature flag cutover; default-off → opt-in → default-on.
- Kill-switch retained until N waves post-cutover.

## 9. Non-goals

- TODO
- TODO

## 10. Open questions for stakeholders

- TODO (owner: `@TODO`; resolve by: `<date>`)

## 11. Sign-off (stop-and-think gate per USER-GUIDE.md §Phase 1.4)

| Role | Name | Date |
|---|---|---|
| PM owner |  |  |
| Tech Lead |  |  |
| Clinical owner |  |  |
| Operations owner |  |  |

**Until all signatures land, the wave plan cannot be finalized and
Phase 2 (catalog readiness) cannot commit.**
