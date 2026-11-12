import { randomBytes, randomUUID } from "node:crypto";
import {
  mkdtemp,
  copyFile,
  readFile,
  readdir,
  rm,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "../../../apps/api/src/database/migrate.js";
import { seedDemo } from "../../../apps/api/src/database/seed.js";
import { verifyPassword } from "../../../apps/api/src/identity/password.js";

interface TenantRow extends RowDataPacket {
  id: string;
  slug: string;
}

interface UserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
  is_demo: number;
}

interface DocumentRow extends RowDataPacket {
  id: string;
  tenant_id: string;
  category_id: string;
  created_by: string;
}

interface CountRow extends RowDataPacket {
  count: number | string;
}

interface StateRow extends RowDataPacket {
  state: string;
}

interface SeedDocumentRow extends RowDataPacket {
  content_version: string;
  revision: string;
  version: string;
  change_type: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required test environment variable: ${name}`);
  return value;
}

describe("isolated MySQL foundation", () => {
  let connection: Connection;
  const password = "test-only-password-123";

  beforeAll(async () => {
    const database = required("TEST_DB_NAME");
    if (!/^portfolio_test_[a-z0-9_]+$/.test(database)) {
      throw new Error("TEST_DB_NAME must start with portfolio_test_");
    }
    const port = Number(required("TEST_DB_PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("TEST_DB_PORT must be a valid port");
    }
    connection = await mysql.createConnection({
      host: required("TEST_DB_HOST"),
      port,
      user: required("TEST_DB_USER"),
      password: required("TEST_DB_PASSWORD"),
      database,
      multipleStatements: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
    });
    await migrate(connection);
  });

  afterAll(async () => {
    if (connection) await connection.end();
  });

  it("reapplies migrations safely and seeds two organizations without overwriting existing data", async () => {
    await migrate(connection);
    const [existingSeed] = await connection.query<CountRow[]>(
      "SELECT COUNT(*) AS count FROM seed_history WHERE name = 'demo_initial_v1'",
    );
    const result = await seedDemo(connection, password);
    expect(result).toBe(
      Number(existingSeed[0].count) === 0 ? "created" : "already_applied",
    );

    const [tenants] = await connection.query<TenantRow[]>(
      "SELECT id, slug FROM tenants WHERE slug IN ('demo-a', 'demo-b') ORDER BY slug",
    );
    expect(tenants.map((tenant) => tenant.slug)).toEqual(["demo-a", "demo-b"]);
    const [users] = await connection.query<UserRow[]>(
      "SELECT id, email, password_hash, is_demo FROM users WHERE email = 'admin@demo.invalid'",
    );
    expect(users).toHaveLength(1);
    expect(users[0].is_demo).toBe(1);
    if (result === "created") {
      await expect(
        verifyPassword(password, users[0].password_hash),
      ).resolves.toBe(true);
    }
    const [roles] = await connection.execute<RowDataPacket[]>(
      `SELECT tenants.slug, memberships.role FROM memberships
       JOIN tenants ON tenants.id = memberships.tenant_id
       WHERE memberships.user_id = ? ORDER BY tenants.slug`,
      [users[0].id],
    );
    expect(roles.map((row) => [row.slug, row.role])).toEqual([
      ["demo-a", "admin"],
      ["demo-b", "editor"],
    ]);
    const [snapshots] = await connection.query<SeedDocumentRow[]>(
      `SELECT documents.content_version, documents.revision, document_versions.version, document_versions.change_type
       FROM documents
       JOIN tenants ON tenants.id = documents.tenant_id
       JOIN document_versions ON document_versions.tenant_id = documents.tenant_id
         AND document_versions.document_id = documents.id
       WHERE tenants.slug IN ('demo-a', 'demo-b') ORDER BY tenants.slug`,
    );
    expect(
      snapshots.map((row) => [
        row.content_version,
        row.revision,
        row.version,
        row.change_type,
      ]),
    ).toEqual([
      ["1", "1", "1", "create"],
      ["1", "1", "1", "create"],
    ]);

    await connection.beginTransaction();
    try {
      const normalId = randomUUID();
      await connection.execute(
        `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
         VALUES (?, ?, 'not-a-real-password-hash', 'Regular', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [normalId, `${normalId}@example.invalid`],
      );
      await expect(seedDemo(connection, password)).resolves.toBe(
        "already_applied",
      );
      const [ordinary] = await connection.execute<CountRow[]>(
        "SELECT COUNT(*) AS count FROM users WHERE id = ? AND is_demo = 0",
        [normalId],
      );
      expect(Number(ordinary[0].count)).toBe(1);
    } finally {
      await connection.rollback();
    }
  });

  it("rejects cross-tenant document-category and version-document relationships", async () => {
    const [documents] = await connection.query<DocumentRow[]>(
      `SELECT documents.id, documents.tenant_id, documents.category_id, documents.created_by
       FROM documents JOIN tenants ON tenants.id = documents.tenant_id
       WHERE tenants.slug IN ('demo-a', 'demo-b') ORDER BY tenants.slug`,
    );
    expect(documents).toHaveLength(2);
    const [first, second] = documents;

    await connection.beginTransaction();
    try {
      await expect(
        connection.execute(
          `INSERT INTO documents (id, tenant_id, category_id, created_by, title, content_md, content_version, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Invalid', '', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            randomUUID(),
            second.tenant_id,
            first.category_id,
            second.created_by,
          ],
        ),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      await expect(
        connection.execute(
          `INSERT INTO document_versions (id, tenant_id, document_id, version, title, content_md, changed_by, change_type, created_at)
           VALUES (?, ?, ?, 2, 'Invalid', '', ?, 'update', UTC_TIMESTAMP(3))`,
          [randomUUID(), second.tenant_id, first.id, second.created_by],
        ),
      ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
    } finally {
      await connection.rollback();
    }
  });

  it("rejects memberships that mix demo and ordinary accounts or organizations", async () => {
    const [tenants] = await connection.query<TenantRow[]>(
      "SELECT id, slug FROM tenants WHERE slug = 'demo-a'",
    );
    const [demoUsers] = await connection.query<UserRow[]>(
      "SELECT id, email, password_hash, is_demo FROM users WHERE email = 'admin@demo.invalid'",
    );
    const ordinaryUserId = randomUUID();
    const ordinaryTenantId = randomUUID();
    await connection.beginTransaction();
    try {
      await connection.execute(
        `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
         VALUES (?, ?, 'not-a-real-password-hash', 'Regular', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [ordinaryUserId, `${ordinaryUserId}@example.invalid`],
      );
      await connection.execute(
        `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
         VALUES (?, ?, 'Regular', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [ordinaryTenantId, ordinaryTenantId],
      );
      const statement = `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'viewer', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`;
      for (const isDemo of [0, 1]) {
        await expect(
          connection.execute(statement, [
            randomUUID(),
            tenants[0].id,
            ordinaryUserId,
            isDemo,
          ]),
        ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
        await expect(
          connection.execute(statement, [
            randomUUID(),
            ordinaryTenantId,
            demoUsers[0].id,
            isDemo,
          ]),
        ).rejects.toMatchObject({ code: "ER_NO_REFERENCED_ROW_2" });
      }
    } finally {
      await connection.rollback();
    }
  });

  it("reserves category comparison keys even after soft deletion", async () => {
    const [tenants] = await connection.query<TenantRow[]>(
      "SELECT id, slug FROM tenants WHERE slug = 'demo-a'",
    );
    const tenantId = tenants[0].id;
    await connection.beginTransaction();
    try {
      const key = `case-${randomUUID()}`;
      await connection.execute(
        `INSERT INTO categories (id, tenant_id, name, name_key, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), tenantId, key, key],
      );
      await expect(
        connection.execute(
          `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), tenantId, key, key],
        ),
      ).rejects.toMatchObject({ code: "ER_DUP_ENTRY" });
      await connection.execute(
        `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), tenantId, `Ä${key}`, `Ä${key}`],
      );
      await expect(
        connection.execute(
          `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), tenantId, `ä${key}`, `ä${key}`],
        ),
      ).resolves.toBeDefined();
    } finally {
      await connection.rollback();
    }
  });

  it("rejects changed or out-of-order migrations before applying them", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "portfolio-migration-order-"),
    );
    const initial = join(directory, "001_initial.sql");
    const earlier = join(directory, "000_earlier.sql");
    const names = (await readdir(resolve("apps/api/migrations"))).filter(
      (name) => name.endsWith(".sql"),
    );
    const original = await readFile(
      resolve("apps/api/migrations/001_initial.sql"),
    );
    try {
      for (const name of names) {
        await copyFile(
          resolve("apps/api/migrations", name),
          join(directory, name),
        );
      }
      await writeFile(earlier, "SELECT 1;");
      await expect(migrate(connection, directory)).rejects.toThrow(
        "Out-of-order migration",
      );
      await unlink(earlier);
      await writeFile(
        initial,
        Buffer.concat([original, Buffer.from("\n-- changed\n")]),
      );
      await expect(migrate(connection, directory)).rejects.toThrow(
        "Applied migration is missing or changed",
      );
    } finally {
      for (const name of names)
        await rm(join(directory, name), { force: true });
      await rm(earlier, { force: true });
      await rmdir(directory);
    }
  });

  it("stops after partial DDL failure rather than silently retrying", async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "portfolio-migration-test-"),
    );
    const suffix = randomBytes(8).toString("hex");
    const migrationName = `999999_failed_${suffix}.sql`;
    const tableName = `test_partial_${suffix}`;
    const failing = join(directory, migrationName);
    const names = (await readdir(resolve("apps/api/migrations"))).filter(
      (name) => name.endsWith(".sql"),
    );
    try {
      for (const name of names) {
        await copyFile(
          resolve("apps/api/migrations", name),
          join(directory, name),
        );
      }
      await writeFile(
        failing,
        `CREATE TABLE ${tableName} (id INT); INVALID SQL;`,
      );
      await expect(migrate(connection, directory)).rejects.toThrow();
      const [rows] = await connection.execute<StateRow[]>(
        "SELECT state FROM schema_migrations WHERE name = ?",
        [migrationName],
      );
      expect(rows[0]?.state).toBe("applying");
      await expect(migrate(connection, directory)).rejects.toThrow(
        "Incomplete migration requires manual recovery",
      );
    } finally {
      await connection.query(`DROP TABLE IF EXISTS ${tableName}`);
      await connection.execute("DELETE FROM schema_migrations WHERE name = ?", [
        migrationName,
      ]);
      for (const name of names)
        await rm(join(directory, name), { force: true });
      await rm(failing, { force: true });
      await rmdir(directory);
    }
  });
});
