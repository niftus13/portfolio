import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import mysql, { type RowDataPacket } from "mysql2/promise";

test("signup, login, session expiry and logout through the real proxy", async ({
  page,
  context,
}) => {
  const email = `${randomUUID()}@browser-test.invalid`;
  const password = "browser-test-password-123";
  const connection = await mysql.createConnection({
    host: process.env.TEST_DB_HOST,
    port: Number(process.env.TEST_DB_PORT),
    user: process.env.TEST_DB_USER,
    password: process.env.TEST_DB_PASSWORD,
    database: process.env.TEST_DB_NAME,
  });
  const [baseline] = await connection.query<RowDataPacket[]>(
    "SELECT COALESCE(MAX(id), 0) AS id FROM auth_rate_events",
  );
  const csrfCookies = new Set<string>();
  const rememberCookie = async () => {
    const cookie = (await context.cookies()).find(
      (item) => item.name === "portfolio_preauth",
    );
    if (cookie) csrfCookies.add(cookie.value);
  };
  try {
    await page.goto("/login");
    await page.getByRole("button", { name: "회원가입" }).click();
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("이름").fill("브라우저 사용자");
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "가입", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("가입이 완료");
    await rememberCookie();
    const before = await page.evaluate(async () => {
      const response = await fetch("/api/v1/csrf-token");
      return (await response.json()).csrfToken as string;
    });
    const invalidStatus = await page.evaluate(async (token) => {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": token,
          "X-Forwarded-For": "203.0.113.99",
        },
        body: "{}",
      });
      return response.status;
    }, before);
    expect(invalidStatus).toBe(400);
    const [forwarded] = await connection.execute<RowDataPacket[]>(
      "SELECT key_hash FROM auth_rate_keys WHERE scope = 'login_ip' AND key_hash IN (?, ?)",
      [
        createHash("sha256").update("127.0.0.1").digest(),
        createHash("sha256").update("203.0.113.99").digest(),
      ],
    );
    expect(forwarded.map((row) => row.key_hash.toString("hex"))).toContain(
      createHash("sha256").update("127.0.0.1").digest("hex"),
    );
    expect(forwarded.map((row) => row.key_hash.toString("hex"))).not.toContain(
      createHash("sha256").update("203.0.113.99").digest("hex"),
    );
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByText("소속된 조직이 없습니다", { exact: false }),
    ).toBeVisible();
    const after = await page.evaluate(async () => {
      const response = await fetch("/api/v1/csrf-token");
      return (await response.json()).csrfToken as string;
    });
    expect(after).not.toBe(before);
    const sessionCookie = (await context.cookies()).find(
      (item) => item.name === "portfolio_session",
    );
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe("Lax");
    await page.getByRole("button", { name: "로그아웃" }).click();
    await expect(page.getByRole("status")).toContainText("로그아웃");

    await page.evaluate(() => fetch("/api/v1/csrf-token"));
    await rememberCookie();
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByText("소속된 조직이 없습니다", { exact: false }),
    ).toBeVisible();
    await connection.execute(
      "UPDATE sessions s JOIN users u ON u.id = s.user_id SET s.last_activity_at = UTC_TIMESTAMP(3) - INTERVAL 3 HOUR WHERE u.email = ?",
      [email],
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "로그인" })).toBeVisible();
  } finally {
    await rememberCookie();
    const [users] = await connection.execute<RowDataPacket[]>(
      "SELECT id FROM users WHERE email = ?",
      [email],
    );
    const id = users[0]?.id;
    if (id) {
      await connection.execute(
        "DELETE c FROM csrf_states c JOIN sessions s ON s.id = c.session_id WHERE s.user_id = ?",
        [id],
      );
      await connection.execute(
        "DELETE FROM auth_audit_logs WHERE actor_user_id = ?",
        [id],
      );
      await connection.execute("DELETE FROM sessions WHERE user_id = ?", [id]);
      await connection.execute("DELETE FROM users WHERE id = ?", [id]);
    }
    for (const cookie of csrfCookies) {
      const hash = createHash("sha256").update(cookie).digest();
      await connection.execute(
        "DELETE FROM csrf_states WHERE preauth_hash = ?",
        [hash],
      );
    }
    const hashes = [
      createHash("sha256").update(email).digest(),
      createHash("sha256").update("127.0.0.1").digest(),
    ];
    for (const hash of hashes) {
      await connection.execute(
        "DELETE FROM auth_rate_events WHERE key_hash = ? AND id > ?",
        [hash, baseline[0].id],
      );
      await connection.execute(
        "DELETE k FROM auth_rate_keys k LEFT JOIN auth_rate_events e ON e.scope = k.scope AND e.key_hash = k.key_hash WHERE k.key_hash = ? AND e.id IS NULL",
        [hash],
      );
    }
    await connection.end();
  }
});
