import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Each test file starts its own in-process Postgres (PGlite); with many files in parallel the
    // first test of a file can take several seconds.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
