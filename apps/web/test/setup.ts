// Vitest setup for the web app: registers @testing-library/jest-dom
// matchers (toBeInTheDocument, toHaveTextContent, …) and tears down the
// rendered DOM between tests so each spec starts from a clean tree.
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});
