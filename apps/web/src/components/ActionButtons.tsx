// Status-aware action buttons for the item detail view
// (REQ-CAP-FE-ITEM-DETAIL, criteria fe-detail-01/02/03/04).
//
//   available → single blue pill "Claim this item" (checkmark icon)
//   claimed   → dark primary "Mark as picked up" (checkmark icon)
//               + outlined secondary "Unclaim" (undo icon)
// While a request is in flight every button is disabled so the two
// claimed-state actions can never fire simultaneously.
import { createElement as e } from 'react';
import type { CSSProperties, ReactElement } from 'react';

import { tokens } from '../theme';
import { CheckIcon, UndoIcon } from './icons';
import type { ItemStatus } from './StatusBadge';

export interface ActionButtonsProps {
  status: ItemStatus;
  pending: boolean;
  onClaim: () => void;
  onPickup: () => void;
  onUnclaim: () => void;
}

const baseButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  width: '100%',
  padding: '14px 20px',
  borderRadius: tokens.radiusPill,
  fontFamily: tokens.fontBody,
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
};

export function ActionButtons({
  status,
  pending,
  onClaim,
  onPickup,
  onUnclaim,
}: ActionButtonsProps): ReactElement | null {
  if (status === 'available') {
    return e(
      'button',
      {
        type: 'button',
        'data-testid': 'btn-claim',
        disabled: pending,
        onClick: onClaim,
        style: {
          ...baseButton,
          backgroundColor: tokens.btnClaim,
          color: '#ffffff',
          border: 'none',
          opacity: pending ? 0.6 : 1,
        },
      },
      [e(CheckIcon, { key: 'i', size: 18, color: '#ffffff' }), 'Claim this item'],
    );
  }

  if (status === 'claimed') {
    return e(
      'div',
      {
        'data-testid': 'action-buttons',
        style: { display: 'flex', flexDirection: 'column', gap: '12px' },
      },
      [
        e(
          'button',
          {
            key: 'pickup',
            type: 'button',
            'data-testid': 'btn-pickup',
            disabled: pending,
            onClick: onPickup,
            style: {
              ...baseButton,
              backgroundColor: tokens.btnPrimary,
              color: '#ffffff',
              border: 'none',
              opacity: pending ? 0.6 : 1,
            },
          },
          [
            e(CheckIcon, { key: 'i', size: 18, color: '#ffffff' }),
            'Mark as picked up',
          ],
        ),
        e(
          'button',
          {
            key: 'unclaim',
            type: 'button',
            'data-testid': 'btn-unclaim',
            disabled: pending,
            onClick: onUnclaim,
            style: {
              ...baseButton,
              backgroundColor: 'transparent',
              color: tokens.textPrimary,
              border: `1px solid ${tokens.borderDefault}`,
              opacity: pending ? 0.6 : 1,
            },
          },
          [e(UndoIcon, { key: 'i', size: 18 }), 'Unclaim'],
        ),
      ],
    );
  }

  return null;
}
