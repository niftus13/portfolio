import { randomUUID } from "node:crypto";

import type { Connection, RowDataPacket } from "mysql2/promise";

import { hashPassword } from "../identity/password.js";
import { withDatabaseLock } from "./lock.js";

interface SeedRow extends RowDataPacket {
  name: string;
}

const seedName = "demo_roles_v1";
const roles = ["owner", "admin", "editor", "viewer"] as const;
const topics = [
  "팀 소개",
  "업무 시작 안내",
  "휴가 신청 절차",
  "회의 운영 가이드",
  "문서 작성 원칙",
  "장애 대응 절차",
  "자주 묻는 질문",
  "프로젝트 인수인계",
  "보안 점검 안내",
  "업무 회고",
] as const;

export async function seedRoleDemo(
  connection: Connection,
  password: string,
): Promise<"created" | "already_applied"> {
  const length = [...password].length;
  if (length < 12 || length > 128) {
    throw new Error("SEED_DEMO_PASSWORD must contain 12 to 128 characters");
  }
  return withDatabaseLock(connection, async () => {
    const [existing] = await connection.execute<SeedRow[]>(
      "SELECT name FROM seed_history WHERE name = ?",
      [seedName],
    );
    if (existing.length) return "already_applied";
    await connection.beginTransaction();
    try {
      const tenantId = randomUUID();
      const categoryId = randomUUID();
      await connection.execute(
        `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
         VALUES (?, 'demo-roles', '역할별 데모', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [tenantId],
      );
      await connection.execute(
        `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
         VALUES (?, ?, '데모 가이드', '데모 가이드', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [categoryId, tenantId],
      );
      for (const role of roles) {
        const userId = randomUUID();
        await connection.execute(
          `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            userId,
            `${role}@roles.demo.invalid`,
            await hashPassword(password),
            `데모 ${role}`,
          ],
        );
        await connection.execute(
          `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [randomUUID(), tenantId, userId, role],
        );
        for (const [index, topic] of topics.entries()) {
          const documentId = randomUUID();
          const title = `[${role}] ${topic}`;
          const content = `# ${topic}\n\n${role} 역할의 데모 문서 ${index + 1}입니다.\n\n이 내용은 기능 확인을 위한 예시입니다.`;
          await connection.execute(
            `INSERT INTO documents (id, tenant_id, category_id, created_by, title, content_md, content_version, revision, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, 1, 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [documentId, tenantId, categoryId, userId, title, content],
          );
          await connection.execute(
            `INSERT INTO document_versions (id, tenant_id, document_id, version, title, content_md, category_id, category_name_snapshot, changed_by, change_type, created_at)
             VALUES (?, ?, ?, 1, ?, ?, ?, '데모 가이드', ?, 'create', UTC_TIMESTAMP(3))`,
            [
              randomUUID(),
              tenantId,
              documentId,
              title,
              content,
              categoryId,
              userId,
            ],
          );
        }
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
