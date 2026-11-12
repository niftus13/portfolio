import { randomUUID } from "node:crypto";

import type { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";

import type { Role } from "./documents.js";

export interface MemberRow extends RowDataPacket {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  status: "active" | "inactive";
}

interface AuditRow extends RowDataPacket {
  id: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  success: number;
  request_id: string;
  created_at: string;
}

export class MemberRepository {
  constructor(private readonly pool: Pool) {}

  async list(tenantId: string): Promise<MemberRow[]> {
    const [rows] = await this.pool.execute<MemberRow[]>(
      `SELECT m.id, u.email, u.display_name, m.role, m.status FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY u.display_name, m.id`,
      [tenantId],
    );
    return rows;
  }

  async member(
    connection: PoolConnection,
    tenantId: string,
    id: string,
  ): Promise<MemberRow | undefined> {
    const [rows] = await connection.execute<MemberRow[]>(
      `SELECT m.id, u.email, u.display_name, m.role, m.status FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? AND m.id = ? FOR UPDATE`,
      [tenantId, id],
    );
    return rows[0];
  }

  async update(
    connection: PoolConnection,
    tenantId: string,
    id: string,
    role: Exclude<Role, "owner">,
    status: "active" | "inactive",
  ): Promise<void> {
    await connection.execute(
      `UPDATE memberships SET role = ?, status = ?, deactivated_at = IF(? = 'inactive', UTC_TIMESTAMP(3), NULL),
       updated_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND id = ?`,
      [role, status, status, tenantId, id],
    );
  }

  async audit(
    connection: PoolConnection,
    tenantId: string,
    userId: string,
    memberId: string,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO audit_logs (id, tenant_id, actor_user_id, action, target_type, target_id, success, request_id, created_at)
       VALUES (?, ?, ?, 'member.update', 'membership', ?, 1, ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), tenantId, userId, memberId, randomUUID()],
    );
  }

  async auditEvents(tenantId: string): Promise<AuditRow[]> {
    const [rows] = await this.pool.execute<AuditRow[]>(
      `SELECT id, actor_user_id, action, target_type, target_id, success, request_id,
       DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS created_at
       FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC, id DESC`,
      [tenantId],
    );
    return rows;
  }
}
