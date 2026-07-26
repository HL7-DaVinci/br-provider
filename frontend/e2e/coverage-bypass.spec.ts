import { expect, type Page, test } from "@playwright/test";
import {
  CANDLE_FHIR_URL,
  isCandleReachable,
  login,
  loginNoAuth,
  setBypassPayorCheck,
  setCustomFhirServer,
  signOxygenOrder,
  startEncounter,
} from "./helpers";

const LOCAL_PRACTITIONER_MATCH = "pra1234";
// fhir-candle's seed data uses its own practitioner ids, distinct from the
// local provider server's; pra1234 does not exist there.
const CANDLE_PRACTITIONER_MATCH = "Practitioner1";

test.describe("Phase A: local EHR - Bypass payor-handled check", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let page: Page;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    page = await browser.newPage();
    await login(page, LOCAL_PRACTITIONER_MATCH);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("A1: bypass OFF - order workflow succeeds", async () => {
    await setBypassPayorCheck(page, false);

    const encounterStart = await startEncounter(page, "pat013");
    expect(encounterStart.status()).toBe(200);
    const encounterStartBody = await encounterStart.json();
    expect(Array.isArray(encounterStartBody.cards)).toBe(true);
    expect(encounterStartBody.cards.length).toBeGreaterThan(0);

    const orderSign = await signOxygenOrder(page);
    expect(orderSign.status()).toBe(200);
    const orderSignBody = await orderSign.json();
    expect(Array.isArray(orderSignBody.systemActions)).toBe(true);
    expect(orderSignBody.systemActions.length).toBeGreaterThan(0);
  });

  test("A2: bypass ON - order workflow succeeds", async () => {
    await setBypassPayorCheck(page, true);

    const encounterStart = await startEncounter(page, "pat013");
    expect(encounterStart.status()).toBe(200);
    const encounterStartBody = await encounterStart.json();
    expect(Array.isArray(encounterStartBody.cards)).toBe(true);
    expect(encounterStartBody.cards.length).toBeGreaterThan(0);

    const orderSign = await signOxygenOrder(page);
    expect(orderSign.status()).toBe(200);
    const orderSignBody = await orderSign.json();
    expect(Array.isArray(orderSignBody.systemActions)).toBe(true);
    expect(orderSignBody.systemActions.length).toBeGreaterThan(0);
  });
});

test.describe("Phase B: custom EHR (fhir-candle) - Bypass payor-handled check", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let page: Page;
  let candleAvailable = false;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(120_000);
    candleAvailable = await isCandleReachable();
    if (!candleAvailable) return;

    page = await browser.newPage();
    await setCustomFhirServer(page, CANDLE_FHIR_URL);
    await loginNoAuth(page, CANDLE_PRACTITIONER_MATCH);
  });

  test.beforeEach(() => {
    test.skip(
      !candleAvailable,
      `fhir-candle (${CANDLE_FHIR_URL}) is not reachable`,
    );
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("B1: bypass OFF, patient 1001 - no Coverage error", async () => {
    await setBypassPayorCheck(page, false);

    const encounterStart = await startEncounter(page, "1001");
    expect(encounterStart.status()).toBe(400);
    await expect(
      page.getByText(
        "No Coverage resource is accessible for this patient. A Coverage resource with a valid payer identifier is required.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("B2: bypass ON, patient 1001 - no Coverage error persists", async () => {
    await setBypassPayorCheck(page, true);

    const encounterStart = await startEncounter(page, "1001");
    expect(encounterStart.status()).toBe(400);
    await expect(
      page.getByText(
        "No Coverage resource is accessible for this patient. A Coverage resource with a valid payer identifier is required.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("B3: bypass OFF, patient Patient1 - payer not handled error", async () => {
    await setBypassPayorCheck(page, false);

    const encounterStart = await startEncounter(page, "Patient1");
    expect(encounterStart.status()).toBe(400);
    await expect(
      page.getByText(
        "The payer identifier in Coverage is not handled by this CRD server endpoint.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("B4: bypass ON, patient Patient1 - eligibility verified", async () => {
    await setBypassPayorCheck(page, true);

    const encounterStart = await startEncounter(page, "Patient1");
    expect(encounterStart.status()).toBe(200);
    await expect(
      page.getByText(/Outpatient encounter eligibility verified/),
    ).toBeVisible();
  });
});
