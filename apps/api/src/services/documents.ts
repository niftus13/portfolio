import { randomUUID } from "node:crypto";

import type { PoolConnection } from "mysql2/promise";

import {
  DocumentRepository,
  type DocumentRow,
  type Organization,
} from "../repositories/documents.js";
import { AuthError } from "./auth.js";
import { Denied, recordDenial } from "./authorization.js";

export interface DocumentInput {
  title?: string;
  contentMd?: string;
  categoryId?: string | null;
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
const isDeleted = (value: number | string) => value === 1 || value === "1";

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
    deleted = false,
  ) {
    const document = await this.repository.document(
      tenantId,
      id,
      connection,
      deleted,
    );
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

  private authorizeManager(
    organization: Organization,
    userId: string,
    action: string,
    targetId: string | null,
  ) {
    if (organization.role !== "owner" && organization.role !== "admin") {
      throw new Denied(organization.id, userId, action, targetId);
    }
  }

  private async recordDenial<T>(work: () => Promise<T>): Promise<T> {
    return recordDenial(this.repository, work);
  }

  async list(userId: string, slug: string) {
    const organization = await this.organization(userId, slug);
    return (await this.repository.list(organization.id)).map(documentResponse);
  }

  async search(
    userId: string,
    slug: string,
    query: string,
    limit: number,
    offset: number,
  ) {
    const organization = await this.organization(userId, slug);
    return (
      await this.repository.search(organization.id, query, limit, offset)
    ).map(documentResponse);
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

  async categories(userId: string, slug: string) {
    const organization = await this.organization(userId, slug);
    return (await this.repository.categories(organization.id)).map((row) => ({
      id: row.id,
      name: row.name,
      deleted: isDeleted(row.deleted),
    }));
  }

  private async categoryMutation<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await this.recordDenial(work);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ER_DUP_ENTRY" &&
        "message" in error &&
        typeof error.message === "string" &&
        error.message.includes("uq_categories_tenant_name_key")
      ) {
        throw new AuthError(409, "Category name already reserved");
      }
      throw error;
    }
  }

  async createCategory(userId: string, slug: string, name: string) {
    return this.categoryMutation(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        this.authorizeManager(organization, userId, "category.create", null);
        const id = randomUUID();
        const key = name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
        await this.repository.createCategory(
          connection,
          organization.id,
          id,
          name,
          key,
        );
        return { id, name, deleted: false };
      }),
    );
  }

  async changeCategory(
    userId: string,
    slug: string,
    id: string,
    action: "rename" | "delete" | "restore",
    name?: string,
  ) {
    return this.categoryMutation(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const category = await this.repository.category(
          connection,
          organization.id,
          id,
        );
        if (!category || isDeleted(category.deleted) !== (action === "restore"))
          throw notFound();
        this.authorizeManager(organization, userId, `category.${action}`, id);
        if (action === "rename") {
          if (name === undefined)
            throw new Error("Missing validated category name");
          const key = name.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
          await this.repository.renameCategory(
            connection,
            organization.id,
            id,
            name,
            key,
          );
          return { id, name, deleted: false };
        }
        if (
          action === "delete" &&
          (await this.repository.categoryInUse(connection, organization.id, id))
        ) {
          throw new AuthError(409, "Category is in use");
        }
        await this.repository.setCategoryDeleted(
          connection,
          organization.id,
          id,
          action === "delete",
        );
        return { id, name: category.name, deleted: action === "delete" };
      }),
    );
  }

  async trash(userId: string, slug: string) {
    return this.recordDenial(async () => {
      const organization = await this.organization(userId, slug);
      this.authorizeManager(organization, userId, "trash.list", null);
      return (await this.repository.trash(organization.id)).map(
        documentResponse,
      );
    });
  }

  private checkRevision(
    document: DocumentRow,
    expectedRevision: string,
    contentChange: boolean,
  ) {
    if (document.revision !== expectedRevision)
      throw new AuthError(409, "Revision conflict");
    if (
      document.revision === maxCounter ||
      (contentChange && document.content_version === maxCounter)
    ) {
      throw new AuthError(409, "Revision limit reached");
    }
  }

  async delete(
    userId: string,
    slug: string,
    id: string,
    expectedRevision: string,
  ) {
    return this.recordDenial(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const document = await this.document(organization.id, id, connection);
        this.authorizeManager(organization, userId, "document.delete", id);
        this.checkRevision(document, expectedRevision, false);
        await this.repository.deleteDocument(
          connection,
          organization.id,
          id,
          userId,
        );
      }),
    );
  }

  async restoreTrash(
    userId: string,
    slug: string,
    id: string,
    expectedRevision: string,
    categoryId?: string | null,
  ) {
    return this.recordDenial(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const document = await this.document(
          organization.id,
          id,
          connection,
          true,
        );
        this.authorizeManager(organization, userId, "trash.restore", id);
        const nextCategory =
          categoryId === undefined ? document.category_id : categoryId;
        const changed = nextCategory !== document.category_id;
        this.checkRevision(document, expectedRevision, changed);
        const categoryName = await this.category(
          connection,
          organization.id,
          nextCategory,
        );
        await this.repository.restoreTrash(
          connection,
          organization.id,
          id,
          nextCategory,
          changed,
        );
        const restored = await this.document(organization.id, id, connection);
        if (changed)
          await this.repository.insertVersion(
            connection,
            organization.id,
            userId,
            restored,
            categoryName,
            "trash_restore",
          );
        return documentResponse(restored);
      }),
    );
  }

  async restoreVersion(
    userId: string,
    slug: string,
    id: string,
    version: string,
    expectedRevision: string,
    categoryId?: string | null,
  ) {
    return this.recordDenial(() =>
      this.repository.transaction(async (connection) => {
        const organization = await this.organization(userId, slug, connection);
        const document = await this.document(organization.id, id, connection);
        const original = await this.repository.version(
          connection,
          organization.id,
          id,
          version,
        );
        if (!original) throw notFound();
        this.authorize(organization, userId, "document.restore", id);
        this.checkRevision(document, expectedRevision, true);
        const nextCategory =
          categoryId === undefined ? original.category_id : categoryId;
        const categoryName = await this.category(
          connection,
          organization.id,
          nextCategory,
        );
        await this.repository.updateDocument(
          connection,
          organization.id,
          id,
          original.title,
          original.content_md,
          nextCategory,
        );
        const restored = await this.document(organization.id, id, connection);
        await this.repository.insertVersion(
          connection,
          organization.id,
          userId,
          restored,
          categoryName,
          "restore",
          version,
        );
        return documentResponse(restored);
      }),
    );
  }
}
