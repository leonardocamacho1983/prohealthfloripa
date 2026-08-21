import { expect, test } from "@playwright/test";

test("a página de entrada identifica a ProHealth e oferece cadastro", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).toHaveTitle(/ProHealth/i);
  await expect(page.getByRole("img", { name: /ProHealth Saúde e Performance/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /criar|cadastro|cadastre|registre/i }).first()).toBeVisible();
});

test("a página de cadastro existe e mantém a identidade", async ({ page }) => {
  await page.goto("/sign-up");
  await expect(page).not.toHaveURL(/404/);
  await expect(page.getByRole("img", { name: /ProHealth Saúde e Performance/i }).first()).toBeVisible();
});
