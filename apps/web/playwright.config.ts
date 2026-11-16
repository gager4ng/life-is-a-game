import { defineConfig, devices } from "@playwright/test";

// One browser, one worker, against the production build: light enough for a low-memory laptop.
export default defineConfig({
  testDir: "e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    ...devices["Pixel 7"],
    browserName: "chromium",
  },
  webServer: {
    command: "pnpm exec vite build --logLevel warn && pnpm exec vite preview",
    url: "http://localhost:4173",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
