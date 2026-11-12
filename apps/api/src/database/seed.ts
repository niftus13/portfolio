import { randomUUID } from "node:crypto";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { hashPassword } from "../identity/password.js";
import { withDatabaseLock } from "./lock.js";

interface SeedRow extends RowDataPacket {
  name: string;
}

const seedName = "demo_initial_v1";

export async function seedDemo(
  connection: Connection,
  password: string,
): Promise<"created" | "already_applied"> {
  const passwordLength = [...password].length;
  if (passwordLength < 12 || passwordLength > 128) {
    throw new Error("SEED_DEMO_PASSWORD must contain 12 to 128 characters");
  }

  return withDatabaseLock(connection, async () => {
    const [existing] = await connection.execute<SeedRow[]>(
      "SELECT name FROM seed_history WHERE name = ?",
      [seedName],
    );
    if (existing.length > 0) return "already_applied";

    await connection.beginTransaction();
    try {
      const users = [
        { id: randomUUID(), email: "owner-a@demo.invalid", name: "Owner A" },
        { id: randomUUID(), email: "owner-b@demo.invalid", name: "Owner B" },
        { id: randomUUID(), email: "admin@demo.invalid", name: "Admin" },
        { id: randomUUID(), email: "editor@demo.invalid", name: "Editor" },
        { id: randomUUID(), email: "viewer@demo.invalid", name: "Viewer" },
      ];
      for (const user of users) {
        await connection.execute(
          `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [user.id, user.email, await hashPassword(password), user.name],
        );
      }

      const tenants = [
        { id: randomUUID(), slug: "demo-a", name: "Demo A", owner: users[0] },
        { id: randomUUID(), slug: "demo-b", name: "Demo B", owner: users[1] },
      ];
      for (const [index, tenant] of tenants.entries()) {
        await connection.execute(
          `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [tenant.id, tenant.slug, tenant.name],
        );
        const members = [
          { user: tenant.owner, role: "owner" },
          { user: users[2], role: index === 0 ? "admin" : "editor" },
          { user: users[3], role: index === 0 ? "editor" : "admin" },
          { user: users[4], role: "viewer" },
        ];
        for (const member of members) {
          await connection.execute(
            `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
             VALUES (?, ?, ?, 1, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [randomUUID(), tenant.id, member.user.id, member.role],
          );
        }

        const categoryId = randomUUID();
        const documentId = randomUUID();
        await connection.execute(
          `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
           VALUES (?, ?, 'Guide', 'guide', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [categoryId, tenant.id],
        );
        await connection.execute(
          `INSERT INTO documents (id, tenant_id, category_id, created_by, title, content_md, content_version, revision, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'Welcome', 'Demo organization guide.', 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [documentId, tenant.id, categoryId, tenant.owner.id],
        );
        await connection.execute(
          `INSERT INTO document_versions (id, tenant_id, document_id, version, title, content_md, category_id, category_name_snapshot, changed_by, change_type, created_at)
           VALUES (?, ?, ?, 1, 'Welcome', 'Demo organization guide.', ?, 'Guide', ?, 'create', UTC_TIMESTAMP(3))`,
          [randomUUID(), tenant.id, documentId, categoryId, tenant.owner.id],
        );
      }
      await connection.execute(
        "INSERT INTO seed_history (name, applied_at) VALUES (?, UTC_TIMESTAMP(3))",
        [seedName],
      );
      await connection.commit();
      return "created";
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  });
}
