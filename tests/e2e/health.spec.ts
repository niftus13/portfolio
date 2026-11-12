import { expect, test } from "@playwright/test";

test("shows API and MySQL readiness", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText("API: ready · MySQL: connected")).toBeVisible();
});

test("reports a health request failure and allows retry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("API: ready · MySQL: connected")).toBeVisible();

  await page.route("**/api/health", (route) =>
    route.fulfill({ status: 503, body: "Service unavailable" }),
  );
  const retryButton = page.getByRole("button", { name: "Check again" });
  await expect(retryButton).toBeEnabled();
  await retryButton.click();
  await expect(page.getByRole("alert")).toContainText(
    "Service status is unavailable",
  );

  await page.unrouteAll();
  await retryButton.click();
  await expect(page.getByText("API: ready · MySQL: connected")).toBeVisible();
});

test("provides responsive keyboard-accessible workspace navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "본문으로 건너뛰기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(nav.getByRole("link", { name: "대시보드" })).toHaveClass(
    /nav-active/,
  );
  await nav.getByRole("link", { name: "계정" }).click();
  await expect(
    page.getByRole("heading", { name: "계정", exact: true }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "계정" })).toHaveClass(
    /nav-active/,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
