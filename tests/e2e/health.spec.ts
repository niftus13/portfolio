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
