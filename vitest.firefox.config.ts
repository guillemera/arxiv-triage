import { defineConfig } from 'vitest/config';

/** Firefox checks through WebDriver (`npm run test:firefox`); Playwright cannot load extensions in Firefox. */
export default defineConfig({
  test: {
    include: ['tests/firefox/**/*.test.ts'],
    environment: 'node',
    testTimeout: 6 * 60_000,
    hookTimeout: 6 * 60_000,
    fileParallelism: false,
  },
});
