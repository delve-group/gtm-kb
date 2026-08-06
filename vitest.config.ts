import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
    },
    hookTimeout: 15_000,
    testTimeout: 15_000,
  },
});
