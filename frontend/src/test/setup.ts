import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

// jsdom has no matchMedia. MUI X picks its desktop picker (typed fields and a popover)
// on a fine pointer, so report one rather than falling back to the touch dialog.
window.matchMedia = (query: string): MediaQueryList => ({
  matches: query.includes('(pointer: fine)'),
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
});

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  // Testing Library only auto-cleans when vitest globals are enabled.
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
