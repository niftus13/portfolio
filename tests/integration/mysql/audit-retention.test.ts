import { randomUUID } from "node:crypto";

import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { cleanExpiredAuditLogs } from "../../../apps/api/src/database/audit-retention.js";
import { migrate } from "../../../apps/api/src/database/migrate.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe("audit retention in isolated MySQL", () => {
  let connection: Connection;
  const tenant = randomUUID();
  const ids = Array.from({ length: 6 }, () => randomUUID());

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
    await connection.execute(
      "INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at) VALUES (?, ?, 'Retention test', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [tenant, `retention-${tenant}`],
    );
    await connection.query("SET timestamp = 1735689600");
    for (let i = 0; i < 3; i++) {
      const age = [31, 30, 29][i];
      await connection.execute(
        "INSERT INTO auth_audit_logs (id, action, success, request_id, created_at) VALUES (?, 'test', 1, 'test', UTC_TIMESTAMP(3) - INTERVAL ? DAY)",
        [ids[i], age],
      );
      await connection.execute(
        "INSERT INTO audit_logs (id, tenant_id, action, success, request_id, created_at) VALUES (?, ?, 'test', 1, 'test', UTC_TIMESTAMP(3) - INTERVAL ? DAY)",
        [ids[i + 3], tenant, age],
      );
    }
  });

  afterAll(async () => {
    if (!connection) return;
    await connection.execute(
      "DELETE FROM auth_audit_logs WHERE id IN (?, ?, ?)",
      ids.slice(0, 3),
    );
    await connection.execute("DELETE FROM audit_logs WHERE tenant_id = ?", [
      tenant,
    ]);
    await connection.execute("DELETE FROM tenants WHERE id = ?", [tenant]);
    await connection.end();
  });

  it("rolls back both tables on failure and deletes only records older than 30 days", async () => {
    const blocker = await mysql.createConnection({
      host: required("TEST_DB_HOST"),
      port: Number(required("TEST_DB_PORT")),
      user: required("TEST_DB_USER"),
      password: required("TEST_DB_PASSWORD"),
      database: required("TEST_DB_NAME"),
    });
    try {
      await blocker.beginTransaction();
      await blocker.execute(
        "SELECT id FROM audit_logs WHERE id = ? FOR UPDATE",
        [ids[3]],
      );
      await connection.query("SET SESSION innodb_lock_wait_timeout = 1");
      await expect(cleanExpiredAuditLogs(connection)).rejects.toThrow();
    } finally {
      await blocker.rollback();
      await blocker.end();
    }
    const [before] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM auth_audit_logs WHERE id = ?",
      [ids[0]],
    );
    expect(before).toHaveLength(1);
    const result = await cleanExpiredAuditLogs(connection);
    expect(result).toEqual({ authDeleted: 1, organizationDeleted: 1 });
    const [auth] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM auth_audit_logs WHERE id IN (?, ?, ?)",
      ids.slice(0, 3),
    );
    const [organization] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM audit_logs WHERE tenant_id = ?",
      [tenant],
    );
    expect(auth.map((row) => row.id).sort()).toEqual(ids.slice(1, 3).sort());
    expect(organization.map((row) => row.id).sort()).toEqual(
      ids.slice(4, 6).sort(),
    );
    await expect(cleanExpiredAuditLogs(connection)).resolves.toEqual({
      authDeleted: 0,
      organizationDeleted: 0,
    });
  });
});
