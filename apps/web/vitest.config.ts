import { defineConfig } from "vitest/config";

// Kept deliberately light: one worker, files run one after another (low-memory laptop).
// Only the pure modules are unit-tested here; the browser is covered by one Playwright smoke test.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
  },
});
