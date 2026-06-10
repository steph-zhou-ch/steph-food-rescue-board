// Application-layer unit tests for ItemStore. Pure and deterministic:
// the caller supplies `id` and `now`, so time-dependent behaviour
// (expiry filtering, newest-first sort) is tested without mocking the
// system clock.

import { describe, expect, it } from 'vitest';

import type { CreateItemAttrs } from '@app/domain';

import { ItemNotFoundError, ItemStore } from '../src/item-store.js';

const baseAttrs: CreateItemAttrs = {
  title: 'item',
  description: 'desc',
  category: 'food',
  pickupLocation: 'here',
  postedBy: 'Sam',
};

const NOW = new Date('2026-06-10T12:00:00.000Z');

describe('@req REQ-CAP-BROWSE-FEED @criterion browse-02-filters-expired', () => {
  it('excludes items whose expiresAt is in the past', () => {
    const store = new ItemStore();
    store.create(
      { ...baseAttrs, expiresAt: new Date('2026-06-10T11:00:00.000Z') },
      'expired',
      new Date('2026-06-10T10:00:00.000Z'),
    );
    store.create(
      { ...baseAttrs, expiresAt: new Date('2026-06-10T13:00:00.000Z') },
      'fresh',
      new Date('2026-06-10T10:00:00.000Z'),
    );
    const ids = store.list({ now: NOW }).map((i) => i.id);
    expect(ids).toContain('fresh');
    expect(ids).not.toContain('expired');
  });

  it('keeps items even when status is available if not expired', () => {
    const store = new ItemStore();
    store.create({ ...baseAttrs }, 'no-expiry', NOW);
    const ids = store.list({ now: NOW }).map((i) => i.id);
    expect(ids).toContain('no-expiry');
  });

  it('excludes an available item with expiresAt < now', () => {
    const store = new ItemStore();
    store.create(
      { ...baseAttrs, expiresAt: new Date('2026-06-09T12:00:00.000Z') },
      'stale',
      new Date('2026-06-09T10:00:00.000Z'),
    );
    expect(store.list({ now: NOW })).toHaveLength(0);
  });
});

describe('@req REQ-CAP-BROWSE-FEED @criterion browse-04-newest-first', () => {
  it('sorts by createdAt descending — newest item first', () => {
    const store = new ItemStore();
    store.create(baseAttrs, 'oldest', new Date('2026-06-10T08:00:00.000Z'));
    store.create(baseAttrs, 'middle', new Date('2026-06-10T09:00:00.000Z'));
    store.create(baseAttrs, 'newest', new Date('2026-06-10T10:00:00.000Z'));
    const ids = store.list({ now: NOW }).map((i) => i.id);
    expect(ids).toEqual(['newest', 'middle', 'oldest']);
  });

  it('does NOT return oldest-first', () => {
    const store = new ItemStore();
    store.create(baseAttrs, 'a', new Date('2026-06-10T08:00:00.000Z'));
    store.create(baseAttrs, 'b', new Date('2026-06-10T10:00:00.000Z'));
    const ids = store.list({ now: NOW }).map((i) => i.id);
    expect(ids[0]).toBe('b');
  });
});

describe('ItemStore behaviour (supporting unit coverage)', () => {
  it('list returns only available items', () => {
    const store = new ItemStore();
    store.create(baseAttrs, 'a', NOW);
    store.create(baseAttrs, 'b', NOW);
    store.applyAction('b', 'claim', 'Lee');
    const ids = store.list({ now: NOW }).map((i) => i.id);
    expect(ids).toEqual(['a']);
  });

  it('throws ItemNotFoundError for a missing id on action', () => {
    const store = new ItemStore();
    expect(() => store.applyAction('nope', 'claim', 'Lee')).toThrow(
      ItemNotFoundError,
    );
  });

  it('throws ItemNotFoundError for a missing id on remove', () => {
    const store = new ItemStore();
    expect(() => store.remove('nope')).toThrow(ItemNotFoundError);
  });
});
