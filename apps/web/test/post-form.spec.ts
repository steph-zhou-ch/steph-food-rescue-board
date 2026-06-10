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

describe('@req REQ-CAP-FE-POST-FORM @criterion fe-post-03-character-count-live', () => {
  it('updates the title counter live as the user types', () => {
    render(e(PostItem));
    const title = screen.getByTestId('field-title');
    const input = within(title).getByLabelText(/title/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'Hello' } });
    expect(within(title).getByTestId('counter-title')).toHaveTextContent('5/100');

    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(within(title).getByTestId('counter-title')).toHaveTextContent('11/100');
  });

  it('updates the description counter live as the user types', () => {
    render(e(PostItem));
    const description = screen.getByTestId('field-description');
    const input = within(description).getByLabelText(/description/i) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'Twelve bagels' } });
    expect(within(description).getByTestId('counter-description')).toHaveTextContent('13/500');
  });

  it('prevents typing past the 100-char title limit and turns the counter red', () => {
    render(e(PostItem));
    const title = screen.getByTestId('field-title');
    const input = within(title).getByLabelText(/title/i) as HTMLInputElement;

    fireEvent.change(input, { target: { value: 'a'.repeat(150) } });

    // Value clamped at the limit — not the 150 chars the user attempted.
    expect(input.value).toHaveLength(100);
    const counter = within(title).getByTestId('counter-title');
    expect(counter).toHaveTextContent('100/100');
    expect(counter).toHaveStyle({ color: 'rgb(181, 41, 43)' });
  });

  it('prevents typing past the 500-char description limit and turns the counter red', () => {
    render(e(PostItem));
    const description = screen.getByTestId('field-description');
    const input = within(description).getByLabelText(/description/i) as HTMLTextAreaElement;

    fireEvent.change(input, { target: { value: 'b'.repeat(600) } });

    expect(input.value).toHaveLength(500);
    const counter = within(description).getByTestId('counter-description');
    expect(counter).toHaveTextContent('500/500');
    expect(counter).toHaveStyle({ color: 'rgb(181, 41, 43)' });
  });
});

describe('@req REQ-CAP-FE-POST-FORM @criterion fe-post-04-submits-and-navigates', () => {
  function fillRequired() {
    fireEvent.change(within(screen.getByTestId('field-title')).getByLabelText(/title/i), {
      target: { value: '12 bagels' },
    });
    fireEvent.change(
      within(screen.getByTestId('field-description')).getByLabelText(/description/i),
      { target: { value: 'Fresh this morning' } },
    );
    fireEvent.change(
      within(screen.getByTestId('field-pickupLocation')).getByLabelText(/pickup location/i),
      { target: { value: '5th & Main' } },
    );
    fireEvent.change(within(screen.getByTestId('field-postedBy')).getByLabelText(/your name/i), {
      target: { value: 'Corner Cafe' },
    });
  }

  it('POSTs to /api/items and navigates to the feed on 201', async () => {
    const onNavigate = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      ok: true,
      json: async () => ({ id: 'uuid-1', status: 'available', createdAt: '2026-06-10T00:00:00Z' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(e(PostItem, { onNavigate }));
    fillRequired();
    fireEvent.click(screen.getByRole('button', { name: 'Post Item' }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/items');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      title: '12 bagels',
      description: 'Fresh this morning',
      category: 'food',
      pickupLocation: '5th & Main',
      postedBy: 'Corner Cafe',
    });

    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/'));
  });

  it('does NOT submit when required fields are empty and shows validation', () => {
    const onNavigate = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    render(e(PostItem, { onNavigate }));
    fireEvent.click(screen.getByRole('button', { name: 'Post Item' }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('disables the submit button while the request is in flight (no double submit)', async () => {
    const onNavigate = vi.fn();
    let resolveFetch: (value: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(e(PostItem, { onNavigate }));
    fillRequired();
    const button = screen.getByRole('button', { name: 'Post Item' });
    fireEvent.click(button);

    await vi.waitFor(() => expect(button).toBeDisabled());

    // A second click while in flight must not fire another request.
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({
      status: 201,
      ok: true,
      json: async () => ({ id: 'uuid-2', status: 'available', createdAt: '2026-06-10T00:00:00Z' }),
    });
    await vi.waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/'));
  });
});
