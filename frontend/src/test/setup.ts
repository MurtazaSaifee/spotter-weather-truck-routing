import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './server';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  // Testing Library only auto-cleans when vitest globals are enabled.
  cleanup();
  server.resetHandlers();
});

afterAll(() => server.close());
