// Item detail page with status-aware actions (REQ-CAP-FE-ITEM-DETAIL).
//
// Renders a single SurplusItem: hero image, status + category badges,
// title, description, and a detail card (pickup location, posted by,
// posted time, expiry, claimed-by). Action buttons change with the
// item status and call PATCH /api/items/:id/status, updating the view
// in place (no full page reload).
import { createElement as e, useState } from 'react';
import type { ReactElement } from 'react';

import { tokens } from '../theme';
import { StatusBadge } from '../components/StatusBadge';
import type { ItemStatus } from '../components/StatusBadge';
import { DetailCard } from '../components/DetailCard';
import type { DetailRow } from '../components/DetailCard';
import { ActionButtons } from '../components/ActionButtons';
import {
  ArrowLeftIcon,
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  UserIcon,
} from '../components/icons';

/** Wire-shape of a SurplusItem (dates as ISO-8601 Z strings). Mirrors
 * the API's `SurplusItemWire` so the detail page consumes the same
 * payload returned by GET /api/items/:id. */
export interface SurplusItemWire {
  id: string;
  title: string;
  description: string;
  photoUrl: string | null;
  category: 'food' | 'household' | 'other';
  pickupLocation: string;
  pickupLatLng: { lat: number; lng: number } | null;
  postedBy: string;
  status: ItemStatus;
  claimedBy: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export type DetailAction = 'claim' | 'unclaim' | 'confirm_pickup';

export interface ItemDetailProps {
  item: SurplusItemWire;
  /** Navigate back to the browse feed (back arrow + post-pickup). */
  onBack?: () => void;
}

const CATEGORY_LABEL: Record<SurplusItemWire['category'], string> = {
  food: 'Food',
  household: 'Household',
  other: 'Other',
};

/** Format an ISO-8601 instant for display. Takes the string explicitly,
 * never the wall clock, so the component stays deterministic. */
function formatInstant(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  });
}

export function ItemDetail({ item, onBack }: ItemDetailProps): ReactElement {
  const [current, setCurrent] = useState<SurplusItemWire>(item);
  const [pending, setPending] = useState(false);

  async function runAction(action: DetailAction): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(`/api/items/${current.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'claim'
            ? { action, claimedBy: 'You' }
            : { action },
        ),
      });
      if (!res.ok) {
        return;
      }
      const updated = (await res.json()) as {
        status: ItemStatus;
        claimedBy: string | null;
      };
      if (action === 'confirm_pickup') {
        // Item leaves the feed; return to browse.
        onBack?.();
        return;
      }
      setCurrent((prev) => ({
        ...prev,
        status: updated.status,
        claimedBy: updated.claimedBy,
      }));
    } finally {
      setPending(false);
    }
  }

  const rows: DetailRow[] = [
    {
      key: 'pickupLocation',
      icon: e(MapPinIcon, { size: 16 }),
      label: 'Pickup location',
      value: current.pickupLocation,
    },
    {
      key: 'postedBy',
      icon: e(UserIcon, { size: 16 }),
      label: 'Posted by',
      value: current.postedBy,
    },
    {
      key: 'postedTime',
      icon: e(ClockIcon, { size: 16 }),
      label: 'Posted',
      value: formatInstant(current.createdAt),
    },
  ];

  if (current.status === 'claimed' && current.claimedBy !== null) {
    rows.push({
      key: 'claimedBy',
      icon: e(UserIcon, { size: 16 }),
      label: 'Claimed by',
      value: current.claimedBy,
    });
  }

  if (current.expiresAt !== null) {
    rows.push({
      key: 'expiresAt',
      icon: e(CalendarIcon, { size: 16 }),
      label: 'Expires',
      value: formatInstant(current.expiresAt),
      danger: true,
    });
  }

  return e(
    'main',
    {
      'data-testid': 'item-detail',
      style: {
        backgroundColor: tokens.bgPage,
        minHeight: '100vh',
        fontFamily: tokens.fontBody,
        color: tokens.textPrimary,
      },
    },
    [
      // Hero image with overlaid back button + status badge.
      e(
        'div',
        {
          key: 'hero',
          style: { position: 'relative', width: '100%', height: '280px' },
        },
        [
          e('img', {
            key: 'img',
            'data-testid': 'hero-image',
            src: current.photoUrl ?? '',
            alt: current.title,
            style: {
              width: '100%',
              height: '280px',
              objectFit: 'cover',
              display: 'block',
            },
          }),
          e(
            'button',
            {
              key: 'back',
              type: 'button',
              'data-testid': 'btn-back',
              'aria-label': 'Back to feed',
              onClick: () => onBack?.(),
              style: {
                position: 'absolute',
                top: '16px',
                left: '16px',
                width: '40px',
                height: '40px',
                borderRadius: tokens.radiusPill,
                border: 'none',
                backgroundColor: tokens.bgCard,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              },
            },
            e(ArrowLeftIcon, { size: 20 }),
          ),
          e(
            'div',
            {
              key: 'status',
              style: { position: 'absolute', top: '16px', right: '16px' },
            },
            e(StatusBadge, { status: current.status }),
          ),
        ],
      ),
      // Body.
      e(
        'div',
        {
          key: 'body',
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            padding: '20px',
          },
        },
        [
          e(
            'span',
            {
              key: 'cat',
              'data-testid': 'category-badge',
              style: {
                alignSelf: 'flex-start',
                backgroundColor: tokens.badgeNeutral,
                color: tokens.textPrimary,
                fontSize: '12px',
                fontWeight: 600,
                padding: '4px 12px',
                borderRadius: tokens.radiusPill,
              },
            },
            CATEGORY_LABEL[current.category],
          ),
          e(
            'h1',
            {
              key: 'title',
              'data-testid': 'item-title',
              style: {
                margin: 0,
                fontFamily: tokens.fontHeading,
                fontSize: '30px',
                fontWeight: 700,
              },
            },
            current.title,
          ),
          e(
            'p',
            {
              key: 'desc',
              'data-testid': 'item-description',
              style: {
                margin: 0,
                fontSize: '15px',
                lineHeight: 1.5,
                color: tokens.textPrimary,
              },
            },
            current.description,
          ),
          e(DetailCard, { key: 'card', rows }),
          e(ActionButtons, {
            key: 'actions',
            status: current.status,
            pending,
            onClaim: () => void runAction('claim'),
            onPickup: () => void runAction('confirm_pickup'),
            onUnclaim: () => void runAction('unclaim'),
          }),
        ],
      ),
    ],
  );
}
