// Application layer :: in-memory store + use-case logic for surplus
// items. Pure TypeScript — no framework, no DB, no clock read. The
// caller (the API service) supplies `id` and `now` so this layer is
// deterministic and testable without mocking time.
//
// Backs REQ-CAP-POST-ITEM, REQ-CAP-BROWSE-FEED, REQ-CAP-GET-ITEM,
// REQ-CAP-CLAIM-ITEM, REQ-CAP-REMOVE-LISTING. Status transitions are
// delegated to the domain state machine (REQ-INV-ITEM-LIFECYCLE).

import {
  createSurplusItem,
  transition,
  type CreateItemAttrs,
  type ItemAction,
  type ItemCategory,
  type SurplusItem,
} from '@app/domain';

/** Thrown by use cases when the addressed item id does not exist. */
export class ItemNotFoundError extends Error {
  readonly reason = 'item-not-found' as const;
  readonly id: string;
  constructor(id: string) {
    super(`Item not found: ${id}`);
    this.name = 'ItemNotFoundError';
    this.id = id;
  }
}

/** Optional filters for the browse feed. */
export interface ListFilters {
  readonly category?: ItemCategory | undefined;
  /** Current instant — used to drop expired items. */
  readonly now: Date;
}

/**
 * In-memory aggregate store. A single instance is shared across
 * requests (registered as a NestJS singleton provider in apps/api).
 */
export class ItemStore {
  private readonly items = new Map<string, SurplusItem>();

  /** Create a new item in `available` status and persist it. */
  create(attrs: CreateItemAttrs, id: string, now: Date): SurplusItem {
    const item = createSurplusItem(attrs, id, now);
    this.items.set(item.id, item);
    return item;
  }

  /** Full record by id regardless of status, or null if absent. */
  getById(id: string): SurplusItem | null {
    return this.items.get(id) ?? null;
  }

  /**
   * The browse feed: only `available`, non-expired items, optionally
   * narrowed by category, sorted newest-first (createdAt desc).
   */
  list(filters: ListFilters): SurplusItem[] {
    const nowMs = filters.now.getTime();
    return [...this.items.values()]
      .filter((item) => item.status === 'available')
      .filter(
        (item) => item.expiresAt === null || item.expiresAt.getTime() > nowMs,
      )
      .filter(
        (item) =>
          filters.category === undefined || item.category === filters.category,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Drive a status transition (`claim` | `unclaim` | `confirm_pickup`).
   * Throws {@link ItemNotFoundError} for a missing id and propagates
   * the domain's `TransitionError` for an illegal transition.
   */
  applyAction(
    id: string,
    action: Exclude<ItemAction, 'remove'>,
    claimedBy: string | null,
  ): SurplusItem {
    const current = this.requireItem(id);
    const nextStatus = transition(current.status, action);
    const nextClaimedBy =
      action === 'claim'
        ? claimedBy
        : action === 'unclaim'
          ? null
          : current.claimedBy;
    const updated: SurplusItem = {
      ...current,
      status: nextStatus,
      claimedBy: nextClaimedBy,
    };
    this.items.set(id, updated);
    return updated;
  }

  /**
   * Soft-remove an item (any status → removed). Idempotent: removing
   * an already-removed item succeeds. Throws {@link ItemNotFoundError}
   * for a missing id.
   */
  remove(id: string): SurplusItem {
    const current = this.requireItem(id);
    const nextStatus = transition(current.status, 'remove');
    const updated: SurplusItem = { ...current, status: nextStatus };
    this.items.set(id, updated);
    return updated;
  }

  private requireItem(id: string): SurplusItem {
    const current = this.items.get(id);
    if (current === undefined) {
      throw new ItemNotFoundError(id);
    }
    return current;
  }
}
