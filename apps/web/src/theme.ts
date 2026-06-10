// Visual design tokens for the rescue-board surfaces, mirrored from the
// Figma design system (see requirements/domains/rescue-board.md
// "Visual design tokens"). Centralized so badges, cards, and buttons
// stay in sync with the spec.
export const tokens = {
  bgPage: '#fcfbfa',
  bgCard: '#ffffff',
  borderDefault: '#dfdbd2',
  textPrimary: '#0e0c21',
  textMuted: '#6d675e',
  textPlaceholder: 'rgba(14,12,33,0.5)',
  badgeFood: '#dc8226',
  badgeHousehold: '#5893d3',
  badgeOther: '#77a9a0',
  badgeAvailable: '#738958',
  badgeClaimed: '#dc8226',
  badgeNeutral: '#edebe5',
  btnPrimary: '#0e0c21',
  btnClaim: '#3c6ebc',
  textDanger: '#b5292b',
  radiusCard: '16px',
  radiusPill: '9999px',
  radiusInput: '10px',
  fontHeading: 'Geist, sans-serif',
  fontBody: 'Inter, sans-serif',
} as const;
