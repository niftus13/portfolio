import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rmdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

import mysql, {
  type Pool,
  type PoolConnection,
  type RowDataPacket,
} from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createApp } from "../../../apps/api/src/app.js";
import { migrate } from "../../../apps/api/src/database/migrate.js";
import { AuthRepository } from "../../../apps/api/src/repositories/auth.js";
import { AuthService } from "../../../apps/api/src/services/auth.js";

const origin = "http://127.0.0.1:3100";
const password = "test-password-123";
const namespace = randomBytes(8).toString("hex");

class TestAuthRepository extends AuthRepository {
  failAudit = false;
  failRevocation = false;

  override async revokeSession(id: string): Promise<boolean> {
    if (this.failRevocation) throw new Error("Injected revocation failure");
    return super.revokeSession(id);
  }

  protected override async audit(
    connection: Pool | PoolConnection,
    action: string,
    success: boolean,
    userId: string | null,
    requestId: string,
  ): Promise<void> {
    if (this.failAudit) {
      await connection.execute(
        "INSERT INTO auth_audit_logs (test_nonexistent_column) VALUES (1)",
      );
      return;
    }
    return super.audit(connection, action, success, userId, requestId);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing required test environment variable: ${name}`);
  return value;
}

class Client {
  private readonly cookies = new Map<string, string>();
  constructor(
    private readonly base: string,
    private readonly ip: string,
    private readonly rememberCsrf: (token: string) => void,
  ) {}

  async request(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      csrf?: string;
      origin?: string | null;
      compressed?: Uint8Array<ArrayBuffer>;
    } = {},
  ): Promise<Response> {
    const headers = new Headers({ "X-Forwarded-For": this.ip });
    if (this.cookies.size) {
      headers.set(
        "Cookie",
        [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "),
      );
    }
    if (options.method === "POST") {
      headers.set("Content-Type", "application/json");
      if (options.origin !== null)
        headers.set("Origin", options.origin ?? origin);
    }
    if (options.csrf) headers.set("X-CSRF-Token", options.csrf);
    if (options.compressed) headers.set("Content-Encoding", "gzip");
    const response = await fetch(`${this.base}${path}`, {
      method: options.method ?? "GET",
      headers,
      body:
        options.compressed ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    });
    for (const header of response.headers.getSetCookie()) {
      const first = header.split(";")[0];
      const separator = first.indexOf("=");
      const name = first.slice(0, separator);
      const value = first.slice(separator + 1);
      if (value) this.cookies.set(name, value);
      else this.cookies.delete(name);
    }
    return response;
  }

  async csrf(): Promise<string> {
    const response = await this.request("/api/v1/csrf-token");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const data: { csrfToken: string } = await response.json();
    this.rememberCsrf(data.csrfToken);
    return data.csrfToken;
  }
}

describe("authentication with isolated MySQL", () => {
  let pool: Pool;
  let server: Server;
  let base: string;
  let logDirectory: string;
  let logPath: string;
  let repository: TestAuthRepository;
  let ipCounter = 1;
  const emails: string[] = [];
  const ips: string[] = [];
  const csrfTokens = new Set<string>();

  function client(): Client {
    const ip = `198.18.${parseInt(namespace.slice(0, 2), 16)}.${ipCounter++}`;
    ips.push(ip);
    return new Client(base, ip, (value) => csrfTokens.add(value));
  }

  async function signup(c: Client): Promise<string> {
    const email = `${randomUUID()}@${namespace}.invalid`;
    emails.push(email);
    const response = await c.request("/api/v1/auth/signup", {
      method: "POST",
      csrf: await c.csrf(),
      body: { email, password, displayName: "Tester" },
    });
    expect(response.status).toBe(201);
    return email;
  }

  async function login(c: Client, email: string): Promise<Response> {
    return c.request("/api/v1/auth/login", {
      method: "POST",
      csrf: await c.csrf(),
      body: { email, password },
    });
  }

  beforeAll(async () => {
    const database = required("TEST_DB_NAME");
    if (!/^portfolio_test_[a-z0-9_]+$/.test(database)) {
      throw new Error("TEST_DB_NAME must start with portfolio_test_");
    }
    const port = Number(required("TEST_DB_PORT"));
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid test DB port");
    pool = mysql.createPool({
      host: required("TEST_DB_HOST"),
      port,
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
    logDirectory = await mkdtemp(join(tmpdir(), "portfolio-auth-test-"));
    logPath = join(logDirectory, "audit.log");
    repository = new TestAuthRepository(pool);
    const service = new AuthService(
      repository,
      logPath,
      () => `${namespace}-${randomUUID()}`,
    );
    server = createServer(
      createApp({
        checkDatabase: async () => {
          await pool.query("SELECT 1");
        },
        auth: {
          service,
          allowedOrigin: origin,
          secure: false,
          trustProxy: "loopback",
        },
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No test server address");
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    if (pool) {
      await pool.execute(
        "DELETE FROM auth_audit_logs WHERE request_id LIKE ?",
        [`${namespace}-%`],
      );
      for (const email of emails) {
        const [users] = await pool.execute<RowDataPacket[]>(
          "SELECT id FROM users WHERE email = ?",
          [email],
        );
        const id = users[0]?.id;
        if (!id) continue;
        await pool.execute(
          "DELETE c FROM csrf_states c JOIN sessions s ON s.id = c.session_id WHERE s.user_id = ?",
          [id],
        );
        await pool.execute("DELETE FROM sessions WHERE user_id = ?", [id]);
        await pool.execute("DELETE FROM users WHERE id = ?", [id]);
      }
      for (const csrf of csrfTokens) {
        await pool.execute(
          "DELETE FROM csrf_states WHERE token = ? AND preauth_hash IS NOT NULL",
          [csrf],
        );
      }
      for (const key of [...ips, ...emails, `unknown@${namespace}.invalid`]) {
        const hash = createHash("sha256").update(key).digest();
        await pool.execute("DELETE FROM auth_rate_events WHERE key_hash = ?", [
          hash,
        ]);
        await pool.execute("DELETE FROM auth_rate_keys WHERE key_hash = ?", [
          hash,
        ]);
      }
      await pool.end();
    }
    if (logDirectory) {
      await unlink(logPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      await rmdir(logDirectory);
    }
  });

  it("supports signup, session CSRF rotation, current user and logout", async () => {
    const c = client();
    const initial = await c.csrf();
    expect(await c.csrf()).toBe(initial);
    const email = await signup(c);
    const duplicate = await c.request("/api/v1/auth/signup", {
      method: "POST",
      csrf: initial,
      body: { email, password, displayName: "Tester" },
    });
    expect(duplicate.status).toBe(409);
    const response = await login(c, email);
    expect(response.status).toBe(200);
    const data: { csrfToken: string; hasOrganizations: boolean } =
      await response.json();
    expect(data.csrfToken).not.toBe(initial);
    expect(data.hasOrganizations).toBe(false);
    expect(await c.csrf()).toBe(data.csrfToken);
    expect((await c.request("/api/v1/auth/me")).status).toBe(200);
    expect(
      (
        await c.request("/api/v1/auth/logout", {
          method: "POST",
          csrf: initial,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await c.request("/api/v1/auth/logout", {
          method: "POST",
          csrf: data.csrfToken,
        })
      ).status,
    ).toBe(204);
    expect((await c.request("/api/v1/auth/me")).status).toBe(401);
  });

  it("uses a secure host-only pre-login cookie for HTTPS", async () => {
    const service = new AuthService(repository, logPath);
    const httpsApp = createServer(
      createApp({
        checkDatabase: async () => {
          await pool.query("SELECT 1");
        },
        auth: {
          service,
          allowedOrigin: "https://example.invalid",
          secure: true,
          trustProxy: "loopback",
        },
      }),
    );
    await new Promise<void>((resolve, reject) => {
      httpsApp.once("error", reject);
      httpsApp.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = httpsApp.address();
      if (!address || typeof address === "string")
        throw new Error("No test server address");
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/v1/csrf-token`,
      );
      const cookie = response.headers.getSetCookie()[0];
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("SameSite=Lax");
      expect(cookie).toContain("Path=/");
      expect(cookie).not.toContain("Domain=");
      const body: { csrfToken: string } = await response.json();
      csrfTokens.add(body.csrfToken);
    } finally {
      await new Promise<void>((resolve, reject) =>
        httpsApp.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects invalid origin and expired pre-login CSRF", async () => {
    const c = client();
    const csrf = await c.csrf();
    expect(
      (await c.request("/api/v1/auth/logout", { method: "POST", csrf })).status,
    ).toBe(401);
    const body = { email: `${namespace}@invalid.example`, password };
    expect(
      (
        await c.request("/api/v1/auth/login", {
          method: "POST",
          csrf,
          body,
          origin: null,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await c.request("/api/v1/auth/login", {
          method: "POST",
          csrf,
          body,
          origin: "https://evil.invalid",
        })
      ).status,
    ).toBe(403);
    await pool.execute(
      "UPDATE csrf_states SET expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE token = ?",
      [csrf],
    );
    expect(
      (await c.request("/api/v1/auth/login", { method: "POST", csrf, body }))
        .status,
    ).toBe(403);
    expect(await c.csrf()).not.toBe(csrf);
  });

  it("does not revive idle or absolutely expired sessions and rejects suspended users", async () => {
    const c = client();
    const email = await signup(c);
    for (const cause of ["idle", "absolute", "suspended"]) {
      expect((await login(c, email)).status).toBe(200);
      if (cause === "idle") {
        await pool.execute(
          "UPDATE sessions s JOIN users u ON u.id = s.user_id SET s.last_activity_at = UTC_TIMESTAMP(3) - INTERVAL 3 HOUR WHERE u.email = ?",
          [email],
        );
      } else if (cause === "absolute") {
        await pool.execute(
          "UPDATE sessions s JOIN users u ON u.id = s.user_id SET s.expires_at = UTC_TIMESTAMP(3) - INTERVAL 1 SECOND WHERE u.email = ?",
          [email],
        );
      } else {
        await pool.execute(
          "UPDATE users SET status = 'suspended' WHERE email = ?",
          [email],
        );
      }
      expect((await c.request("/api/v1/auth/me")).status).toBe(401);
    }
    const suspendedLogin = await login(c, email);
    expect(suspendedLogin.status).toBe(401);
    expect(await suspendedLogin.json()).toEqual({
      error: "Invalid credentials",
    });
  });

  it("allows only one concurrent login using the same pre-login state", async () => {
    const c = client();
    const email = await signup(c);
    const csrf = await c.csrf();
    const attempt = () =>
      c.request("/api/v1/auth/login", {
        method: "POST",
        csrf,
        body: { email, password },
      });
    const results = await Promise.all([attempt(), attempt()]);
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 403,
    ]);
    const [sessions] = await pool.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?",
      [email],
    );
    expect(sessions[0].count).toBe(1);
  });

  it("reports logout failure if session revocation fails", async () => {
    const c = client();
    const email = await signup(c);
    expect((await login(c, email)).status).toBe(200);
    const csrf = await c.csrf();
    repository.failRevocation = true;
    try {
      expect(
        (await c.request("/api/v1/auth/logout", { method: "POST", csrf }))
          .status,
      ).toBe(500);
      expect((await c.request("/api/v1/auth/me")).status).toBe(200);
    } finally {
      repository.failRevocation = false;
    }
  });

  it("returns identical failures for unknown and wrong-password accounts and limits attempts", async () => {
    const c = client();
    const email = await signup(c);
    const csrf = await c.csrf();
    const wrong = await c.request("/api/v1/auth/login", {
      method: "POST",
      csrf,
      body: { email, password: "wrong-password-123" },
    });
    const unknown = await c.request("/api/v1/auth/login", {
      method: "POST",
      csrf,
      body: {
        email: `unknown@${namespace}.invalid`,
        password: "wrong-password-123",
      },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await wrong.json()).toEqual(await unknown.json());
    for (let i = 0; i < 9; i++) {
      expect(
        (
          await c.request("/api/v1/auth/login", {
            method: "POST",
            csrf,
            body: { email, password: "wrong-password-123" },
          })
        ).status,
      ).toBe(401);
    }
    const limited = await c.request("/api/v1/auth/login", {
      method: "POST",
      csrf,
      body: { email, password },
    });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts invalid signup attempts and serializes concurrent IP login limits", async () => {
    const signupClient = client();
    const signupCsrf = await signupClient.csrf();
    for (let index = 0; index < 5; index++) {
      expect(
        (
          await signupClient.request("/api/v1/auth/signup", {
            method: "POST",
            csrf: signupCsrf,
            body: {},
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await signupClient.request("/api/v1/auth/signup", {
          method: "POST",
          csrf: signupCsrf,
          body: {},
        })
      ).status,
    ).toBe(429);

    const loginClient = client();
    const loginCsrf = await loginClient.csrf();
    const responses = await Promise.all(
      Array.from({ length: 31 }, () =>
        loginClient.request("/api/v1/auth/login", {
          method: "POST",
          csrf: loginCsrf,
          body: {},
        }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 400),
    ).toHaveLength(30);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(1);
  });

  it("limits decompressed JSON at exactly one MiB", async () => {
    const c = client();
    const csrf = await c.csrf();
    const make = (size: number) => {
      const overhead = Buffer.byteLength(JSON.stringify({ data: "" }));
      return new Uint8Array(
        gzipSync(JSON.stringify({ data: "x".repeat(size - overhead) })),
      );
    };
    expect(
      (
        await c.request("/api/v1/auth/signup", {
          method: "POST",
          csrf,
          compressed: make(1048576),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await c.request("/api/v1/auth/signup", {
          method: "POST",
          csrf,
          compressed: make(1048577),
        })
      ).status,
    ).toBe(413);
  });

  it("preserves authentication policy when audit writes fail", async () => {
    const c = client();
    const email = await signup(c);
    expect((await login(c, email)).status).toBe(200);
    const sessionCsrf = await c.csrf();
    const other = client();
    const preauth = await other.csrf();
    repository.failAudit = true;
    try {
      const badLogin = await other.request("/api/v1/auth/login", {
        method: "POST",
        csrf: preauth,
        body: { email, password: "wrong-password-123" },
      });
      expect(badLogin.status).toBe(401);
      expect(
        (
          await c.request("/api/v1/auth/logout", {
            method: "POST",
            csrf: sessionCsrf,
          })
        ).status,
      ).toBe(204);
      expect((await c.request("/api/v1/auth/me")).status).toBe(401);
      const [before] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?",
        [email],
      );
      const failedSuccess = await other.request("/api/v1/auth/login", {
        method: "POST",
        csrf: preauth,
        body: { email, password },
      });
      expect(failedSuccess.status).toBe(500);
      expect((await other.request("/api/v1/auth/me")).status).toBe(401);
      const [after] = await pool.execute<RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM sessions s JOIN users u ON u.id = s.user_id WHERE u.email = ?",
        [email],
      );
      expect(after[0].count).toBe(before[0].count);
      const text = await readFile(logPath, "utf8");
      expect(text).toContain('"action":"login_failure"');
      expect(text).toContain('"action":"logout"');
      expect(text).toContain('"action":"login"');
      expect(text).not.toContain(email);
      expect(text).not.toContain(password);
      expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    } finally {
      repository.failAudit = false;
    }
  });

  it("reports a log-file failure without revealing or accepting a failed login", async () => {
    const email = `missing-${randomUUID()}@${namespace}.invalid`;
    const ip = `198.18.${parseInt(namespace.slice(0, 2), 16)}.${ipCounter++}`;
    emails.push(email);
    ips.push(ip);
    const logger = vi.spyOn(console, "error").mockImplementation(() => {});
    repository.failAudit = true;
    try {
      const service = new AuthService(
        repository,
        join(logDirectory, "missing", "audit.log"),
      );
      await expect(
        service.login({ email, password }, ip, undefined, undefined),
      ).rejects.toMatchObject({ status: 401, message: "Invalid credentials" });
      expect(logger).toHaveBeenCalledWith(
        "Authentication audit failure could not be written to log",
        expect.objectContaining({ code: "ENOENT" }),
      );
    } finally {
      repository.failAudit = false;
      logger.mockRestore();
    }
  });
});
