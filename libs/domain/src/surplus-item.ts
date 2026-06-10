// REQ-CAP-POST-ITEM / REQ-INV-ITEM-LIFECYCLE :: SurplusItem entity.
//
// Pure domain entity + factory. No I/O, no framework, no clock read
// (the caller supplies `now` and `id` so the domain stays
// deterministic and `new Date()`/`Date.now()` never appear here).

import type { ItemStatus } from './item-status.js';

/** Closed enum of item categories. */
export const ITEM_CATEGORIES = ['food', 'household', 'other'] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

/** Optional geo coordinates for the map view. */
export interface LatLng {
  readonly lat: number;
  readonly lng: number;
}

/**
 * The SurplusItem aggregate. `status` is always a member of the
 * closed {@link ItemStatus} enum (lifecycle-02). Timestamps are held
 * as UTC `Date` instances; the API layer serializes them to ISO-8601
 * with a `Z` suffix.
 */
export interface SurplusItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly photoUrl: string | null;
  readonly category: ItemCategory;
  readonly pickupLocation: string;
  readonly pickupLatLng: LatLng | null;
  readonly postedBy: string;
  readonly status: ItemStatus;
  readonly claimedBy: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

/**
 * Validated attributes required to create an item. Validation of
 * lengths / required-ness happens at the API boundary (zod); this
 * shape is the already-clean domain input.
 */
export interface CreateItemAttrs {
  readonly title: string;
  readonly description: string;
  readonly category: ItemCategory;
  readonly pickupLocation: string;
  readonly postedBy: string;
  readonly photoUrl?: string | undefined;
  readonly pickupLatLng?: LatLng | undefined;
  readonly expiresAt?: Date | undefined;
}

/**
 * Factory: an item always enters the system in `available` status
 * with no claimer (REQ-CAP-POST-ITEM, REQ-INV-ITEM-LIFECYCLE). The
 * `id` and `createdAt` instant are supplied by the caller so the
 * domain remains pure and deterministic.
 */
export function createSurplusItem(
  attrs: CreateItemAttrs,
  id: string,
  now: Date,
): SurplusItem {
  return {
    id,
    title: attrs.title,
    description: attrs.description,
    photoUrl: attrs.photoUrl ?? null,
    category: attrs.category,
    pickupLocation: attrs.pickupLocation,
    pickupLatLng: attrs.pickupLatLng ?? null,
    postedBy: attrs.postedBy,
    status: 'available',
    claimedBy: null,
    createdAt: new Date(now.getTime()),
    expiresAt: attrs.expiresAt ? new Date(attrs.expiresAt.getTime()) : null,
  };
}

/** Type guard for the closed category enum. */
export function isItemCategory(value: unknown): value is ItemCategory {
  return (
    typeof value === 'string' &&
    (ITEM_CATEGORIES as readonly string[]).includes(value)
  );
}
