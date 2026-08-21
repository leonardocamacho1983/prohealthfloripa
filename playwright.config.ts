import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  outputDir: "output/playwright/results",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "https://prohealthfloripa.vercel.app",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PLAYWRIGHT_STORAGE_STATE
      ? { storageState: process.env.PLAYWRIGHT_STORAGE_STATE } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome" } },
  ],
});
