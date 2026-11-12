import { Router, type Request } from "express";

import { containsControlCharacters } from "../identity/auth-input.js";
import { AuthError, type AuthService } from "../services/auth.js";
import { DocumentService, type DocumentInput } from "../services/documents.js";
import { cookie } from "./auth.js";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxCounter = 18446744073709551615n;

function identifier(value: string): string {
  if (!uuid.test(value)) throw new AuthError(400, "Invalid input");
  return value;
}

function slug(value: string): string {
  if (
    !value ||
    Array.from(value).length > 100 ||
    /[\uD800-\uDFFF]/u.test(value) ||
    containsControlCharacters(value)
  ) {
    throw new AuthError(400, "Invalid input");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function revision(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,19}$/.test(value) ||
    BigInt(value) > maxCounter
  ) {
    throw new AuthError(400, "Invalid input");
  }
  return value;
}

function restoreInput(
  value: unknown,
  allowCategory: boolean,
): { expectedRevision: string; categoryId?: string | null } {
  if (
    !isRecord(value) ||
    Object.keys(value).some(
      (key) =>
        key !== "expectedRevision" && !(allowCategory && key === "categoryId"),
    )
  ) {
    throw new AuthError(400, "Invalid input");
  }
  const expectedRevision = revision(value.expectedRevision);
  if (!("categoryId" in value)) return { expectedRevision };
  if (
    value.categoryId !== null &&
    (typeof value.categoryId !== "string" || !uuid.test(value.categoryId))
  ) {
    throw new AuthError(400, "Invalid input");
  }
  return { expectedRevision, categoryId: value.categoryId };
}

function categoryInput(value: unknown): string {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== "name") ||
    typeof value.name !== "string" ||
    /[\uD800-\uDFFF]/u.test(value.name) ||
    containsControlCharacters(value.name)
  ) {
    throw new AuthError(400, "Invalid input");
  }
  const name = value.name.trim();
  if (!name || Array.from(name).length > 100)
    throw new AuthError(400, "Invalid input");
  return name;
}

function input(
  value: unknown,
  update: boolean,
): DocumentInput & { expectedRevision?: string } {
  if (!isRecord(value)) throw new AuthError(400, "Invalid input");
  const body = value;
  const keys = update
    ? ["title", "contentMd", "categoryId", "expectedRevision"]
    : ["title", "contentMd", "categoryId"];
  if (Object.keys(body).some((key) => !keys.includes(key)))
    throw new AuthError(400, "Invalid input");
  const result: DocumentInput & { expectedRevision?: string } = {};
  if ("title" in body) {
    if (
      typeof body.title !== "string" ||
      /[\uD800-\uDFFF]/u.test(body.title) ||
      containsControlCharacters(body.title)
    )
      throw new AuthError(400, "Invalid input");
    result.title = body.title.trim();
    if (!result.title || Array.from(result.title).length > 255)
      throw new AuthError(400, "Invalid input");
  }
  if ("contentMd" in body) {
    if (
      typeof body.contentMd !== "string" ||
      /[\uD800-\uDFFF]/u.test(body.contentMd)
    )
      throw new AuthError(400, "Invalid input");
    result.contentMd = body.contentMd;
  }
  if ("categoryId" in body) {
    if (
      body.categoryId !== null &&
      (typeof body.categoryId !== "string" || !uuid.test(body.categoryId))
    )
      throw new AuthError(400, "Invalid input");
    result.categoryId = body.categoryId;
  }
  if (update) {
    if (
      typeof body.expectedRevision !== "string" ||
      !/^[1-9][0-9]{0,19}$/.test(body.expectedRevision) ||
      BigInt(body.expectedRevision) > maxCounter ||
      !("title" in body || "contentMd" in body || "categoryId" in body)
    )
      throw new AuthError(400, "Invalid input");
    result.expectedRevision = body.expectedRevision;
  } else if (result.title === undefined || result.contentMd === undefined) {
    throw new AuthError(400, "Invalid input");
  }
  return result;
}

