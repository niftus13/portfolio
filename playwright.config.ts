import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "node tests/e2e/mock-api.mjs",
      url: "http://127.0.0.1:4001/health/ready",
      reuseExistingServer: false,
    },
    {
      command: "pnpm --filter @portfolio/webs dev",
      url: "http://127.0.0.1:3000",
      reuseExistingServer: false,
      env: {
        HOST: "127.0.0.1",
        NUXT_API_INTERNAL_URL: "http://127.0.0.1:4001",
        PORT: "3000",
      },
    },
  ],
});
