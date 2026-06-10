// Post item form page (REQ-CAP-FE-POST-FORM, Figma node rescue-board 1:170).
//
// Full-page form for creating a surplus item. Renders, in design order:
// photo upload (optional), title, description, category, pickup location,
// expiry (optional), and poster name. Submits to POST /api/items.
import { useState, type CSSProperties, type ReactNode } from 'react';
import { CharacterCounter } from '../components/CharacterCounter';
import { CategoryPicker, type Category } from '../components/CategoryPicker';
import { PhotoUpload } from '../components/PhotoUpload';

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 500;

export interface PostItemProps {
  // Navigation hook (defaults to history-based nav). Tests inject a spy.
  onNavigate?: (path: string) => void;
}

interface FieldProps {
  name: string;
  children: ReactNode;
}

function Field({ name, children }: FieldProps) {
  return (
    <div data-field={name} data-testid={`field-${name}`} style={fieldStyle}>
      {children}
    </div>
  );
}

const pageStyle: CSSProperties = {
  backgroundColor: '#fcfbfa',
  color: '#0e0c21',
  fontFamily: 'Inter, sans-serif',
  minHeight: '100vh',
  padding: '16px',
};

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  marginBottom: '20px',
};

const labelRowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
};

const labelStyle: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  fontWeight: 600,
  color: '#0e0c21',
};

const inputStyle: CSSProperties = {
  borderRadius: '10px',
  border: '1px solid #dfdbd2',
  padding: '10px 12px',
  fontFamily: 'Inter, sans-serif',
  fontSize: '14px',
  backgroundColor: '#ffffff',
};

const helperStyle: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '12px',
  color: '#6d675e',
};

const optionalStyle: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: '13px',
  fontWeight: 400,
  color: '#6d675e',
};

// Red asterisk marking a required field (text-danger token #b5292b).
function RequiredMarker() {
  return (
    <span data-testid="required-marker" aria-hidden="true" style={{ color: '#b5292b', marginLeft: '2px' }}>
      *
    </span>
  );
}

const submitStyle: CSSProperties = {
  width: '100%',
  borderRadius: '9999px',
  backgroundColor: '#0e0c21',
  color: '#ffffff',
  border: 'none',
  padding: '14px',
  fontFamily: 'Inter, sans-serif',
  fontSize: '16px',
  fontWeight: 600,
  cursor: 'pointer',
};

export function PostItem(_props: PostItemProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<Category>('food');
  const [pickupLocation, setPickupLocation] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [postedBy, setPostedBy] = useState('');

  return (
    <main style={pageStyle}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button type="button" aria-label="Back" style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>
          ←
        </button>
        <h1 style={{ fontFamily: 'Geist, sans-serif', fontSize: '20px', margin: 0 }}>Post an Item</h1>
      </header>

      <form>
        <Field name="photo">
          <span style={labelStyle}>
            Photo <span style={optionalStyle}>(optional)</span>
          </span>
          <PhotoUpload />
        </Field>

        <Field name="title">
          <div style={labelRowStyle}>
            <label htmlFor="title" style={labelStyle}>
              Title
              <RequiredMarker />
            </label>
            <CharacterCounter count={title.length} max={TITLE_MAX} testId="counter-title" />
          </div>
          <input
            id="title"
            value={title}
            onChange={(ev) => setTitle(ev.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field name="description">
          <div style={labelRowStyle}>
            <label htmlFor="description" style={labelStyle}>
              Description
              <RequiredMarker />
            </label>
            <CharacterCounter
              count={description.length}
              max={DESCRIPTION_MAX}
              testId="counter-description"
            />
          </div>
          <textarea
            id="description"
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            rows={4}
            style={inputStyle}
          />
        </Field>

        <Field name="category">
          <span style={labelStyle}>
            Category
            <RequiredMarker />
          </span>
          <CategoryPicker value={category} onChange={setCategory} />
        </Field>

        <Field name="pickupLocation">
          <label htmlFor="pickupLocation" style={labelStyle}>
            Pickup Location
            <RequiredMarker />
          </label>
          <input
            id="pickupLocation"
            value={pickupLocation}
            onChange={(ev) => setPickupLocation(ev.target.value)}
            style={inputStyle}
          />
        </Field>

        <Field name="expiresAt">
          <label htmlFor="expiresAt" style={labelStyle}>
            Expires <span style={optionalStyle}>(optional)</span>
          </label>
          <input
            id="expiresAt"
            type="datetime-local"
            value={expiresAt}
            onChange={(ev) => setExpiresAt(ev.target.value)}
            style={inputStyle}
          />
          <span style={helperStyle}>Leave blank if no specific deadline</span>
        </Field>

        <Field name="postedBy">
          <label htmlFor="postedBy" style={labelStyle}>
            Your Name / Organization
            <RequiredMarker />
          </label>
          <input
            id="postedBy"
            value={postedBy}
            onChange={(ev) => setPostedBy(ev.target.value)}
            style={inputStyle}
          />
        </Field>

        <button type="submit" style={submitStyle}>
          Post Item
        </button>
      </form>
    </main>
  );
}
