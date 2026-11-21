import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/experiments",
  outputDir: "./.playwright/experiment-set-results",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4174", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "pnpm dev --port 4174", url: "http://127.0.0.1:4174/fixtures/experiments/",
    reuseExistingServer: false, timeout: 30_000 },
});