export function createDocumentRouter(
  auth: AuthService,
  documents: DocumentService,
) {
  const router = Router();
  async function user(request: Request, write = false): Promise<string> {
    const sessionToken = cookie(request, "portfolio_session");
    const session = await auth.session(sessionToken);
    if (!session) throw new AuthError(401, "Authentication required");
    if (write)
      await auth.requireCsrf(
        sessionToken,
        undefined,
        request.get("X-CSRF-Token"),
      );
    return session.user.id;
  }

  router.get("/orgs", async (request, response) => {
    response.json({
      organizations: await documents.organizations(await user(request)),
    });
  });
  router.get("/orgs/:slug/documents", async (request, response) => {
    const userId = await user(request);
    response.json({
      documents: await documents.list(userId, slug(request.params.slug)),
    });
  });
  router.post("/orgs/:slug/documents", async (request, response) => {
    const userId = await user(request, true);
    const data = input(request.body, false);
    if (data.title === undefined || data.contentMd === undefined)
      throw new AuthError(400, "Invalid input");
    response.status(201).json({
      document: await documents.create(userId, slug(request.params.slug), {
        ...data,
        title: data.title,
        contentMd: data.contentMd,
      }),
    });
  });
  router.get(
    "/orgs/:slug/documents/:id/versions",
    async (request, response) => {
      const userId = await user(request);
      response.json({
        versions: await documents.versions(
          userId,
          slug(request.params.slug),
          identifier(request.params.id),
        ),
      });
    },
  );
  router.get("/orgs/:slug/documents/:id", async (request, response) => {
    const userId = await user(request);
    response.json({
      document: await documents.get(
        userId,
        slug(request.params.slug),
        identifier(request.params.id),
      ),
    });
  });
  router.patch("/orgs/:slug/documents/:id", async (request, response) => {
    const userId = await user(request, true);
    const data = input(request.body, true);
    if (!data.expectedRevision) throw new AuthError(400, "Invalid input");
    response.json({
      document: await documents.update(
        userId,
        slug(request.params.slug),
        identifier(request.params.id),
        data.expectedRevision,
        data,
      ),
    });
  });
  router.get("/orgs/:slug/categories", async (request, response) => {
    const userId = await user(request);
    response.json({
      categories: await documents.categories(userId, slug(request.params.slug)),
    });
  });
  router.post("/orgs/:slug/categories", async (request, response) => {
    const userId = await user(request, true);
    response.status(201).json({
      category: await documents.createCategory(
        userId,
        slug(request.params.slug),
        categoryInput(request.body),
      ),
    });
  });
  router.patch("/orgs/:slug/categories/:id", async (request, response) => {
    const userId = await user(request, true);
    response.json({
      category: await documents.changeCategory(
        userId,
        slug(request.params.slug),
        identifier(request.params.id),
        "rename",
        categoryInput(request.body),
      ),
    });
  });
  router.delete("/orgs/:slug/categories/:id", async (request, response) => {
    const userId = await user(request, true);
    await documents.changeCategory(
      userId,
      slug(request.params.slug),
      identifier(request.params.id),
      "delete",
    );
    response.status(204).end();
  });
  router.post(
    "/orgs/:slug/categories/:id/restore",
    async (request, response) => {
      const userId = await user(request, true);
      response.json({
        category: await documents.changeCategory(
          userId,
          slug(request.params.slug),
          identifier(request.params.id),
          "restore",
        ),
      });
    },
  );
  router.delete("/orgs/:slug/documents/:id", async (request, response) => {
    const userId = await user(request, true);
    const data = restoreInput(request.body, false);
    await documents.delete(
      userId,
      slug(request.params.slug),
      identifier(request.params.id),
      data.expectedRevision,
    );
    response.status(204).end();
  });
  router.get("/orgs/:slug/trash", async (request, response) => {
    const userId = await user(request);
    response.json({
      documents: await documents.trash(userId, slug(request.params.slug)),
    });
  });
  router.post("/orgs/:slug/trash/:id/restore", async (request, response) => {
    const userId = await user(request, true);
    const data = restoreInput(request.body, true);
    response.json({
      document: await documents.restoreTrash(
        userId,
        slug(request.params.slug),
        identifier(request.params.id),
        data.expectedRevision,
        data.categoryId,
      ),
    });
  });
  router.post(
    "/orgs/:slug/documents/:id/versions/:version/restore",
    async (request, response) => {
      const userId = await user(request, true);
      const data = restoreInput(request.body, true);
      response.json({
        document: await documents.restoreVersion(
          userId,
          slug(request.params.slug),
          identifier(request.params.id),
          revision(request.params.version),
          data.expectedRevision,
          data.categoryId,
        ),
      });
    },
  );
  return router;
}
