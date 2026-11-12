import { Router, type Request, type Response } from "express";

import { parseLoginInput, parseSignupInput } from "../identity/auth-input.js";
import { AuthError, AuthService } from "../services/auth.js";

const sessionCookie = "portfolio_session";
const preauthCookie = "portfolio_preauth";

function cookie(request: Request, name: string): string | undefined {
  const entries = (request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim());
  const matching = entries.filter((entry) => entry.startsWith(`${name}=`));
  return matching.length === 1 ? matching[0].slice(name.length + 1) : undefined;
}

function clientIp(request: Request): string {
  if (!request.ip) throw new Error("Client IP is unavailable");
  return request.ip;
}

export function createAuthRouter(
  service: AuthService,
  allowedOrigin: string,
  secure: boolean,
) {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
  };

  router.use((request, response, next) => {
    response.set("Cache-Control", "no-store");
    if (request.method !== "GET" && request.headers.origin !== allowedOrigin) {
      next(new AuthError(403, "Invalid Origin"));
      return;
    }
    next();
  });

  router.get("/csrf-token", async (request, response) => {
    const result = await service.csrf(
      cookie(request, sessionCookie),
      cookie(request, preauthCookie),
    );
    if (result.preauthToken) {
      response.cookie(preauthCookie, result.preauthToken, {
        ...cookieOptions,
        maxAge: 30 * 60 * 1000,
      });
    }
    response.json({ csrfToken: result.csrfToken });
  });

  async function checkCsrf(request: Request) {
    return service.requireCsrf(
      cookie(request, sessionCookie),
      cookie(request, preauthCookie),
      request.get("X-CSRF-Token"),
    );
  }

  router.post("/auth/signup", async (request, response) => {
    await checkCsrf(request);
    const input = parseSignupInput(request.body);
    if (!input) {
      await service.invalidAttempt(clientIp(request), true);
      throw new AuthError(400, "Invalid input");
    }
    const id = await service.signup(input, clientIp(request));
    response.status(201).json({ id });
  });

  router.post("/auth/login", async (request, response) => {
    const currentSession = await checkCsrf(request);
    if (currentSession) throw new AuthError(409, "Already authenticated");
    const input = parseLoginInput(request.body);
    if (!input) {
      await service.invalidAttempt(clientIp(request), false);
      throw new AuthError(400, "Invalid input");
    }
    const result = await service.login(
      input,
      clientIp(request),
      cookie(request, preauthCookie),
      request.get("X-CSRF-Token"),
    );
    const hasOrganizations = await service.hasOrganizations(result.user.id);
    response.clearCookie(preauthCookie, cookieOptions);
    response.cookie(sessionCookie, result.sessionToken, {
      ...cookieOptions,
      maxAge: 24 * 60 * 60 * 1000,
    });
    response.json({
      user: result.user,
      csrfToken: result.csrfToken,
      hasOrganizations,
    });
  });

  router.get("/auth/me", async (request, response) => {
    const session = await service.session(cookie(request, sessionCookie));
    if (!session) throw new AuthError(401, "Authentication required");
    response.json({
      user: session.user,
      hasOrganizations: await service.hasOrganizations(session.user.id),
    });
  });

  router.post("/auth/logout", async (request, response) => {
    if (!(await service.session(cookie(request, sessionCookie)))) {
      throw new AuthError(401, "Authentication required");
    }
    const session = await checkCsrf(request);
    if (!session) throw new AuthError(401, "Authentication required");
    await service.logout(session);
    response.clearCookie(sessionCookie, cookieOptions);
    response.status(204).end();
  });

  return router;
}

export function sendAuthError(error: unknown, response: Response): void {
  if (error instanceof AuthError) {
    if (error.retryAfter) response.set("Retry-After", String(error.retryAfter));
    response.status(error.status).json({ error: error.message });
    return;
  }
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : 500;
  if (status === 400 || status === 413 || status === 415) {
    response.status(status).json({ error: "Invalid request body" });
    return;
  }
  console.error("API request failed", {
    code:
      typeof error === "object" && error !== null && "code" in error
        ? error.code
        : "UNKNOWN",
  });
  response.status(500).json({ error: "Internal server error" });
}
