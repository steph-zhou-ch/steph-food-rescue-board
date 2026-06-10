// Integration tests for the Browse Feed page (REQ-CAP-FE-BROWSE-FEED).
//
// These render the real component tree in jsdom and stub the global
// `fetch` so the feed is driven by deterministic GET /api/items
// payloads. Each acceptance criterion lives in its own tagged
// `describe` block so the spec-adherence audit can find it.

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from '../src/App';
import type { ItemWire } from '../src/hooks/useItems';

// A fixed "now" so relative-time assertions are deterministic.
const NOW = new Date('2026-06-10T12:00:00.000Z');

const FOOD_ITEM: ItemWire = {
  id: 'item-food-1',
  title: 'Six sourdough loaves',
  description: 'Fresh today, surplus from the bakery.',
  photoUrl: 'https://example.test/bread.jpg',
  category: 'food',
  pickupLocation: 'Mission & 24th',
  pickupLatLng: null,
  postedBy: 'Ada',
  status: 'available',
  claimedBy: null,
  createdAt: '2026-06-10T10:00:00.000Z', // 2h before NOW
  expiresAt: null,
};

const HOUSEHOLD_ITEM: ItemWire = {
  id: 'item-household-1',
  title: 'Box of glass jars',
  description: 'Assorted, clean.',
  photoUrl: null, // no photo -> placeholder, not a broken image
  category: 'household',
  pickupLocation: 'Bernal Heights',
  pickupLatLng: null,
  postedBy: 'Grace',
  status: 'available',
  claimedBy: null,
  createdAt: '2026-06-09T12:00:00.000Z', // 1d before NOW
  expiresAt: null,
};

const OTHER_ITEM: ItemWire = {
  id: 'item-other-1',
  title: 'Childrens books',
  description: 'A bag of picture books.',
  photoUrl: null,
  category: 'other',
  pickupLocation: 'Noe Valley',
  pickupLatLng: null,
  postedBy: 'Linus',
  status: 'available',
  claimedBy: null,
  createdAt: '2026-06-10T11:30:00.000Z',
  expiresAt: null,
};

const ALL_ITEMS = [FOOD_ITEM, HOUSEHOLD_ITEM, OTHER_ITEM];

/**
 * Install a fetch stub that honours the `?category=` query param the
 * same way the real GET /api/items endpoint does, returning the wire
 * envelope `{ items: [...] }`.
 */
function stubItemsApi(items: ItemWire[] = ALL_ITEMS): void {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    const category = url.searchParams.get('category');
    const filtered = category
      ? items.filter((i) => i.category === category)
      : items;
    return new Response(JSON.stringify({ items: filtered }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
}

/** Probe that surfaces the current router location for assertions. */
function LocationProbe(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="location-display">{loc.pathname + loc.search}</div>;
}

function renderApp(initialPath = '/'): void {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<App now={NOW} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  stubItemsApi();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('@req REQ-CAP-FE-BROWSE-FEED @criterion fe-feed-01-renders-card-grid @design rescue-board/browse-feed', () => {
  it('renders each available item as a card with all required fields', async () => {
    renderApp('/');

    const cards = await screen.findAllByTestId('item-card');
    expect(cards).toHaveLength(ALL_ITEMS.length);

    // The food card shows its photo, badge, title, location, poster, time.
    const foodCard = cards.find((c) =>
      within(c).queryByText('Six sourdough loaves'),
    );
    expect(foodCard).toBeDefined();
    const card = within(foodCard!);

    // Title (single-line truncated marker class applied)
    const title = card.getByText('Six sourdough loaves');
    expect(title).toBeInTheDocument();

    // Category badge, color-coded for food (orange).
    const badge = card.getByTestId('category-badge');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('badge-food');

    // Photo present (real <img> with src).
    const photo = card.getByTestId('item-photo');
    expect(photo.tagName).toBe('IMG');
    expect(photo).toHaveAttribute('src', FOOD_ITEM.photoUrl!);

    // Pickup location + pin icon.
    expect(card.getByText('Mission & 24th')).toBeInTheDocument();
    expect(card.getByTestId('icon-pin')).toBeInTheDocument();

    // Posted-by + person icon.
    expect(card.getByText('Ada')).toBeInTheDocument();
    expect(card.getByTestId('icon-person')).toBeInTheDocument();

    // Relative time + clock icon.
    expect(card.getByTestId('icon-clock')).toBeInTheDocument();
    expect(card.getByTestId('relative-time')).toHaveTextContent('2h ago');
  });

  it('renders a colored placeholder (not a broken image) when an item has no photo', async () => {
    renderApp('/');
    await screen.findAllByTestId('item-card');

    const jarCard = screen
      .getAllByTestId('item-card')
      .find((c) => within(c).queryByText('Box of glass jars'))!;
    const card = within(jarCard);

    // No <img> should be rendered for a photo-less item.
    expect(card.queryByTestId('item-photo')).toBeNull();
    // A colored placeholder stands in instead.
    const placeholder = card.getByTestId('item-photo-placeholder');
    expect(placeholder).toBeInTheDocument();
    expect(placeholder).toHaveClass('badge-household');

    // Negative case: every card still has a category badge.
    expect(card.getByTestId('category-badge')).toBeInTheDocument();
  });
});
