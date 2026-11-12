import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import mysql, { type RowDataPacket } from "mysql2/promise";

import { hashPassword } from "../../apps/api/src/identity/password.js";

test("owner creates and edits a document through the real proxy and keeps a conflicting draft", async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const userId = randomUUID();
  const memberUserId = randomUUID();
  const tenantId = randomUUID();
  const slug = `browser-${randomUUID()}`;
  const email = `${userId}@browser-test.invalid`;
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
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await connection.execute(
      `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
      VALUES (?, ?, ?, 'Browser owner', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [userId, email, await hashPassword(password)],
    );
    await connection.execute(
      `INSERT INTO users (id, email, password_hash, display_name, status, is_demo, created_at, updated_at)
      VALUES (?, ?, 'unused', 'Browser viewer', 'active', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [memberUserId, `${memberUserId}@browser-test.invalid`],
    );
    await connection.execute(
      `INSERT INTO tenants (id, slug, name, is_demo, created_at, updated_at)
      VALUES (?, ?, 'Browser organization', 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [tenantId, slug],
    );
    await connection.execute(
      `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'owner', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [randomUUID(), tenantId, userId],
    );
    await connection.execute(
      `INSERT INTO memberships (id, tenant_id, user_id, is_demo, role, status, created_at, updated_at)
      VALUES (?, ?, ?, 0, 'viewer', 'active', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [randomUUID(), tenantId, memberUserId],
    );

    await page.goto("/login");
    await page.getByLabel("이메일").fill(email);
    await page.getByLabel("비밀번호").fill(password);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await page.getByRole("link", { name: "조직과 문서 보기" }).click();
    await page
      .getByRole("button", { name: "Browser organization (owner)" })
      .click();
    await expect(
      page.getByRole("button", { name: "카테고리 추가" }),
    ).toBeEnabled();
    await page.getByLabel("카테고리 이름").fill("브라우저 분류");
    await page.getByRole("button", { name: "카테고리 추가" }).click();
    await expect(
      page
        .getByLabel("관리할 카테고리")
        .getByRole("option", { name: "브라우저 분류" }),
    ).toHaveCount(1);
    await expect(page.getByRole("button", { name: "새 문서" })).toBeEnabled();
    await page.getByRole("button", { name: "새 문서" }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("제목", { exact: true }).fill("브라우저 문서");
    await page.getByLabel("본문 (Markdown 원문)").fill("최초 내용");
    await page
      .getByLabel("카테고리", { exact: true })
      .selectOption({ label: "브라우저 분류" });
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("status")).toContainText("저장했습니다");
    await expect(page.getByText("버전 1 · revision 1")).toBeVisible();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByLabel("본문 (Markdown 원문)").fill("수정 내용");
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("버전 2 · revision 2")).toBeVisible();
    await expect(
      page.getByText("버전 2 · update", { exact: false }),
    ).toBeVisible();

    await page.getByLabel("본문 (Markdown 원문)").fill("보존할 입력");
    const externalStatus = await page.evaluate(async (org) => {
      const list = await (await fetch(`/api/v1/orgs/${org}/documents`)).json();
      const token = await (await fetch("/api/v1/csrf-token")).json();
      return (
        await fetch(`/api/v1/orgs/${org}/documents/${list.documents[0].id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": token.csrfToken,
          },
          body: JSON.stringify({
            expectedRevision: "2",
            contentMd: "다른 변경",
          }),
        })
      ).status;
    }, slug);
    expect(externalStatus).toBe(200);
    await page.getByRole("button", { name: "저장" }).click();
    await expect(page.getByRole("alert")).toContainText("충돌");
    await expect(page.getByLabel("본문 (Markdown 원문)")).toHaveValue(
      "보존할 입력",
    );
    await page.getByRole("button", { name: "최신 revision 불러오기" }).click();
    await expect(page.getByLabel("본문 (Markdown 원문)")).toHaveValue(
      "보존할 입력",
    );
    await expect(page.getByText("버전 3 · revision 3")).toBeVisible();
    const [rows] = await connection.execute<RowDataPacket[]>(
      "SELECT content_md, revision FROM documents WHERE tenant_id = ?",
      [tenantId],
    );
    expect(rows).toMatchObject([{ content_md: "다른 변경", revision: 3 }]);
    await page.getByText("버전 1 · create", { exact: false }).click();
    await page.getByRole("button", { name: "이 버전 복원" }).click();
    await expect(page.getByText("버전 4 · revision 4")).toBeVisible();
    await expect(page.getByLabel("본문 (Markdown 원문)")).toHaveValue(
      "최초 내용",
    );
    await page.getByRole("button", { name: "문서 삭제" }).click();
    await expect(page.getByRole("button", { name: "문서 복구" })).toBeVisible();
    await page.getByRole("button", { name: "문서 복구" }).click();
    await expect(
      page.getByRole("button", { name: "브라우저 문서" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "브라우저 문서" }).click();
    await page
      .getByLabel("본문 (Markdown 원문)")
      .fill(
        "# 제목\n\n**강조**\n\n[허용](/guide) [위험](javascript:alert(1))\n\n<img src=x onerror=alert(1)>",
      );
    const preview = page.getByRole("region", { name: "Markdown 미리보기" });
    await expect(preview.getByRole("heading", { name: "제목" })).toBeVisible();
    await expect(preview.getByRole("link", { name: "허용" })).toBeVisible();
    await expect(preview.getByRole("link", { name: "위험" })).toHaveCount(0);
    await expect(preview.locator("img")).toHaveCount(0);
    await page.getByLabel("제목·본문 검색").fill("브라우저");
    await page.getByRole("button", { name: "검색", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "검색 결과: 브라우저" }),
    ).toBeVisible();
    await expect(page.getByText("일치하는 문서가 없습니다.")).toHaveCount(0);
    await page.getByRole("button", { name: "멤버 불러오기" }).click();
    await page.getByLabel("멤버", { exact: true }).selectOption({
      label: `Browser viewer (${memberUserId}@browser-test.invalid) · viewer · active`,
    });
    await page.getByLabel("상태", { exact: true }).selectOption("inactive");
    await page.getByRole("button", { name: "멤버 저장" }).click();
    await expect(
      page.getByText("멤버 상태를 저장했습니다", { exact: false }),
    ).toBeVisible();
    const [membershipRows] = await connection.execute<RowDataPacket[]>(
      "SELECT status FROM memberships WHERE tenant_id = ? AND user_id = ?",
      [tenantId, memberUserId],
    );
    expect(membershipRows).toMatchObject([{ status: "inactive" }]);
  } finally {
    try {
      const preauth = (await context.cookies()).find(
        (item) => item.name === "portfolio_preauth",
      );
      if (preauth)
        await connection.execute(
          "DELETE FROM csrf_states WHERE preauth_hash = ?",
          [createHash("sha256").update(preauth.value).digest()],
        );
    } finally {
      await connection.execute("DELETE FROM audit_logs WHERE tenant_id = ?", [
        tenantId,
      ]);
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
      await connection.execute("DELETE FROM memberships WHERE tenant_id = ?", [
        tenantId,
      ]);
      await connection.execute("DELETE FROM tenants WHERE id = ?", [tenantId]);
      await connection.execute(
        "DELETE c FROM csrf_states c JOIN sessions s ON s.id = c.session_id WHERE s.user_id = ?",
        [userId],
      );
      await connection.execute(
        "DELETE FROM auth_audit_logs WHERE actor_user_id = ?",
        [userId],
      );
      await connection.execute("DELETE FROM sessions WHERE user_id = ?", [
        userId,
      ]);
      await connection.execute("DELETE FROM users WHERE id = ?", [userId]);
      await connection.execute("DELETE FROM users WHERE id = ?", [
        memberUserId,
      ]);
      for (const key of [email, "127.0.0.1"]) {
        const hash = createHash("sha256").update(key).digest();
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
  }
});
