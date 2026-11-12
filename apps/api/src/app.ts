import express, { type ErrorRequestHandler } from "express";

import { createAuthRouter, sendAuthError } from "./routes/auth.js";
import { createDocumentRouter } from "./routes/documents.js";
import { AuthError, type AuthService } from "./services/auth.js";
import type { DocumentService } from "./services/documents.js";

export interface AppDependencies {
  checkDatabase: () => Promise<void>;
  auth?: {
    service: AuthService;
    allowedOrigin: string;
    secure: boolean;
    trustProxy: string | false;
  };
  documents?: DocumentService;
}

export function createApp({ checkDatabase, auth, documents }: AppDependencies) {
  const app = express();

  app.disable("x-powered-by");
  if (auth) app.set("trust proxy", auth.trustProxy);
  app.use("/api/v1", (_request, response, next) => {
    response.set("Cache-Control", "no-store");
    next();
  });
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

  if (auth) {
    app.use("/api/v1", (request, _response, next) => {
      if (
        request.method !== "GET" &&
        request.headers.origin !== auth.allowedOrigin
      ) {
        next(new AuthError(403, "Invalid Origin"));
        return;
      }
      next();
    });
    app.use("/api/v1", createAuthRouter(auth.service, auth.secure));
    if (documents)
      app.use("/api/v1", createDocumentRouter(auth.service, documents));
  }
  const errorHandler: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) {
      next(error);
      return;
    }
    sendAuthError(error, response);
  };
  app.use(errorHandler);

  return app;
}
