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
import { MemberRepository } from "../../../apps/api/src/repositories/members.js";
import { AuthService } from "../../../apps/api/src/services/auth.js";
import { DocumentService } from "../../../apps/api/src/services/documents.js";
import { MemberService } from "../../../apps/api/src/services/members.js";

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
    changeType: "create" | "update" | "restore" | "trash_restore",
    restoredFrom: string | null = null,
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
      restoredFrom,
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

class FailingMemberRepository extends MemberRepository {
  failAudit = false;
  override async audit(
    connection: PoolConnection,
    tenantId: string,
    userId: string,
    memberId: string,
  ) {
    if (this.failAudit) {
      await connection.execute(
        "INSERT INTO audit_logs (test_nonexistent_column) VALUES (1)",
      );
      return;
    }
    return super.audit(connection, tenantId, userId, memberId);
  }
}

describe("tenant-scoped document API with real MySQL", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  let repository: FailingRepository;
  let memberRepository: FailingMemberRepository;

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
      supportBigNumbers: true,
      bigNumberStrings: true,
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
    memberRepository = new FailingMemberRepository(pool);
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
        members: new MemberService(repository, memberRepository),
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

  it("accepts a search as the first request to a newly started API", async () => {
    const freshServer = createServer(
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
        members: new MemberService(repository, memberRepository),
      }),
    );
    await new Promise<void>((resolve, reject) => {
      freshServer.once("error", reject);
      freshServer.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = freshServer.address();
      if (!address || typeof address === "string")
        throw new Error("No server address");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/orgs/${slugs[0]}/search?q=first`,
        { headers: { Cookie: `portfolio_session=${tokens[0]}` } },
      );
      expect(response.status).toBe(200);
      expect((await response.json()).documents).toEqual(expect.any(Array));
    } finally {
      await new Promise<void>((resolve, reject) =>
        freshServer.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("enforces member role transitions and commits successful audits atomically", async () => {
    const memberPath = `/api/v1/orgs/${slugs[0]}/members`;
    const newMembership = randomUUID();
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM memberships WHERE tenant_id = ? AND user_id = ?",
      [tenants[0], users[1]],
    );
    const adminId = existing[0].id;
    await pool.execute(
      "UPDATE memberships SET role = 'admin' WHERE tenant_id = ? AND id = ?",
      [tenants[0], adminId],
    );
    await pool.execute(
      `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, deactivated_at, created_at, updated_at)
         VALUES (?, ?, ?, 0, 'admin', 'inactive', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [newMembership, tenants[0], users[2]],
    );
    try {
      expect(
        (
          await request(1, `${memberPath}/${newMembership}`, "PATCH", {
            role: "editor",
            status: "active",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(1, `${memberPath}/${randomUUID()}`, "PATCH", {
            role: "viewer",
            status: "active",
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await request(0, `${memberPath}/${newMembership}`, "PATCH", {
            role: "editor",
            status: "active",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request(1, `${memberPath}/${newMembership}`, "PATCH", {
            role: "admin",
            status: "active",
          })
        ).status,
      ).toBe(403);
      memberRepository.failAudit = true;
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(
          (
            await request(0, `${memberPath}/${newMembership}`, "PATCH", {
              role: "viewer",
              status: "inactive",
            })
          ).status,
        ).toBe(500);
      } finally {
        memberRepository.failAudit = false;
        spy.mockRestore();
      }
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT role, status FROM memberships WHERE id = ?",
        [newMembership],
      );
      expect(rows).toMatchObject([{ role: "editor", status: "active" }]);
      const audit = await (
        await request(0, `/api/v1/orgs/${slugs[0]}/audit-events`)
      ).json();
      expect(
        audit.events.filter(
          (event: { targetId: string; success: boolean }) =>
            event.targetId === newMembership && event.success,
        ),
      ).toHaveLength(1);
      expect(
        (
          await request(0, `${memberPath}/${adminId}`, "PATCH", {
            role: "viewer",
            status: "active",
          })
        ).status,
      ).toBe(200);
      expect((await request(1, memberPath)).status).toBe(403);
      expect(
        (await request(1, `/api/v1/orgs/${slugs[0]}/audit-events`)).status,
      ).toBe(403);
    } finally {
      await pool.execute(
        "UPDATE memberships SET role = 'viewer' WHERE id = ?",
        [adminId],
      );
      await pool.execute("DELETE FROM memberships WHERE id = ?", [
        newMembership,
      ]);
    }
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

  it("denies public demo membership changes even to the owner", async () => {
    const tenantId = randomUUID();
    const ownerId = randomUUID();
    const targetId = randomUUID();
    const ownerSession = randomUUID();
    const ownerToken = randomBytes(32).toString("hex");
    const ownerCsrf = randomBytes(32).toString("hex");
    const memberId = randomUUID();
    const demoSlug = `demo-${namespace}`;
    try {
      for (const id of [ownerId, targetId]) {
        await pool.execute(
          `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
          VALUES (?, ?, 'unused', 'Demo', 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [id, `${id}@${namespace}.invalid`],
        );
      }
      await pool.execute(
        `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
        VALUES (?, ?, 'Demo', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [tenantId, demoSlug],
      );
      for (const [id, userId, role] of [
        [randomUUID(), ownerId, "owner"],
        [memberId, targetId, "viewer"],
      ]) {
        await pool.execute(
          `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
          VALUES (?, ?, ?, 1, ?, 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [id, tenantId, userId, role],
        );
      }
      await pool.execute(
        `INSERT INTO sessions (id, user_id, token_hash, last_activity_at, expires_at, created_at)
        VALUES (?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) + INTERVAL 1 HOUR, UTC_TIMESTAMP(3))`,
        [
          ownerSession,
          ownerId,
          createHash("sha256").update(ownerToken).digest(),
        ],
      );
      await pool.execute(
        `INSERT INTO csrf_states (id, session_id, token, expires_at, created_at)
        VALUES (?, ?, ?, UTC_TIMESTAMP(3) + INTERVAL 1 HOUR, UTC_TIMESTAMP(3))`,
        [randomUUID(), ownerSession, ownerCsrf],
      );
      const response = await fetch(
        `${base}/api/v1/orgs/${demoSlug}/members/${memberId}`,
        {
          method: "PATCH",
          headers: {
            Cookie: `portfolio_session=${ownerToken}`,
            Origin: origin,
            "Content-Type": "application/json",
            "X-CSRF-Token": ownerCsrf,
          },
          body: JSON.stringify({ role: "editor", status: "active" }),
        },
      );
      expect(response.status).toBe(403);
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT role FROM memberships WHERE id = ?",
        [memberId],
      );
      expect(rows).toMatchObject([{ role: "viewer" }]);
      const [audits] = await pool.execute<RowDataPacket[]>(
        "SELECT action, success FROM audit_logs WHERE tenant_id = ? AND target_id = ?",
        [tenantId, memberId],
      );
      expect(audits).toMatchObject([{ action: "member.update", success: 0 }]);
    } finally {
      await pool.execute("DELETE FROM audit_logs WHERE tenant_id = ?", [
        tenantId,
      ]);
      await pool.execute("DELETE FROM csrf_states WHERE session_id = ?", [
        ownerSession,
      ]);
      await pool.execute("DELETE FROM sessions WHERE id = ?", [ownerSession]);
      await pool.execute("DELETE FROM memberships WHERE tenant_id = ?", [
        tenantId,
      ]);
      await pool.execute("DELETE FROM tenants WHERE id = ?", [tenantId]);
      await pool.execute("DELETE FROM users WHERE id IN (?, ?)", [
        ownerId,
        targetId,
      ]);
    }
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

  it("reserves deleted category names and serializes category deletion with association", async () => {
    const categoryPath = `/api/v1/orgs/${slugs[0]}/categories`;
    const created = await request(0, categoryPath, "POST", {
      name: " Race Category ",
    });
    expect(created.status).toBe(201);
    const { category } = await created.json();
    expect(
      (await request(0, categoryPath, "POST", { name: "race category" }))
        .status,
    ).toBe(409);
    expect(
      (await request(1, `${categoryPath}/${category.id}`, "DELETE")).status,
    ).toBe(403);
    const [deletion, association] = await Promise.all([
      request(0, `${categoryPath}/${category.id}`, "DELETE"),
      request(0, path(0), "POST", {
        title: "Category race",
        contentMd: "",
        categoryId: category.id,
      }),
    ]);
    expect([
      [204, 404],
      [409, 201],
    ]).toContainEqual([deletion.status, association.status]);
    if (deletion.status === 409) {
      const { document } = await association.json();
      expect(
        (
          await request(0, path(0, document.id), "DELETE", {
            expectedRevision: "1",
          })
        ).status,
      ).toBe(204);
      expect(
        (await request(0, `${categoryPath}/${category.id}`, "DELETE")).status,
      ).toBe(204);
    }
    expect(
      (await request(0, categoryPath, "POST", { name: "RACE CATEGORY" }))
        .status,
    ).toBe(409);
    expect(
      (await request(0, `${categoryPath}/${category.id}/restore`, "POST"))
        .status,
    ).toBe(200);
  });

  it("preserves version on unchanged trash restore and snapshots category changes", async () => {
    const categoryPath = `/api/v1/orgs/${slugs[0]}/categories`;
    const { category } = await (
      await request(0, categoryPath, "POST", { name: "Trash category" })
    ).json();
    const { document } = await (
      await request(0, path(0), "POST", {
        title: "Trash",
        contentMd: "a",
        categoryId: category.id,
      })
    ).json();
    expect(
      (
        await request(1, path(0, document.id), "DELETE", {
          expectedRevision: "1",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(0, path(0, document.id), "DELETE", {
          expectedRevision: "1",
        })
      ).status,
    ).toBe(204);
    expect((await request(0, `${path(0, document.id)}/versions`)).status).toBe(
      404,
    );
    const trashPath = `/api/v1/orgs/${slugs[0]}/trash/${document.id}/restore`;
    expect(
      (await request(0, trashPath, "POST", { expectedRevision: "1" })).status,
    ).toBe(409);
    const restored = await (
      await request(0, trashPath, "POST", { expectedRevision: "2" })
    ).json();
    expect(restored.document).toMatchObject({
      revision: "3",
      contentVersion: "1",
      categoryId: category.id,
    });
    expect(
      (
        await request(0, path(0, document.id), "DELETE", {
          expectedRevision: "3",
        })
      ).status,
    ).toBe(204);
    expect(
      (await request(0, `${categoryPath}/${category.id}`, "DELETE")).status,
    ).toBe(204);
    expect(
      (await request(0, trashPath, "POST", { expectedRevision: "4" })).status,
    ).toBe(404);
    repository.failVersion = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        (
          await request(0, trashPath, "POST", {
            expectedRevision: "4",
            categoryId: null,
          })
        ).status,
      ).toBe(500);
      expect((await request(0, path(0, document.id))).status).toBe(404);
    } finally {
      repository.failVersion = false;
      spy.mockRestore();
    }
    const changed = await (
      await request(0, trashPath, "POST", {
        expectedRevision: "4",
        categoryId: null,
      })
    ).json();
    expect(changed.document).toMatchObject({
      revision: "5",
      contentVersion: "2",
      categoryId: null,
    });
    const history = await (
      await request(0, `${path(0, document.id)}/versions`)
    ).json();
    expect(
      history.versions.map((item: { changeType: string }) => item.changeType),
    ).toEqual(["trash_restore", "create"]);
  });

  it("always creates a snapshot on version restoration and rolls back a failed snapshot", async () => {
    const { document } = await (
      await request(0, path(0), "POST", { title: "Restore", contentMd: "same" })
    ).json();
    const restore = `${path(0, document.id)}/versions/1/restore`;
    const result = await (
      await request(0, restore, "POST", { expectedRevision: "1" })
    ).json();
    expect(result.document).toMatchObject({
      revision: "2",
      contentVersion: "2",
      contentMd: "same",
    });
    expect(
      (await request(0, restore, "POST", { expectedRevision: "1" })).status,
    ).toBe(409);
    expect(
      (
        await request(
          1,
          `/api/v1/orgs/${slugs[1]}/documents/${document.id}/versions/1/restore`,
          "POST",
          { expectedRevision: "2" },
        )
      ).status,
    ).toBe(404);
    const [versions] = await pool.execute<RowDataPacket[]>(
      "SELECT restored_from_version FROM document_versions WHERE tenant_id = ? AND document_id = ? AND version = 2",
      [tenants[0], document.id],
    );
    expect(versions[0].restored_from_version).toBe("1");
    repository.failVersion = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        (await request(0, restore, "POST", { expectedRevision: "2" })).status,
      ).toBe(500);
    } finally {
      repository.failVersion = false;
      spy.mockRestore();
    }
    expect(
      (await (await request(0, path(0, document.id))).json()).document,
    ).toEqual(result.document);
  });
  it("searches tenant-scoped literal Unicode substrings with deterministic pagination", async () => {
    const make = async (
      tenant: number,
      user: number,
      title: string,
      contentMd: string,
    ) => {
      const response = await request(user, path(tenant), "POST", {
        title,
        contentMd,
      });
      expect(response.status).toBe(201);
      return (await response.json()).document.id as string;
    };
    const titleId = await make(0, 0, "연차 및 휴가 신청", "other");
    const bodyId = await make(0, 0, "Other", "연차 및 휴가 신청");
    const literalId = await make(0, 0, "Percent %_ text", "Exact Case");
    const removedId = await make(0, 0, "휴가 삭제", "");
    await make(1, 2, "휴가 다른 조직", "");
    expect(
      (
        await request(0, path(0, removedId), "DELETE", {
          expectedRevision: "1",
        })
      ).status,
    ).toBe(204);
    await pool.execute(
      "UPDATE documents SET updated_at = '2026-01-01 00:00:00.000' WHERE tenant_id = ? AND id IN (?, ?)",
      [tenants[0], titleId, bodyId],
    );
    const searchPath = `/api/v1/orgs/${slugs[0]}/search`;
    const result = await (
      await request(1, `${searchPath}?q=${encodeURIComponent("휴가")}&limit=1`)
    ).json();
    const next = await (
      await request(
        1,
        `${searchPath}?q=${encodeURIComponent("휴가")}&limit=1&offset=1`,
      )
    ).json();
    expect([result.documents[0].id, next.documents[0].id]).toEqual(
      [titleId, bodyId].sort().reverse(),
    );
    const literal = await (await request(1, `${searchPath}?q=%25_`)).json();
    expect(literal.documents.map((item: { id: string }) => item.id)).toEqual([
      literalId,
    ]);
    const wrongCase = await (await request(1, `${searchPath}?q=exact`)).json();
    expect(wrongCase.documents).toHaveLength(0);
    for (const suffix of [
      "",
      "?q=x&limit=0",
      "?q=x&limit=101",
      "?q=x&offset=-1",
      "?q=x&offset=01",
      "?q=x&q=y",
      "?q=x&extra=y",
    ]) {
      expect((await request(0, `${searchPath}${suffix}`)).status).toBe(400);
    }
    expect(
      (
        await request(
          0,
          `/api/v1/orgs/${slugs[1]}/search?q=${encodeURIComponent("휴가")}`,
        )
      ).status,
    ).toBe(404);
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
