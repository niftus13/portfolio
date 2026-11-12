import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/integration/mysql/**/*.test.ts"],
    testTimeout: 30_000,
    fileParallelism: false,
  },
});
