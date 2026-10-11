import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // SHACL validation of ~37k triples takes ~15 s locally and longer on CI runners.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
