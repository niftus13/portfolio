import { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../apps/api/src/app.js";

describe("API health endpoints", () => {
  let baseUrl: string;
  let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

  beforeAll(async () => {
    server = createApp({ checkDatabase: async () => {} }).listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it("reports liveness without requiring a database check", async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("reports readiness when MySQL is reachable", async () => {
    const response = await fetch(`${baseUrl}/health/ready`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: "ready",
      database: "connected",
    });
  });

  it("returns an unavailable status without leaking database errors", async () => {
    const app = createApp({
      checkDatabase: async () => {
        throw Object.assign(new Error("private connection details"), {
          code: "ECONNREFUSED",
        });
      },
    });
    const readinessServer = app.listen(0);
    await new Promise<void>((resolve) =>
      readinessServer.once("listening", resolve),
    );
    const address = readinessServer.address() as AddressInfo;
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/health/ready`,
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        status: "not_ready",
        database: "unavailable",
      });
      expect(logError).toHaveBeenCalledWith("Database readiness check failed", {
        code: "ECONNREFUSED",
      });
    } finally {
      logError.mockRestore();
      await new Promise<void>((resolve, reject) => {
        readinessServer.close((closeError) =>
          closeError ? reject(closeError) : resolve(),
        );
      });
    }
  });
});
