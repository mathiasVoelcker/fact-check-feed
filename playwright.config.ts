import { defineConfig, devices } from "@playwright/test";
import { assertLocalDatabaseUrl } from "./e2e/local-database";

const PORT = 3100;
// Refuses anything but a local database before a server is built or started (design X2).
const databaseUrl = assertLocalDatabaseUrl(process.env.E2E_DATABASE_URL);

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  // One database, and the tests only read it: run them one at a time.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The production build, as deployed (design X3). `reuseExistingServer` is off so a stale server never serves old code.
  webServer: {
    command: `npm run build && npm start -- -p ${PORT} -H 127.0.0.1`,
    // Playwright starts the server before `globalSetup`, so it must not judge readiness by requesting a page: `/` reads the
    // database, which is not migrated yet. It waits for Next's own "Ready" line instead.
    wait: { stdout: /Ready in/ },
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DATABASE_URL: databaseUrl },
  },
});
