// Minimal inline SVG icon set for the rescue-board detail view. Each
// icon is sized via the `size` prop (default 16px) and inherits the
// surrounding text color via `stroke="currentColor"` unless overridden.
import { createElement as e } from 'react';
import type { ReactElement } from 'react';

interface IconProps {
  size?: number;
  testId?: string;
  color?: string;
}

function svg(
  testId: string,
  children: ReactElement | ReactElement[],
  { size = 16, color = 'currentColor' }: IconProps,
): ReactElement {
  return e(
    'svg',
    {
      'data-testid': testId,
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: color,
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': true,
    },
    children,
  );
}

export function CheckIcon(props: IconProps): ReactElement {
  return svg('icon-check', e('polyline', { points: '20 6 9 17 4 12' }), props);
}

export function UndoIcon(props: IconProps): ReactElement {
  return svg(
    'icon-undo',
    [
      e('path', { key: 'p', d: 'M3 7v6h6' }),
      e('path', { key: 'a', d: 'M3 13a9 9 0 1 0 3-7.7L3 8' }),
    ],
    props,
  );
}

export function ArrowLeftIcon(props: IconProps): ReactElement {
  return svg(
    'icon-arrow-left',
    [
      e('line', { key: 'l', x1: 19, y1: 12, x2: 5, y2: 12 }),
      e('polyline', { key: 'p', points: '12 19 5 12 12 5' }),
    ],
    props,
  );
}

export function MapPinIcon(props: IconProps): ReactElement {
  return svg(
    'icon-map-pin',
    [
      e('path', { key: 'p', d: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z' }),
      e('circle', { key: 'c', cx: 12, cy: 10, r: 3 }),
    ],
    props,
  );
}

export function UserIcon(props: IconProps): ReactElement {
  return svg(
    'icon-user',
    [
      e('path', { key: 'p', d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
      e('circle', { key: 'c', cx: 12, cy: 7, r: 4 }),
    ],
    props,
  );
}

export function ClockIcon(props: IconProps): ReactElement {
  return svg(
    'icon-clock',
    [
      e('circle', { key: 'c', cx: 12, cy: 12, r: 10 }),
      e('polyline', { key: 'p', points: '12 6 12 12 16 14' }),
    ],
    props,
  );
}

export function CalendarIcon(props: IconProps): ReactElement {
  return svg(
    'icon-calendar',
    [
      e('rect', { key: 'r', x: 3, y: 4, width: 18, height: 18, rx: 2 }),
      e('line', { key: 'l1', x1: 16, y1: 2, x2: 16, y2: 6 }),
      e('line', { key: 'l2', x1: 8, y1: 2, x2: 8, y2: 6 }),
      e('line', { key: 'l3', x1: 3, y1: 10, x2: 21, y2: 10 }),
    ],
    props,
  );
}

export function HandIcon(props: IconProps): ReactElement {
  return svg(
    'icon-hand',
    e('path', {
      d: 'M18 11V6a2 2 0 0 0-4 0v5m0-2V4a2 2 0 0 0-4 0v7m0-1V5a2 2 0 0 0-4 0v9',
    }),
    props,
  );
}
