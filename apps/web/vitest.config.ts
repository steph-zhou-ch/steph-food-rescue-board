import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// REQ-CAP-FE-BROWSE-FEED :: integration-level component tests run in a
// jsdom DOM environment with Testing Library matchers. Tests live under
// apps/web/test/**.spec.ts(x) and render real components.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.spec.{ts,tsx}', 'src/**/*.spec.{ts,tsx}'],
  },
});
