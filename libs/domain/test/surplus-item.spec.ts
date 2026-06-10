// Domain state-machine + entity tests for the SurplusItem lifecycle.
//
// These pin the pure transition rules from
// requirements/domains/rescue-board.md#status-state-machine and the
// REQ-INV-ITEM-LIFECYCLE predicates. No I/O, no framework: the domain
// layer is pure TypeScript.

import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  ITEM_STATUSES,
  type ItemStatus,
  type ItemAction,
  transition,
  TransitionError,
} from '../src/item-status.js';
import {
  createSurplusItem,
  type SurplusItem,
} from '../src/surplus-item.js';

describe('@req REQ-INV-ITEM-LIFECYCLE @criterion lifecycle-01-no-illegal-transitions', () => {
  it('allows available -> claimed via claim', () => {
    expect(transition('available', 'claim')).toBe('claimed');
  });

  it('allows claimed -> picked_up via confirm_pickup', () => {
    expect(transition('claimed', 'confirm_pickup')).toBe('picked_up');
  });

  it('allows claimed -> available via unclaim', () => {
    expect(transition('claimed', 'unclaim')).toBe('available');
  });

  it('allows any -> removed via remove', () => {
    expect(transition('available', 'remove')).toBe('removed');
    expect(transition('claimed', 'remove')).toBe('removed');
    expect(transition('picked_up', 'remove')).toBe('removed');
    // removed -> removed is idempotent (DELETE is idempotent)
    expect(transition('removed', 'remove')).toBe('removed');
  });

  it('rejects available -> picked_up (confirm_pickup on available)', () => {
    expect(() => transition('available', 'confirm_pickup')).toThrow(
      TransitionError,
    );
  });

  it('rejects picked_up -> claimed (claim on picked_up)', () => {
    expect(() => transition('picked_up', 'claim')).toThrow(TransitionError);
  });

  it('rejects removed -> available (unclaim on removed)', () => {
    expect(() => transition('removed', 'unclaim')).toThrow(TransitionError);
  });

  it('rejects claim on an already-claimed item', () => {
    expect(() => transition('claimed', 'claim')).toThrow(TransitionError);
  });

  it('rejects unclaim on an available item', () => {
    expect(() => transition('available', 'unclaim')).toThrow(TransitionError);
  });

  it('rejects confirm_pickup on a picked_up item', () => {
    expect(() => transition('picked_up', 'confirm_pickup')).toThrow(
      TransitionError,
    );
  });

  it('carries a closed-enum reason code on the error', () => {
    try {
      transition('available', 'confirm_pickup');
      expect.fail('expected TransitionError');
    } catch (err) {
      expect(err).toBeInstanceOf(TransitionError);
      expect((err as TransitionError).reason).toBe('illegal-transition');
      expect((err as TransitionError).from).toBe('available');
      expect((err as TransitionError).action).toBe('confirm_pickup');
    }
  });
});

describe('@req REQ-INV-ITEM-LIFECYCLE @criterion lifecycle-02-status-never-null', () => {
  it('newly created items always have status = available', () => {
    const now = new Date('2026-06-10T12:00:00.000Z');
    const item = createSurplusItem(
      {
        title: '12 bagels',
        description: 'Fresh this morning',
        category: 'food',
        pickupLocation: '5th Ave bakery',
        postedBy: 'Sam',
      },
      'id-1',
      now,
    );
    expect(item.status).toBe('available');
    expect(item.status).not.toBeNull();
  });

  it('the status enum is closed to exactly four values', () => {
    expect(ITEM_STATUSES).toEqual([
      'available',
      'claimed',
      'picked_up',
      'removed',
    ]);
  });

  it('transition only ever returns a member of the closed status enum', () => {
    const all: ItemStatus[] = [
      'available',
      'claimed',
      'picked_up',
      'removed',
    ];
    const actions: ItemAction[] = [
      'claim',
      'unclaim',
      'confirm_pickup',
      'remove',
    ];
    for (const from of all) {
      for (const action of actions) {
        let result: ItemStatus | undefined;
        try {
          result = transition(from, action);
        } catch {
          continue;
        }
        expect(ITEM_STATUSES).toContain(result);
      }
    }
  });

  it('entity status field is typed to the closed enum', () => {
    expectTypeOf<SurplusItem['status']>().toEqualTypeOf<ItemStatus>();
  });
});
