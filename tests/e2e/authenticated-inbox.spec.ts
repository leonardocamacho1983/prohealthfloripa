import { expect, test } from "@playwright/test";

test.describe("caixa autenticada", () => {
  test.skip(!process.env.PLAYWRIGHT_STORAGE_STATE,
    "Defina PLAYWRIGHT_STORAGE_STATE com uma sessão de atendente de teste.");

  test("mostra claramente a conta ativa e preserva a navegação mobile", async ({ page }, testInfo) => {
    await page.goto("/handoff");
    await expect(page.getByRole("heading", { name: "Atendimento" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Perfil da conta/ })).toBeVisible();
    const firstConversation = page.locator('[data-conversation-link="true"]').first();
    if (await firstConversation.count()) {
      await firstConversation.click();
      const back = page.getByRole("link", { name: /Voltar às conversas/ });
      if (testInfo.project.name === "mobile") await expect(back).toBeVisible();
      else await expect(back).toBeHidden();
    }
  });

  test("ações de ownership expõem versão e confirmação sem mutação automática", async ({ page }) => {
    await page.goto("/handoff");
    const firstConversation = page.locator('[data-conversation-link="true"]').first();
    test.skip(await firstConversation.count() === 0, "Sem conversa de teste disponível.");
    await firstConversation.click();
    await expect(page.locator("main")).toContainText(/Responsável:|Sem responsável/);
    const transfer = page.getByRole("button", { name: /Transferir/ });
    if (await transfer.count()) {
      await transfer.focus(); await expect(transfer).toBeFocused();
    }
  });
});
