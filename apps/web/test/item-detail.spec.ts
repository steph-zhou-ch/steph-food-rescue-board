// Tests for REQ-CAP-FE-ITEM-DETAIL (the item detail page with
// status-aware actions).
//
// This file is `.ts` (per the track deliverable), so it cannot contain
// JSX. Components are rendered via React.createElement aliased to `e`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as e } from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';

import { ItemDetail } from '../src/pages/ItemDetail';
import type { SurplusItemWire } from '../src/pages/ItemDetail';

const AVAILABLE_ITEM: SurplusItemWire = {
  id: 'item-1',
  title: '12 fresh bagels',
  description: 'A dozen day-old bagels from the corner bakery. Still great.',
  photoUrl: 'https://example.com/bagels.jpg',
  category: 'food',
  pickupLocation: '14 Elm Street, back door',
  pickupLatLng: null,
  postedBy: 'Corner Bakery',
  status: 'available',
  claimedBy: null,
  createdAt: '2026-06-10T09:00:00.000Z',
  expiresAt: '2026-06-11T17:00:00.000Z',
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-01-renders-available-state @design rescue-board/item-detail-available', () => {
  it('renders the hero image full width and 280px tall', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const hero = screen.getByTestId('hero-image');
    expect(hero).toBeInTheDocument();
    expect(hero).toHaveAttribute('src', AVAILABLE_ITEM.photoUrl);
    expect(hero).toHaveStyle({ width: '100%', height: '280px' });
  });

  it('renders a green AVAILABLE status badge and a gray category badge', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const status = screen.getByTestId('status-badge');
    expect(status).toHaveTextContent('AVAILABLE');
    expect(status).toHaveStyle({ backgroundColor: '#738958' });

    const category = screen.getByTestId('category-badge');
    expect(category).toHaveTextContent(/food/i);
    expect(category).toHaveStyle({ backgroundColor: '#edebe5' });
  });

  it('renders the bold 30px title and description paragraph', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const title = screen.getByTestId('item-title');
    expect(title).toHaveTextContent('12 fresh bagels');
    expect(title).toHaveStyle({ fontSize: '30px', fontWeight: '700' });

    expect(screen.getByTestId('item-description')).toHaveTextContent(
      AVAILABLE_ITEM.description,
    );
  });

  it('renders detail card rows for pickup location, posted by, posted time and expiry', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const card = screen.getByTestId('detail-card');
    expect(within(card).getByTestId('detail-row-pickupLocation')).toHaveTextContent(
      AVAILABLE_ITEM.pickupLocation,
    );
    expect(within(card).getByTestId('detail-row-postedBy')).toHaveTextContent(
      AVAILABLE_ITEM.postedBy,
    );
    expect(within(card).getByTestId('detail-row-postedTime')).toBeInTheDocument();
    expect(within(card).getByTestId('detail-row-expiresAt')).toBeInTheDocument();
  });

  it('renders the expiry value in red (text-danger)', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const expiryValue = screen.getByTestId('detail-value-expiresAt');
    expect(expiryValue).toHaveStyle({ color: '#b5292b' });
  });

  it('renders a single blue, pill-shaped, full-width "Claim this item" button with a checkmark icon', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    const claim = screen.getByTestId('btn-claim');
    expect(claim).toHaveTextContent('Claim this item');
    expect(within(claim).getByTestId('icon-check')).toBeInTheDocument();
    expect(claim).toHaveStyle({
      backgroundColor: '#3c6ebc',
      borderRadius: '9999px',
      width: '100%',
    });
  });

  it('does NOT render "Mark as picked up" or "Unclaim" buttons (negative case)', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    expect(screen.queryByTestId('btn-pickup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('btn-unclaim')).not.toBeInTheDocument();
  });

  it('does NOT omit the expiry row when expiresAt is set (negative case)', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    expect(screen.getByTestId('detail-row-expiresAt')).toBeInTheDocument();
  });

  it('omits the expiry row entirely when expiresAt is null', () => {
    render(e(ItemDetail, { item: { ...AVAILABLE_ITEM, expiresAt: null } }));
    expect(screen.queryByTestId('detail-row-expiresAt')).not.toBeInTheDocument();
  });
});

const CLAIMED_ITEM: SurplusItemWire = {
  ...AVAILABLE_ITEM,
  status: 'claimed',
  claimedBy: 'Hope Shelter',
};

describe('@req REQ-CAP-FE-ITEM-DETAIL @criterion fe-detail-02-renders-claimed-state @design rescue-board/item-detail-claimed', () => {
  it('renders an orange CLAIMED badge instead of the green AVAILABLE badge', () => {
    render(e(ItemDetail, { item: CLAIMED_ITEM }));
    const status = screen.getByTestId('status-badge');
    expect(status).toHaveTextContent('CLAIMED');
    expect(status).not.toHaveTextContent('AVAILABLE');
    expect(status).toHaveStyle({ backgroundColor: '#dc8226' });
  });

  it('shows a "Claimed by" row with the claimer name in the detail card', () => {
    render(e(ItemDetail, { item: CLAIMED_ITEM }));
    const card = screen.getByTestId('detail-card');
    const row = within(card).getByTestId('detail-row-claimedBy');
    expect(row).toHaveTextContent(/claimed by/i);
    expect(within(card).getByTestId('detail-value-claimedBy')).toHaveTextContent(
      'Hope Shelter',
    );
  });

  it('renders "Mark as picked up" (dark, checkmark) and "Unclaim" (outlined, undo) buttons', () => {
    render(e(ItemDetail, { item: CLAIMED_ITEM }));
    const pickup = screen.getByTestId('btn-pickup');
    expect(pickup).toHaveTextContent('Mark as picked up');
    expect(within(pickup).getByTestId('icon-check')).toBeInTheDocument();
    expect(pickup).toHaveStyle({ backgroundColor: '#0e0c21' });

    const unclaim = screen.getByTestId('btn-unclaim');
    expect(unclaim).toHaveTextContent('Unclaim');
    expect(within(unclaim).getByTestId('icon-undo')).toBeInTheDocument();
    // "outlined" = visible border, no solid fill (distinct from the dark
    // primary "Mark as picked up").
    expect(unclaim).toHaveStyle({ border: '1px solid #dfdbd2' });
    expect(unclaim).not.toHaveStyle({ backgroundColor: '#0e0c21' });
  });

  it('does NOT show "Claim this item" on claimed items (negative case)', () => {
    render(e(ItemDetail, { item: CLAIMED_ITEM }));
    expect(screen.queryByTestId('btn-claim')).not.toBeInTheDocument();
  });

  it('does NOT render the claimed-by row on available items (negative case)', () => {
    render(e(ItemDetail, { item: AVAILABLE_ITEM }));
    expect(screen.queryByTestId('detail-row-claimedBy')).not.toBeInTheDocument();
  });
});
