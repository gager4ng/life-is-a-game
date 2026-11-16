import { defineConfig } from "vitest/config";

// Kept deliberately light: one worker, files run one after another (low-memory laptop).
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    pool: "forks",
    maxWorkers: 1,
    fileParallelism: false,
    isolate: false,
  },
});
