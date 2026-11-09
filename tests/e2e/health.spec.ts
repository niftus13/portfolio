import { expect, test } from "@playwright/test";

test("shows API and MySQL readiness", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Portfolio" })).toBeVisible();
  await expect(page.getByText("API: ready · MySQL: connected")).toBeVisible();
});
