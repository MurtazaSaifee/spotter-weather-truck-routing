import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// The browser only ever talks to one origin: in dev (and `vite preview`) Vite
// forwards /api to Django, so no CORS configuration is needed anywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        // Another backend (say, a second checkout's) is one environment variable away.
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    rolldownOptions: {
      output: {
        // The map is one lazy chunk of nearly 2 MB. Split into the two libraries it is made of
        // so the browser fetches them side by side, and each is cached on its own across deploys.
        codeSplitting: {
          groups: [{ name: 'maplibre', test: /node_modules[\\/]maplibre-gl[\\/]/, priority: 20 }],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globalSetup: ['./src/test/globalSetup.ts'],
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Node 25 prints a `--localstorage-file` warning when the jsdom environment
    // touches the global localStorage. jsdom supplies its own, so switch Node's
    // Web Storage off (the flag exists on Node 22+, so it is safe on CI's Node 24).
    execArgv: ['--no-experimental-webstorage'],
  },
});
