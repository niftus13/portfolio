import { randomUUID } from "node:crypto";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

export type Role = "owner" | "admin" | "editor" | "viewer";
type Executor = Pool | PoolConnection;

export interface Organization extends RowDataPacket {
  id: string;
  slug: string;
  name: string;
  role: Role;
}

export interface DocumentRow extends RowDataPacket {
  id: string;
  title: string;
  content_md: string;
  category_id: string | null;
  content_version: string;
  revision: string;
  created_at: string;
  updated_at: string;
}

export interface VersionRow extends RowDataPacket {
  version: string;
  title: string;
  content_md: string;
  category_id: string | null;
  change_type: string;
  created_at: string;
}

export interface CategoryRow extends RowDataPacket {
  id: string;
  name: string;
  deleted: number | string;
}

const documentFields = `id, title, content_md, category_id,
  CAST(content_version AS CHAR) AS content_version, CAST(revision AS CHAR) AS revision,
  DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at,
  DATE_FORMAT(updated_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS updated_at`;

export class DocumentRepository {
  constructor(private readonly pool: Pool) {}

  async transaction<T>(
    work: (connection: PoolConnection) => Promise<T>,
  ): Promise<T> {
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async organizations(userId: string): Promise<Organization[]> {
    const [rows] = await this.pool.execute<Organization[]>(
      `SELECT t.id, t.slug, t.name, m.role FROM tenants t
       JOIN memberships m ON m.tenant_id = t.id
       WHERE m.user_id = ? AND m.status = 'active' ORDER BY t.name, t.id`,
      [userId],
    );
    return rows;
  }

  async organization(
    userId: string,
    slug: string,
    connection?: PoolConnection,
  ): Promise<Organization | undefined> {
    const executor: Executor = connection ?? this.pool;
    const [rows] = await executor.execute<Organization[]>(
      `SELECT t.id, t.slug, t.name, m.role FROM tenants t
       JOIN memberships m ON m.tenant_id = t.id
       WHERE t.slug = ? AND m.user_id = ? AND m.status = 'active'
       ${connection ? "FOR UPDATE" : ""}`,
      [slug, userId],
    );
    return rows[0];
  }

  async list(tenantId: string): Promise<DocumentRow[]> {
    const [rows] = await this.pool.execute<DocumentRow[]>(
      `SELECT ${documentFields} FROM documents
       WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC, id DESC`,
      [tenantId],
    );
    return rows;
  }

  async document(
    tenantId: string,
    id: string,
    connection?: PoolConnection,
    deleted = false,
  ): Promise<DocumentRow | undefined> {
    const executor: Executor = connection ?? this.pool;
    const [rows] = await executor.execute<DocumentRow[]>(
      `SELECT ${documentFields} FROM documents
       WHERE tenant_id = ? AND id = ? AND deleted_at IS ${deleted ? "NOT " : ""}NULL
       ${connection ? "FOR UPDATE" : ""}`,
      [tenantId, id],
    );
    return rows[0];
  }

  async categoryName(
    connection: PoolConnection,
    tenantId: string,
    id: string,
  ): Promise<string | undefined> {
    const [rows] = await connection.execute<CategoryRow[]>(
      "SELECT name FROM categories WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL FOR SHARE",
      [tenantId, id],
    );
    return rows[0]?.name;
  }

  async insertDocument(
    connection: PoolConnection,
    tenantId: string,
    userId: string,
    id: string,
    title: string,
    content: string,
    categoryId: string | null,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO documents (id, tenant_id, category_id, created_by, title, content_md,
                              content_version, revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [id, tenantId, categoryId, userId, title, content],
    );
  }

  async updateDocument(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    title: string,
    content: string,
    categoryId: string | null,
  ): Promise<void> {
    await connection.execute(
      `UPDATE documents SET title = ?, content_md = ?, category_id = ?,
       content_version = content_version + 1, revision = revision + 1, updated_at = UTC_TIMESTAMP(3)
       WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
      [title, content, categoryId, tenantId, id],
    );
  }

  async insertVersion(
    connection: PoolConnection,
    tenantId: string,
    userId: string,
    document: DocumentRow,
    categoryName: string | null,
    changeType: "create" | "update" | "restore" | "trash_restore",
    restoredFrom: string | null = null,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO document_versions (id, tenant_id, document_id, version, title, content_md,
                                      category_id, category_name_snapshot, changed_by, change_type, restored_from_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
      [
        randomUUID(),
        tenantId,
        document.id,
        document.content_version,
        document.title,
        document.content_md,
        document.category_id,
        categoryName,
        userId,
        changeType,
        restoredFrom,
      ],
    );
  }

  async versions(tenantId: string, documentId: string): Promise<VersionRow[]> {
    const [rows] = await this.pool.execute<VersionRow[]>(
      `SELECT CAST(version AS CHAR) AS version, title, content_md, category_id, change_type,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
       FROM document_versions WHERE tenant_id = ? AND document_id = ?
       ORDER BY version DESC`,
      [tenantId, documentId],
    );
    return rows;
  }

  async version(
    connection: PoolConnection,
    tenantId: string,
    documentId: string,
    version: string,
  ): Promise<VersionRow | undefined> {
    const [rows] = await connection.execute<VersionRow[]>(
      `SELECT CAST(version AS CHAR) AS version, title, content_md, category_id, change_type,
              DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
       FROM document_versions WHERE tenant_id = ? AND document_id = ? AND version = ?`,
      [tenantId, documentId, version],
    );
    return rows[0];
  }

  async categories(tenantId: string): Promise<CategoryRow[]> {
    const [rows] = await this.pool.execute<CategoryRow[]>(
      "SELECT id, name, deleted_at IS NOT NULL AS deleted FROM categories WHERE tenant_id = ? ORDER BY name, id",
      [tenantId],
    );
    return rows;
  }

  async category(
    connection: PoolConnection,
    tenantId: string,
    id: string,
  ): Promise<CategoryRow | undefined> {
    const [rows] = await connection.execute<CategoryRow[]>(
      "SELECT id, name, deleted_at IS NOT NULL AS deleted FROM categories WHERE tenant_id = ? AND id = ? FOR UPDATE",
      [tenantId, id],
    );
    return rows[0];
  }

  async createCategory(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    name: string,
    key: string,
  ): Promise<void> {
    await connection.execute(
      "INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [id, tenantId, name, key],
    );
  }

  async renameCategory(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    name: string,
    key: string,
  ): Promise<void> {
    await connection.execute(
      "UPDATE categories SET name = ?, name_key = ?, updated_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL",
      [name, key, tenantId, id],
    );
  }

  async categoryInUse(
    connection: PoolConnection,
    tenantId: string,
    id: string,
  ): Promise<boolean> {
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM documents WHERE tenant_id = ? AND category_id = ? AND deleted_at IS NULL LIMIT 1 FOR UPDATE",
      [tenantId, id],
    );
    return rows.length > 0;
  }

  async setCategoryDeleted(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    deleted: boolean,
  ): Promise<void> {
    await connection.execute(
      `UPDATE categories SET deleted_at = ${deleted ? "UTC_TIMESTAMP(3)" : "NULL"}, updated_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ?`,
      [tenantId, id],
    );
  }

  async trash(tenantId: string): Promise<DocumentRow[]> {
    const [rows] = await this.pool.execute<DocumentRow[]>(
      `SELECT ${documentFields} FROM documents WHERE tenant_id = ? AND deleted_at IS NOT NULL ORDER BY updated_at DESC, id DESC`,
      [tenantId],
    );
    return rows;
  }

  async deleteDocument(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    userId: string,
  ): Promise<void> {
    await connection.execute(
      `UPDATE documents SET deleted_at = UTC_TIMESTAMP(3), deleted_by = ?, revision = revision + 1,
       updated_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, tenantId, id],
    );
  }

  async restoreTrash(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    categoryId: string | null,
    changed: boolean,
  ): Promise<void> {
    await connection.execute(
      `UPDATE documents SET deleted_at = NULL, deleted_by = NULL, category_id = ?,
       revision = revision + 1, content_version = content_version + ?, updated_at = UTC_TIMESTAMP(3)
       WHERE tenant_id = ? AND id = ? AND deleted_at IS NOT NULL`,
      [categoryId, changed ? 1 : 0, tenantId, id],
    );
  }

  async denied(
    tenantId: string,
    userId: string,
    action: string,
    targetId: string | null,
    requestId: string,
  ): Promise<void> {
    await this.pool.execute(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, success, request_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, UTC_TIMESTAMP(3))`,
      [
        randomUUID(),
        tenantId,
        userId,
        action,
        action.startsWith("category.") ? "category" : "document",
        targetId,
        requestId,
      ],
    );
  }
}
