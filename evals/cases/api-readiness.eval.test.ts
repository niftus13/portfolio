import { AddressInfo } from "node:net";

import { describe, expect, it } from "vitest";

import { createApp } from "../../apps/api/src/app.js";

describe("API readiness evaluation", () => {
  it("never reports ready when the database check fails", async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw new Error("database credentials must not be exposed");
      },
    });
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/health/ready`,
      );
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(body).toContain('"status":"not_ready"');
      expect(body).not.toContain("credentials");
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
