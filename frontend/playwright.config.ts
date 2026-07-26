import { defineConfig, devices } from "@playwright/test";

/**
 * E2E browser tests against a running stack. Two ways to provide one:
 *
 * 1. Dev mode (default, `bun e2e`) - start the stack yourself:
 *    - provider server:  http://localhost:8080  (cd server && mvn spring-boot:run)
 *    - payer server:     http://localhost:8081  (br-payer repo)
 *    - FAST Security RI: https://localhost:5001
 *    - frontend dev:     http://localhost:3000  (bun dev)
 *    - fhir-candle EHR:  http://localhost:5826  (optional: candle-dependent
 *      tests skip themselves when it is down)
 *
 * 2. Stack mode (`bun e2e:stack`) - boots the whole stack via the repo root
 *    docker-compose.yml, runs the tests against the built SPA on port 8080,
 *    then tears the stack down.
 *
 * Environment overrides:
 *    BASE_URL           frontend URL (default http://localhost:3000)
 *    CANDLE_FHIR_URL    candle FHIR base (default http://localhost:5826/fhir/r4)
 *    E2E_WAIT_TIMEOUT   seconds the preflight waits for services (default 15)
 *    E2E_REQUIRE_CANDLE set to fail the preflight when candle is down
 *    E2E_BROWSER_CHANNEL  run an installed system browser (chrome or msedge)
 *      instead of downloading Playwright's chromium. Use this where the
 *      browser CDN is unreachable. Edge ships with Windows.
 */

// Left unset, tests run Playwright's pinned chromium so every machine and CI
// use the same browser build.
const channel = process.env.E2E_BROWSER_CHANNEL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], ...(channel ? { channel } : {}) },
    },
  ],
});
