import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.js'],
    globals: true,
    // Scoped to the frontend only - backend/tests/*.test.mjs are plain
    // Node scripts (run with `node`, not a test runner - see backend/
    // package.json's own convention) and must never be picked up here.
    include: ['src/**/*.test.{js,jsx}'],
    // A fake backend origin so lib/api.js's isApiConfigured/apiFetch
    // guards don't short-circuit in tests that mock global fetch -
    // no real network call is ever made against this value.
    env: { VITE_API_URL: 'http://backend.test' },
  },
});
