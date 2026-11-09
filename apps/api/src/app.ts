import express from "express";

export interface AppDependencies {
  checkDatabase: () => Promise<void>;
}

export function createApp({ checkDatabase }: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.get("/health/ready", async (_request, response) => {
    try {
      await checkDatabase();
      response.status(200).json({ status: "ready", database: "connected" });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : "UNKNOWN";
      console.error("Database readiness check failed", { code });
      response.status(503).json({
        status: "not_ready",
        database: "unavailable",
      });
    }
  });

  return app;
}
