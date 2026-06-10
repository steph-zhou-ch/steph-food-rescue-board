// Vitest setup — registers @testing-library/jest-dom matchers
// (toBeInTheDocument, toHaveClass, …) and auto-cleans the DOM after
// each test so component trees never leak between specs.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
