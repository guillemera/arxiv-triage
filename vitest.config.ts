import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __E2E__: 'false', __FAKE_EMBEDDER__: 'false' },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'jsdom',
  },
});
