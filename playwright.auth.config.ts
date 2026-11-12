import { isAbsolute } from "node:path";

import { defineConfig, devices } from "@playwright/test";

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required test environment variable: ${name}`);
  return value;
}

const database = required("TEST_DB_NAME");
if (!/^portfolio_test_[a-z0-9_]+$/.test(database)) {
  throw new Error("TEST_DB_NAME must start with portfolio_test_");
}
const log = required("AUTH_E2E_LOG");
if (!isAbsolute(log)) throw new Error("AUTH_E2E_LOG must be an absolute path");

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: ["auth-real.spec.ts", "documents-real.spec.ts"],
  globalSetup: "./tests/e2e/auth.setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3002",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @portfolio/api exec tsx src/index.ts",
      url: "http://127.0.0.1:4002/health/ready",
      reuseExistingServer: false,
      env: {
        HOST: "127.0.0.1",
        PORT: "4002",
        DB_HOST: required("TEST_DB_HOST"),
        DB_PORT: required("TEST_DB_PORT"),
        DB_USER: required("TEST_DB_USER"),
        DB_PASSWORD: required("TEST_DB_PASSWORD"),
        DB_NAME: database,
        AUTH_ALLOWED_ORIGIN: "http://127.0.0.1:3002",
        AUTH_TRUST_PROXY: "loopback",
        AUTH_AUDIT_FAILURE_LOG: log,
      },
    },
    {
      command:
        "pnpm --filter @portfolio/webs build && pnpm --filter @portfolio/webs start",
      url: "http://127.0.0.1:3002",
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        HOST: "127.0.0.1",
        PORT: "3002",
        NUXT_API_INTERNAL_URL: "http://127.0.0.1:4002",
      },
    },
  ],
});
