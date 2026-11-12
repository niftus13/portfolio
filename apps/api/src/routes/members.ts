import { Router } from "express";

import { AuthError, type AuthService } from "../services/auth.js";
import type { MemberService } from "../services/members.js";
import { requireUser } from "./auth.js";
import { identifier, isRecord, slug } from "./documents.js";

export function createMemberRouter(auth: AuthService, members: MemberService) {
  const router = Router();
  router.get("/orgs/:slug/members", async (request, response) => {
    response.json({
      members: await members.list(
        await requireUser(auth, request),
        slug(request.params.slug),
      ),
    });
  });
  router.patch("/orgs/:slug/members/:id", async (request, response) => {
    const userId = await requireUser(auth, request, true);
    const body: unknown = request.body;
    if (
      !isRecord(body) ||
      Object.keys(body).some((key) => key !== "role" && key !== "status") ||
      (body.role !== "admin" &&
        body.role !== "editor" &&
        body.role !== "viewer") ||
      (body.status !== "active" && body.status !== "inactive")
    )
      throw new AuthError(400, "Invalid input");
    response.json({
      member: await members.update(
        userId,
        slug(request.params.slug),
        identifier(request.params.id),
        body.role,
        body.status,
      ),
    });
  });
  router.get("/orgs/:slug/audit-events", async (request, response) => {
    response.json({
      events: await members.auditEvents(
        await requireUser(auth, request),
        slug(request.params.slug),
      ),
    });
  });
  return router;
}
