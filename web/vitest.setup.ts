import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/react';

// Explicit unmount/cleanup after each test — RTL's own auto-cleanup relies on
// detecting global test-framework hooks, which isn't reliable without
// `test.globals: true` in vitest.config.ts. Doing it explicitly avoids
// leftover DOM from a prior test causing false "multiple elements found"
// failures in a later one (see test/components.test.tsx).
afterEach(() => {
  cleanup();
});
