// Category pill selector (REQ-CAP-FE-POST-FORM). Three mutually-exclusive
// pills: Food / Household / Other. Defaults to 'food' (first option) and
// reports the selected category back via onChange. The selected pill is
// marked aria-pressed="true".
import type { CSSProperties } from 'react';

export type Category = 'food' | 'household' | 'other';

export interface CategoryOption {
  value: Category;
  label: string;
}

export const CATEGORY_OPTIONS: readonly CategoryOption[] = [
  { value: 'food', label: 'Food' },
  { value: 'household', label: 'Household' },
  { value: 'other', label: 'Other' },
];

export interface CategoryPickerProps {
  value: Category;
  onChange: (value: Category) => void;
}

const pillBase: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  padding: '8px 16px',
  borderRadius: '9999px',
  border: '1px solid #dfdbd2',
  cursor: 'pointer',
};

const pillSelected: CSSProperties = {
  ...pillBase,
  backgroundColor: '#0e0c21',
  color: '#ffffff',
  borderColor: '#0e0c21',
};

const pillUnselected: CSSProperties = {
  ...pillBase,
  backgroundColor: '#ffffff',
  color: '#0e0c21',
};

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  return (
    <div role="group" aria-label="Category" style={{ display: 'flex', gap: '8px' }}>
      {CATEGORY_OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            style={selected ? pillSelected : pillUnselected}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
