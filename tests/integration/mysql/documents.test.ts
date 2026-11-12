import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../../apps/api/src/app.js";
import { migrate } from "../../../apps/api/src/database/migrate.js";
import { AuthRepository } from "../../../apps/api/src/repositories/auth.js";
import {
  DocumentRepository,
  type DocumentRow,
} from "../../../apps/api/src/repositories/documents.js";
import { AuthService } from "../../../apps/api/src/services/auth.js";
import { DocumentService } from "../../../apps/api/src/services/documents.js";

const origin = "http://127.0.0.1:3100";
const namespace = randomBytes(8).toString("hex");
const tenants = [randomUUID(), randomUUID()];
const users = [randomUUID(), randomUUID(), randomUUID()];
const tokens = users.map(() => randomBytes(32).toString("hex"));
const csrf = users.map(() => randomBytes(32).toString("hex"));
const sessions = users.map(() => randomUUID());
const categories = [randomUUID(), randomUUID()];
const slugs = [`a-${namespace}`, `b-${namespace}`];
const path = (tenant: number, id = "") =>
  `/api/v1/orgs/${slugs[tenant]}/documents${id ? `/${id}` : ""}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

class FailingRepository extends DocumentRepository {
  failVersion = false;
  failDenial = false;

  override async insertVersion(
    connection: PoolConnection,
    tenantId: string,
    userId: string,
    document: DocumentRow,
    categoryName: string | null,
    changeType: "create" | "update",
  ) {
    if (this.failVersion) {
      await connection.execute(
        "INSERT INTO document_versions (test_nonexistent_column) VALUES (1)",
      );
      return;
    }
    return super.insertVersion(
      connection,
      tenantId,
      userId,
      document,
      categoryName,
      changeType,
    );
  }

  override async denied(
    tenantId: string,
    userId: string,
    action: string,
    targetId: string | null,
    requestId: string,
  ) {
    if (this.failDenial) throw new Error("Injected audit failure");
    return super.denied(tenantId, userId, action, targetId, requestId);
  }
}

describe("tenant-scoped document API with real MySQL", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  let repository: FailingRepository;

  async function request(
    user: number | null,
    url: string,
    method = "GET",
    body?: unknown,
    token = true,
  ) {
    const headers = new Headers();
    if (user !== null)
      headers.set("Cookie", `portfolio_session=${tokens[user]}`);
    if (method !== "GET") {
      headers.set("Origin", origin);
      headers.set("Content-Type", "application/json");
      if (user !== null && token) headers.set("X-CSRF-Token", csrf[user]);
    }
    return fetch(`${base}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const database = required("TEST_DB_NAME");
    if (!/^portfolio_test_[a-z0-9_]+$/.test(database))
      throw new Error("Expected isolated test database");
    pool = mysql.createPool({
      host: required("TEST_DB_HOST"),
      port: Number(required("TEST_DB_PORT")),
      user: required("TEST_DB_USER"),
      password: required("TEST_DB_PASSWORD"),
      database,
      multipleStatements: true,
      timezone: "Z",
    });
    const connection = await pool.getConnection();
    try {
      await migrate(connection);
    } finally {
      connection.release();
    }
    for (const [index, id] of users.entries()) {
      await pool.execute(
        `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
        VALUES (?, ?, 'unused', 'Test', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, `${id}@${namespace}.invalid`],
      );
      await pool.execute(
        `INSERT INTO sessions (id, user_id, token_hash, last_activity_at, expires_at, created_at)
        VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 1 HOUR, UTC_TIMESTAMP(3))`,
        [
          sessions[index],
          id,
          createHash("sha256").update(tokens[index]).digest(),
        ],
      );
      await pool.execute(
        `INSERT INTO csrf_states (id, session_id, token, expires_at, created_at)
        VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 1 HOUR, UTC_TIMESTAMP(3))`,
        [randomUUID(), sessions[index], csrf[index]],
      );
    }
    for (const [index, id] of tenants.entries()) {
      await pool.execute(
        `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
        VALUES (?, ?, 'Test', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [id, slugs[index]],
      );
      await pool.execute(
        `INSERT INTO categories (id, tenant_id, name, name_key, created_at, updated_at)
        VALUES (?, ?, 'Guide', 'guide', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [categories[index], id],
      );
    }
    for (const [tenant, user, role] of [
      [0, 0, "owner"],
      [0, 1, "viewer"],
      [1, 1, "viewer"],
      [1, 2, "owner"],
    ] as const) {
      await pool.execute(
        `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [randomUUID(), tenants[tenant], users[user], role],
      );
    }
    repository = new FailingRepository(pool);
    server = createServer(
      createApp({
        checkDatabase: async () => {
          await pool.query("SELECT 1");
        },
        auth: {
          service: new AuthService(new AuthRepository(pool), "/dev/null"),
          allowedOrigin: origin,
          secure: false,
          trustProxy: false,
        },
        documents: new DocumentService(repository),
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No server address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (!pool) return;
    for (const tenant of tenants) {
      await pool.execute("DELETE FROM audit_logs WHERE tenant_id = ?", [
        tenant,
      ]);
      await pool.execute("DELETE FROM document_versions WHERE tenant_id = ?", [
        tenant,
      ]);
      await pool.execute("DELETE FROM documents WHERE tenant_id = ?", [tenant]);
      await pool.execute("DELETE FROM categories WHERE tenant_id = ?", [
        tenant,
      ]);
      await pool.execute("DELETE FROM memberships WHERE tenant_id = ?", [
        tenant,
      ]);
      await pool.execute("DELETE FROM tenants WHERE id = ?", [tenant]);
    }
    for (const [index, user] of users.entries()) {
      await pool.execute("DELETE FROM csrf_states WHERE session_id = ?", [
        sessions[index],
      ]);
      await pool.execute("DELETE FROM sessions WHERE id = ?", [
        sessions[index],
      ]);
      await pool.execute("DELETE FROM users WHERE id = ?", [user]);
    }
    await pool.end();
  });

  it("enforces authentication, active membership, tenant scoping, role and denial auditing", async () => {
    expect((await request(null, "/api/v1/orgs")).status).toBe(401);
    const organizations = await (await request(0, "/api/v1/orgs")).json();
    expect(
      organizations.organizations.map((item: { slug: string }) => item.slug),
    ).toEqual([slugs[0]]);
    expect((await request(0, path(1))).status).toBe(404);
    expect(
      (await request(0, path(0), "POST", { title: "x", contentMd: "" }, false))
        .status,
    ).toBe(403);
    const created = await request(2, path(1), "POST", {
      title: "B",
      contentMd: "secret",
    });
    expect(created.status).toBe(201);
    const { document } = await created.json();
    const viewerList = await (await request(1, path(1))).json();
    expect(
      viewerList.documents.map((item: { id: string }) => item.id),
    ).toContain(document.id);
    expect((await request(1, path(1, document.id))).status).toBe(200);
    expect((await request(1, path(0, document.id))).status).toBe(404);
    expect((await request(1, `${path(0, document.id)}/versions`)).status).toBe(
      404,
    );
    const cross = await request(1, path(0, document.id), "PATCH", {
      expectedRevision: "1",
      title: "x",
    });
    const missing = await request(1, path(0, randomUUID()), "PATCH", {
      expectedRevision: "1",
      title: "x",
    });
    expect(cross.status).toBe(404);
    expect(await cross.json()).toEqual(await missing.json());
    const denied = await request(1, path(1, document.id), "PATCH", {
      expectedRevision: "1",
      title: "x",
    });
    expect(denied.status).toBe(403);
    const [audit] = await pool.execute<RowDataPacket[]>(
      "SELECT action, success FROM audit_logs WHERE tenant_id = ? AND actor_user_id = ?",
      [tenants[1], users[1]],
    );
    expect(audit).toMatchObject([{ action: "document.update", success: 0 }]);
    expect(
      (
        await request(1, path(1, document.id), "PATCH", {
          expectedRevision: "2",
          title: "x",
        })
      ).status,
    ).toBe(403);
    repository.failDenial = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        (
          await request(1, path(1, document.id), "PATCH", {
            expectedRevision: "1",
            title: "x",
          })
        ).status,
      ).toBe(403);
      expect(spy).toHaveBeenCalledWith(
        "Authorization denial audit failed",
        expect.objectContaining({ requestId: expect.any(String) }),
      );
    } finally {
      repository.failDenial = false;
      spy.mockRestore();
    }
    await pool.execute(
      "UPDATE memberships SET status = 'inactive', deactivated_at = UTC_TIMESTAMP(3) WHERE tenant_id = ? AND user_id = ?",
      [tenants[1], users[1]],
    );
    expect((await request(1, path(1))).status).toBe(404);
  });

  it("creates snapshots, checks revision before no-op, and preserves or unsets categories", async () => {
    const created = await request(0, path(0), "POST", {
      title: " Guide ",
      contentMd: "one",
      categoryId: categories[0],
    });
    expect(created.status).toBe(201);
    const { document } = await created.json();
    expect(document).toMatchObject({
      title: "Guide",
      revision: "1",
      contentVersion: "1",
      categoryId: categories[0],
    });
    const versions = await (
      await request(0, `${path(0, document.id)}/versions`)
    ).json();
    expect(versions.versions).toMatchObject([
      { version: "1", changeType: "create", contentMd: "one" },
    ]);
    const noop = await (
      await request(0, path(0, document.id), "PATCH", {
        expectedRevision: "1",
        title: "Guide",
      })
    ).json();
    expect(noop.document).toEqual(document);
    const changed = await (
      await request(0, path(0, document.id), "PATCH", {
        expectedRevision: "1",
        contentMd: "two",
      })
    ).json();
    expect(changed.document).toMatchObject({
      revision: "2",
      contentVersion: "2",
      categoryId: categories[0],
    });
    expect(
      (
        await request(0, path(0, document.id), "PATCH", {
          expectedRevision: "1",
          contentMd: "two",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(0, path(0, document.id), "PATCH", {
          expectedRevision: "2",
          categoryId: categories[1],
        })
      ).status,
    ).toBe(404);
    const unset = await (
      await request(0, path(0, document.id), "PATCH", {
        expectedRevision: "2",
        categoryId: null,
      })
    ).json();
    expect(unset.document).toMatchObject({ revision: "3", categoryId: null });
    expect(
      (
        await request(0, path(0, document.id), "PATCH", {
          expectedRevision: 3,
          title: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(0, path(0), "POST", {
          title: "invalid",
          contentMd: "",
          unexpected: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(0, path(0), "POST", {
          title: "invalid",
          contentMd: "",
          categoryId: categories[1],
        })
      ).status,
    ).toBe(404);
    await pool.execute(
      "UPDATE documents SET deleted_at = UTC_TIMESTAMP(3) WHERE id = ? AND tenant_id = ?",
      [document.id, tenants[0]],
    );
    expect((await request(0, path(0, document.id))).status).toBe(404);
    expect((await request(0, `${path(0, document.id)}/versions`)).status).toBe(
      404,
    );
  });

  it("preserves revision and content version beyond JavaScript's safe integer range", async () => {
    const { document } = await (
      await request(0, path(0), "POST", { title: "Big counter", contentMd: "" })
    ).json();
    await pool.execute(
      "UPDATE documents SET revision = 9007199254740993, content_version = 9007199254740993 WHERE tenant_id = ? AND id = ?",
      [tenants[0], document.id],
    );
    const response = await request(0, path(0, document.id), "PATCH", {
      expectedRevision: "9007199254740993",
      contentMd: "next",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).document).toMatchObject({
      revision: "9007199254740994",
      contentVersion: "9007199254740994",
    });
  });

  it("serializes concurrent edits and rolls back document changes if a snapshot fails", async () => {
    const { document } = await (
      await request(0, path(0), "POST", { title: "Race", contentMd: "" })
    ).json();
    const responses = await Promise.all(
      ["first", "second"].map((contentMd) =>
        request(0, path(0, document.id), "PATCH", {
          expectedRevision: "1",
          contentMd,
        }),
      ),
    );
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
    const before = (await (await request(0, path(0, document.id))).json())
      .document;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    repository.failVersion = true;
    try {
      expect(
        (
          await request(0, path(0, document.id), "PATCH", {
            expectedRevision: "2",
            contentMd: "rollback",
          })
        ).status,
      ).toBe(500);
      expect(
        (
          await request(0, path(0), "POST", {
            title: "rollback",
            contentMd: "",
          })
        ).status,
      ).toBe(500);
    } finally {
      repository.failVersion = false;
      spy.mockRestore();
    }
    expect(
      (await (await request(0, path(0, document.id))).json()).document,
    ).toEqual(before);
    const history = await (
      await request(0, `${path(0, document.id)}/versions`)
    ).json();
    expect(
      history.versions.map((item: { version: string }) => item.version),
    ).toEqual(["2", "1"]);
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM documents WHERE tenant_id = ? AND title = 'rollback'",
      [tenants[0]],
    );
    expect(rows).toHaveLength(0);
  });
});
