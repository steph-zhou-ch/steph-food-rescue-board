// Live character counter for text inputs/areas (REQ-CAP-FE-POST-FORM).
// Renders "{count}/{max}". Turns red (via data-at-limit) once the field
// is at its maximum length so the user sees they cannot type more.
import type { CSSProperties } from 'react';

export interface CharacterCounterProps {
  count: number;
  max: number;
  testId: string;
}

const baseStyle: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '12px',
  color: '#6d675e',
  textAlign: 'right',
};

const atLimitStyle: CSSProperties = {
  ...baseStyle,
  color: '#b5292b',
};

export function CharacterCounter({ count, max, testId }: CharacterCounterProps) {
  const atLimit = count >= max;
  return (
    <span
      data-testid={testId}
      data-at-limit={atLimit ? 'true' : 'false'}
      style={atLimit ? atLimitStyle : baseStyle}
    >
      {count}/{max}
    </span>
  );
}
