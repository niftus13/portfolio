import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("API production build", () => {
  it("emits a runnable server entry point and its local modules", () => {
    const output = mkdtempSync(resolve("apps/api/.test-build-"));

    try {
      execFileSync(
        process.execPath,
        [
          "node_modules/typescript/bin/tsc",
          "--project",
          "apps/api/tsconfig.json",
          "--outDir",
          output,
        ],
        { stdio: "pipe" },
      );

      for (const file of ["index.js", "app.js", "config.js", "database.js"]) {
        expect(readFileSync(join(output, file), "utf8").length).toBeGreaterThan(
          0,
        );
      }

      const imported = execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(join(output, "app.js"))})`,
        ],
        { encoding: "utf8" },
      );
      expect(imported).toBe("");
    } finally {
      rmSync(output, { recursive: true, force: true });
    }
  }, 30_000);
});
