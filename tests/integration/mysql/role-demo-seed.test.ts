import { randomUUID } from "node:crypto";

import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "../../../apps/api/src/database/migrate.js";
import { seedRoleDemo } from "../../../apps/api/src/database/role-demo-seed.js";
import { verifyPassword } from "../../../apps/api/src/identity/password.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe("role demo seed on isolated MySQL", () => {
  let connection: Connection;
  const collisionId = randomUUID();
  let tenantId: string | undefined;
  let seeded = false;
  const password = "test-only-role-password";

  beforeAll(async () => {
    const database = required("TEST_DB_NAME");
    if (!/^portfolio_test_[a-z0-9_]+$/.test(database))
      throw new Error("Expected isolated test database");
    connection = await mysql.createConnection({
      host: required("TEST_DB_HOST"),
      port: Number(required("TEST_DB_PORT")),
      user: required("TEST_DB_USER"),
      password: required("TEST_DB_PASSWORD"),
      database,
      multipleStatements: true,
    });
    await migrate(connection);
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.execute("DELETE FROM users WHERE id = ?", [collisionId]);
    if (tenantId && seeded) {
      await connection.execute(
        "DELETE FROM document_versions WHERE tenant_id = ?",
        [tenantId],
      );
      await connection.execute("DELETE FROM documents WHERE tenant_id = ?", [
        tenantId,
      ]);
      await connection.execute("DELETE FROM categories WHERE tenant_id = ?", [
        tenantId,
      ]);
      const [users] = await connection.execute<RowDataPacket[]>(
        "SELECT user_id FROM memberships WHERE tenant_id = ?",
        [tenantId],
      );
      await connection.execute("DELETE FROM memberships WHERE tenant_id = ?", [
        tenantId,
      ]);
      for (const user of users)
        await connection.execute("DELETE FROM users WHERE id = ?", [
          user.user_id,
        ]);
      await connection.execute("DELETE FROM tenants WHERE id = ?", [tenantId]);
      await connection.execute(
        "DELETE FROM seed_history WHERE name = 'demo_roles_v1'",
      );
    }
    await connection.end();
  });

  it("rolls back collisions, creates four roles with ten versioned documents each, and preserves changes on rerun", async () => {
    await connection.execute(
      `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
       VALUES (?, 'viewer@roles.demo.invalid', 'collision', 'Existing', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [collisionId],
    );
    await expect(seedRoleDemo(connection, password)).rejects.toMatchObject({
      code: "ER_DUP_ENTRY",
    });
    const [collision] = await connection.query<RowDataPacket[]>(
      "SELECT (SELECT COUNT(*) FROM tenants WHERE slug = 'demo-roles') AS tenants, (SELECT COUNT(*) FROM seed_history WHERE name = 'demo_roles_v1') AS seeds",
    );
    expect(Number(collision[0].tenants)).toBe(0);
    expect(Number(collision[0].seeds)).toBe(0);
    await connection.execute("DELETE FROM users WHERE id = ?", [collisionId]);

    expect(await seedRoleDemo(connection, password)).toBe("created");
    seeded = true;
    const [tenants] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM tenants WHERE slug = 'demo-roles' AND is_demo = 1",
    );
    expect(tenants).toHaveLength(1);
    const id = tenants[0]?.id;
    if (typeof id !== "string") throw new Error("Missing role demo tenant");
    tenantId = id;
    const [users] = await connection.execute<RowDataPacket[]>(
      `SELECT u.email, u.password_hash, m.role, COUNT(d.id) AS documents
       FROM memberships m JOIN users u ON u.id = m.user_id
       LEFT JOIN documents d ON d.tenant_id = m.tenant_id AND d.created_by = u.id
       WHERE m.tenant_id = ? AND u.is_demo = 1 AND m.status = 'active'
       GROUP BY u.id, u.email, u.password_hash, m.role ORDER BY m.role`,
      [id],
    );
    expect(
      users.map((row) => [row.email, row.role, Number(row.documents)]),
    ).toEqual([
      ["admin@roles.demo.invalid", "admin", 10],
      ["editor@roles.demo.invalid", "editor", 10],
      ["owner@roles.demo.invalid", "owner", 10],
      ["viewer@roles.demo.invalid", "viewer", 10],
    ]);
    for (const user of users)
      expect(await verifyPassword(password, user.password_hash)).toBe(true);
    const [versions] = await connection.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS count FROM documents d JOIN document_versions v
       ON v.tenant_id = d.tenant_id AND v.document_id = d.id
       WHERE d.tenant_id = ? AND d.content_version = 1 AND d.revision = 1
         AND v.version = 1 AND v.change_type = 'create'`,
      [id],
    );
    expect(Number(versions[0].count)).toBe(40);
    await connection.execute(
      "UPDATE documents SET title = 'modified' WHERE tenant_id = ? LIMIT 1",
      [id],
    );
    expect(await seedRoleDemo(connection, "different-test-password")).toBe(
      "already_applied",
    );
    const [modified] = await connection.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM documents WHERE tenant_id = ? AND title = 'modified'",
      [id],
    );
    expect(Number(modified[0].count)).toBe(1);
    const [persisted] = await connection.execute<RowDataPacket[]>(
      "SELECT password_hash FROM users WHERE email = ?",
      [users[0].email],
    );
    expect(await verifyPassword(password, persisted[0].password_hash)).toBe(
      true,
    );
  });
});
