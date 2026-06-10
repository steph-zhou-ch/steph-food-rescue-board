// REQ-INV-ITEM-LIFECYCLE :: SurplusItem status state machine.
//
// Pure domain logic — no I/O, no framework. The state machine from
// requirements/domains/rescue-board.md#status-state-machine:
//
//   available ──claim──▶ claimed ──confirm_pickup──▶ picked_up
//       │                   │
//       └──remove──▶ removed └──unclaim──▶ available
//
// Plus: any status → removed (poster can always remove), and
// removed → removed is idempotent (DELETE is idempotent per
// REQ-CAP-REMOVE-LISTING#remove-04-idempotent).

/**
 * Closed enum of every legal item status. Ordered to mirror the
 * lifecycle progression. lifecycle-02 asserts status is always one
 * of exactly these values.
 */
export const ITEM_STATUSES = [
  'available',
  'claimed',
  'picked_up',
  'removed',
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * Closed enum of the actions that drive status transitions. `remove`
 * is the action behind DELETE; the other three behind PATCH.
 */
export const ITEM_ACTIONS = [
  'claim',
  'unclaim',
  'confirm_pickup',
  'remove',
] as const;

export type ItemAction = (typeof ITEM_ACTIONS)[number];

/** Closed-enum reason code carried by every transition failure. */
export type TransitionErrorReason = 'illegal-transition';

/**
 * Thrown when an action is not legal from the current status. The
 * application/API layer maps this to HTTP 409 Conflict.
 */
export class TransitionError extends Error {
  readonly reason: TransitionErrorReason = 'illegal-transition';
  readonly from: ItemStatus;
  readonly action: ItemAction;

  constructor(from: ItemStatus, action: ItemAction) {
    super(`Illegal transition: cannot '${action}' an item in '${from}' status`);
    this.name = 'TransitionError';
    this.from = from;
    this.action = action;
  }
}

/**
 * The legal transition table. A `(from, action)` pair maps to the
 * resulting status; any pair absent from the table is illegal and
 * raises TransitionError. `remove` is legal from every status —
 * including `removed` (idempotent).
 */
const TRANSITIONS: Readonly<
  Record<ItemStatus, Partial<Record<ItemAction, ItemStatus>>>
> = {
  available: {
    claim: 'claimed',
    remove: 'removed',
  },
  claimed: {
    confirm_pickup: 'picked_up',
    unclaim: 'available',
    remove: 'removed',
  },
  picked_up: {
    remove: 'removed',
  },
  removed: {
    // Idempotent: removing an already-removed item is a no-op success.
    remove: 'removed',
  },
};

/**
 * Pure transition function. Returns the next status for a legal
 * `(from, action)` pair; throws {@link TransitionError} otherwise.
 * Never returns a value outside {@link ITEM_STATUSES}.
 */
export function transition(from: ItemStatus, action: ItemAction): ItemStatus {
  const next = TRANSITIONS[from][action];
  if (next === undefined) {
    throw new TransitionError(from, action);
  }
  return next;
}

/** Type guard for the closed status enum. */
export function isItemStatus(value: unknown): value is ItemStatus {
  return (
    typeof value === 'string' &&
    (ITEM_STATUSES as readonly string[]).includes(value)
  );
}
