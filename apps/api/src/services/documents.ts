import { randomUUID } from "node:crypto";

import type { PoolConnection } from "mysql2/promise";

import {
  DocumentRepository,
  type DocumentRow,
  type Organization,
} from "../repositories/documents.js";
import { AuthError } from "./auth.js";

export interface DocumentInput {
  title?: string;
  contentMd?: string;
  categoryId?: string | null;
}

class Denied extends AuthError {
  constructor(
    readonly tenantId: string,
    readonly userId: string,
    readonly action: string,
    readonly targetId: string | null,
  ) {
    super(403, "Forbidden");
  }
}

function documentResponse(row: DocumentRow) {
  return {
    id: row.id,
    title: row.title,
    contentMd: row.content_md,
    categoryId: row.category_id,
    contentVersion: row.content_version,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const notFound = () => new AuthError(404, "Not found");
const maxCounter = "18446744073709551615";

export class DocumentService {
  constructor(private readonly repository: DocumentRepository) {}

  async organizations(userId: string) {
    return (await this.repository.organizations(userId)).map(
      ({ slug, name, role }) => ({
        slug,
        name,
        role,
      }),
    );
  }

  private async organization(
    userId: string,
    slug: string,
    connection?: PoolConnection,
  ) {
    const organization = await this.repository.organization(
      userId,
      slug,
      connection,
    );
    if (!organization) throw notFound();
    return organization;
  }

  private async document(
    tenantId: string,
    id: string,
    connection?: PoolConnection,
  ) {
    const document = await this.repository.document(tenantId, id, connection);
    if (!document) throw notFound();
    return document;
  }

  private authorize(
    organization: Organization,
    userId: string,
    action: string,
    targetId: string | null,
  ) {
    if (organization.role === "viewer") {
      throw new Denied(organization.id, userId, action, targetId);
    }
  }

  private async recordDenial<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Denied) {
        const requestId = randomUUID();
        try {
          await this.repository.denied(
            error.tenantId,
            error.userId,
            error.action,
            error.targetId,
            requestId,
          );
        } catch (auditError) {
          console.error("Authorization denial audit failed", {
            requestId,
            code:
              typeof auditError === "object" &&
              auditError !== null &&
              "code" in auditError
                ? auditError.code
                : "UNKNOWN",
          });
        }
      }
      throw error;
    }
  }

  async list(userId: string, slug: string) {
    const organization = await this.organization(userId, slug);
    return (await this.repository.list(organization.id)).map(documentResponse);
  }

  async get(userId: string, slug: string, id: string) {
    const organization = await this.organization(userId, slug);
    return documentResponse(await this.document(organization.id, id));
  }

  async versions(userId: string, slug: string, id: string) {
    const organization = await this.organization(userId, slug);
    await this.document(organization.id, id);
    return (await this.repository.versions(organization.id, id)).map((row) => ({
      version: row.version,
      title: row.title,
      contentMd: row.content_md,
      categoryId: row.category_id,
      changeType: row.change_type,
      createdAt: row.created_at,
    }));
  }

  private async category(
    connection: PoolConnection,
    tenantId: string,
    id: string | null,
  ): Promise<string | null> {
    if (id === null) return null;
    const name = await this.repository.categoryName(connection, tenantId, id);
    if (name === undefined) throw notFound();
    return name;
  }

  async create(
    userId: string,
    slug: string,
    input: Required<Pick<DocumentInput, "title" | "contentMd">> & DocumentInput,
  ) {
    return this.recordDenial(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        this.authorize(organization, userId, "document.create", null);
        const categoryId = input.categoryId ?? null;
        const categoryName = await this.category(
          connection,
          organization.id,
          categoryId,
        );
        const id = randomUUID();
        await this.repository.insertDocument(
          connection,
          organization.id,
          userId,
          id,
          input.title,
          input.contentMd,
          categoryId,
        );
        const document = await this.document(organization.id, id, connection);
        await this.repository.insertVersion(
          connection,
          organization.id,
          userId,
          document,
          categoryName,
          "create",
        );
        return documentResponse(document);
      }),
    );
  }

  async update(
    userId: string,
    slug: string,
    id: string,
    expectedRevision: string,
    input: DocumentInput,
  ) {
    return this.recordDenial(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const current = await this.document(organization.id, id, connection);
        this.authorize(organization, userId, "document.update", id);
        if (current.revision !== expectedRevision)
          throw new AuthError(409, "Revision conflict");
        const title = input.title ?? current.title;
        const content = input.contentMd ?? current.content_md;
        const categoryId =
          input.categoryId === undefined
            ? current.category_id
            : input.categoryId;
        if (
          title === current.title &&
          content === current.content_md &&
          categoryId === current.category_id
        ) {
          return documentResponse(current);
        }
        if (
          current.revision === maxCounter ||
          current.content_version === maxCounter
        ) {
          throw new AuthError(409, "Revision limit reached");
        }
        const categoryName = await this.category(
          connection,
          organization.id,
          categoryId,
        );
        await this.repository.updateDocument(
          connection,
          organization.id,
          id,
          title,
          content,
          categoryId,
        );
        const updated = await this.document(organization.id, id, connection);
        await this.repository.insertVersion(
          connection,
          organization.id,
          userId,
          updated,
          categoryName,
          "update",
        );
        return documentResponse(updated);
      }),
    );
  }
}
