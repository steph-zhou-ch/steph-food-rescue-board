// Status badge for the item detail view (REQ-CAP-FE-ITEM-DETAIL).
//
// Renders an uppercase pill whose color encodes the lifecycle state:
//   available → green (#738958), claimed → orange (#dc8226).
// `picked_up` / `removed` items never reach the detail action surface,
// but we still render a neutral pill so the component is total.
import { createElement as e } from 'react';
import type { ReactElement } from 'react';

import { tokens } from '../theme';

export type ItemStatus = 'available' | 'claimed' | 'picked_up' | 'removed';

const STATUS_STYLE: Record<ItemStatus, { label: string; bg: string }> = {
  available: { label: 'AVAILABLE', bg: tokens.badgeAvailable },
  claimed: { label: 'CLAIMED', bg: tokens.badgeClaimed },
  picked_up: { label: 'PICKED UP', bg: tokens.textMuted },
  removed: { label: 'REMOVED', bg: tokens.textMuted },
};

export function StatusBadge({ status }: { status: ItemStatus }): ReactElement {
  const { label, bg } = STATUS_STYLE[status];
  return e(
    'span',
    {
      'data-testid': 'status-badge',
      style: {
        display: 'inline-block',
        backgroundColor: bg,
        color: '#ffffff',
        fontFamily: tokens.fontBody,
        fontSize: '12px',
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '4px 12px',
        borderRadius: tokens.radiusPill,
      },
    },
    label,
  );
}
