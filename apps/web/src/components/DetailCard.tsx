// Detail card for the item detail view (REQ-CAP-FE-ITEM-DETAIL,
// criterion fe-detail-06).
//
// A bordered, rounded container of icon+label+value rows. Each row has:
//   - a 16px leading icon,
//   - a 12px muted label,
//   - a 14px medium-weight value.
// Rows are separated by a 14px gap. The expiry value renders in red.
import { createElement as e } from 'react';
import type { ReactElement } from 'react';

import { tokens } from '../theme';

export interface DetailRow {
  /** Stable key used for the row/value test ids, e.g. "pickupLocation". */
  key: string;
  icon: ReactElement;
  label: string;
  value: string;
  /** When true, the value renders in text-danger red (used for expiry). */
  danger?: boolean;
}

function Row({ row }: { row: DetailRow }): ReactElement {
  return e(
    'div',
    {
      'data-testid': `detail-row-${row.key}`,
      style: { display: 'flex', alignItems: 'flex-start', gap: '10px' },
    },
    [
      e(
        'span',
        {
          key: 'icon',
          'data-testid': `detail-icon-${row.key}`,
          style: {
            display: 'inline-flex',
            flex: '0 0 auto',
            color: tokens.textMuted,
          },
        },
        row.icon,
      ),
      e(
        'div',
        {
          key: 'text',
          style: { display: 'flex', flexDirection: 'column', gap: '2px' },
        },
        [
          e(
            'span',
            {
              key: 'label',
              'data-testid': `detail-label-${row.key}`,
              style: {
                fontFamily: tokens.fontBody,
                fontSize: '12px',
                color: tokens.textMuted,
              },
            },
            row.label,
          ),
          e(
            'span',
            {
              key: 'value',
              'data-testid': `detail-value-${row.key}`,
              style: {
                fontFamily: tokens.fontBody,
                fontSize: '14px',
                fontWeight: 500,
                color: row.danger ? tokens.textDanger : tokens.textPrimary,
              },
            },
            row.value,
          ),
        ],
      ),
    ],
  );
}

export function DetailCard({ rows }: { rows: DetailRow[] }): ReactElement {
  return e(
    'div',
    {
      'data-testid': 'detail-card',
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        backgroundColor: tokens.bgCard,
        border: `1px solid ${tokens.borderDefault}`,
        borderRadius: tokens.radiusCard,
        padding: '16px',
      },
    },
    rows.map((row) => e(Row, { key: row.key, row })),
  );
}
