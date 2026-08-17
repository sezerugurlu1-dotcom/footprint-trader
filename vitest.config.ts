import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: false,
    coverage: {
      provider: 'v8',
      include: ['src/utils/footprint.ts'],
    },
  },
});
