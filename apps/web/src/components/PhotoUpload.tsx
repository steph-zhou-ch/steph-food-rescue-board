// Optional photo upload affordance (REQ-CAP-FE-POST-FORM). A dashed-border
// drop zone with an upload icon and "Click to upload a photo" prompt.
// For the workshop this captures an optional photo URL only; no real upload
// pipeline is wired.
import type { CSSProperties } from 'react';

export interface PhotoUploadProps {
  onSelect?: (fileName: string) => void;
}

const zoneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  padding: '32px',
  border: '2px dashed #dfdbd2',
  borderRadius: '16px',
  backgroundColor: '#ffffff',
  cursor: 'pointer',
  fontFamily: 'Inter, sans-serif',
  color: '#6d675e',
};

export function PhotoUpload({ onSelect }: PhotoUploadProps) {
  return (
    <button
      type="button"
      style={zoneStyle}
      onClick={() => onSelect?.('')}
      aria-label="Upload a photo"
    >
      <svg
        data-testid="photo-upload-icon"
        width="32"
        height="32"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#6d675e"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
      <span>Click to upload a photo</span>
    </button>
  );
}
