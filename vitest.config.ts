import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // PGlite starts a WASM Postgres per test file and one test streams a 100 MB file; keep the load modest
    // and leave room for a busy machine.
    maxWorkers: 2,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
