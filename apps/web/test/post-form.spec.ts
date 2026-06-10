// Tests for REQ-CAP-FE-POST-FORM (the post-item form page).
//
// This file is `.ts` (per the track deliverable), so it cannot contain
// JSX. Components are rendered via React.createElement aliased to `e`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement as e } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PostItem } from '../src/pages/PostItem';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('@req REQ-CAP-FE-POST-FORM @criterion fe-post-01-renders-all-fields @design rescue-board/post-form', () => {
  it('renders all fields in the designed order', () => {
    render(e(PostItem));

    const order = Array.from(
      document.querySelectorAll<HTMLElement>('[data-field]'),
    ).map((el) => el.getAttribute('data-field'));

    expect(order).toEqual([
      'photo',
      'title',
      'description',
      'category',
      'pickupLocation',
      'expiresAt',
      'postedBy',
    ]);
  });

  it('renders the photo upload area with dashed border affordance', () => {
    render(e(PostItem));
    const photo = screen.getByTestId('field-photo');
    expect(within(photo).getByText('Click to upload a photo')).toBeInTheDocument();
    expect(within(photo).getByTestId('photo-upload-icon')).toBeInTheDocument();
  });

  it('renders title input with a 0/100 character counter', () => {
    render(e(PostItem));
    const title = screen.getByTestId('field-title');
    expect(within(title).getByLabelText(/title/i)).toBeInTheDocument();
    expect(within(title).getByTestId('counter-title')).toHaveTextContent('0/100');
  });

  it('renders description textarea with a 0/500 character counter', () => {
    render(e(PostItem));
    const description = screen.getByTestId('field-description');
    expect(within(description).getByLabelText(/description/i)).toBeInTheDocument();
    expect(within(description).getByTestId('counter-description')).toHaveTextContent(
      '0/500',
    );
  });

  it('renders a category pill selector defaulting to Food', () => {
    render(e(PostItem));
    const category = screen.getByTestId('field-category');
    expect(within(category).getByRole('button', { name: 'Food' })).toBeInTheDocument();
    expect(
      within(category).getByRole('button', { name: 'Household' }),
    ).toBeInTheDocument();
    expect(within(category).getByRole('button', { name: 'Other' })).toBeInTheDocument();

    const food = within(category).getByRole('button', { name: 'Food' });
    expect(food).toHaveAttribute('aria-pressed', 'true');
  });

  it('renders pickup location, expiry (with helper) and poster name inputs', () => {
    render(e(PostItem));
    expect(
      within(screen.getByTestId('field-pickupLocation')).getByLabelText(/pickup location/i),
    ).toBeInTheDocument();

    const expires = screen.getByTestId('field-expiresAt');
    expect(within(expires).getByLabelText(/expires/i)).toBeInTheDocument();
    expect(
      within(expires).getByText('Leave blank if no specific deadline'),
    ).toBeInTheDocument();

    expect(
      within(screen.getByTestId('field-postedBy')).getByLabelText(/your name/i),
    ).toBeInTheDocument();
  });

  it('renders a "Post Item" submit button', () => {
    render(e(PostItem));
    expect(screen.getByRole('button', { name: 'Post Item' })).toBeInTheDocument();
  });
});

describe('@req REQ-CAP-FE-POST-FORM @criterion fe-post-02-required-field-indicators', () => {
  const REQUIRED_FIELDS = ['title', 'description', 'category', 'pickupLocation', 'postedBy'];
  const OPTIONAL_FIELDS = ['photo', 'expiresAt'];

  it('shows a red asterisk on every required field label', () => {
    render(e(PostItem));
    for (const name of REQUIRED_FIELDS) {
      const field = screen.getByTestId(`field-${name}`);
      const marker = within(field).getByTestId('required-marker');
      expect(marker).toHaveTextContent('*');
      // Red, per the text-danger design token (#b5292b).
      expect(marker).toHaveStyle({ color: 'rgb(181, 41, 43)' });
    }
  });

  it('shows "(optional)" and NO asterisk on optional field labels', () => {
    render(e(PostItem));
    for (const name of OPTIONAL_FIELDS) {
      const field = screen.getByTestId(`field-${name}`);
      expect(within(field).queryByTestId('required-marker')).toBeNull();
      expect(within(field).getByText(/\(optional\)/i)).toBeInTheDocument();
    }
  });
});
