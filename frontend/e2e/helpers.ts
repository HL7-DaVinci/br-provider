import { expect, type Page, type Response } from "@playwright/test";

export const CANDLE_FHIR_URL =
  process.env.CANDLE_FHIR_URL ?? "http://localhost:5826/fhir/r4";
export const CANDLE_METADATA_URL = `${CANDLE_FHIR_URL}/metadata`;

export async function isCandleReachable(): Promise<boolean> {
  try {
    const res = await fetch(CANDLE_METADATA_URL);
    return res.ok;
  } catch {
    return false;
  }
}

/** Selects a practitioner or patient option on /login by matching account text. */
async function selectAccountOption(page: Page, accountMatch: string) {
  await page.getByRole("combobox").first().click();
  await page
    .getByRole("option", { name: new RegExp(accountMatch) })
    .first()
    .click();
}

/**
 * Logs in against a local/OAuth-backed server. Handles the FAST RI redirect
 * chain, which may show a username/password login form, a consent screen,
 * or both, depending on whether the RI already has a session.
 */
export async function login(page: Page, accountMatch: string) {
  await page.goto("/login");
  await selectAccountOption(page, accountMatch);
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForURL(
    (url) => url.pathname === "/practitioner" || url.port === "5001",
    { timeout: 30_000 },
  );

  if (new URL(page.url()).port === "5001") {
    await handleFastRiAuth(page, accountMatch);
  }

  await page.waitForURL("**/practitioner", { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function handleFastRiAuth(page: Page, accountMatch: string) {
  const usernameInput = page.locator('input[name="username"]');
  const allowButton = page.getByRole("button", { name: /yes,\s*allow/i });

  await Promise.race([
    usernameInput.first().waitFor({ state: "visible", timeout: 30_000 }),
    allowButton.waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  if (
    (await usernameInput.count()) > 0 &&
    (await usernameInput.first().isVisible())
  ) {
    await usernameInput.first().fill(accountMatch);
    await page.locator('input[name="password"]').fill("test");
    await page
      .locator('button[type="submit"], input[type="submit"]')
      .first()
      .click();
    await allowButton.waitFor({ state: "visible", timeout: 30_000 });
  }

  await allowButton.click();
}

/** Logs in against a no-auth server (fhir-candle) where /login skips the redirect. */
export async function loginNoAuth(page: Page, accountMatch: string) {
  await page.goto("/login");
  await expect(
    page.getByText("This server does not require authentication"),
  ).toBeVisible();
  await selectAccountOption(page, accountMatch);
  await page.getByRole("button", { name: "Sign In" }).click();
  await page.waitForURL("**/practitioner", { timeout: 15_000 });
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open settings" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

async function closeSettingsViaCancel(page: Page) {
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

/** Switches the active FHIR provider server to a custom URL and waits for the sign-out redirect. */
export async function setCustomFhirServer(page: Page, url: string) {
  await page.goto("/");
  await openSettings(page);
  await page.getByLabel("FHIR Server").click();
  await page.getByRole("option", { name: "Custom URL..." }).click();
  await page.getByLabel("Custom Server URL").fill(url);
  await page.getByRole("button", { name: "Test Connection" }).click();
  await expect(page.getByText(/Valid FHIR server/)).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForURL("**/", { timeout: 15_000 });
  // The dialog stores the active server only after its POST resolves. Waiting
  // on the stored value stops the next navigation from discarding that write.
  await page.waitForFunction(
    (expected) => localStorage.getItem("fhir-server-url") === expected,
    url.replace(/\/+$/, ""),
    { timeout: 15_000 },
  );
}

/**
 * Sets the "Bypass payor-handled check" setting to the desired state. No-ops
 * (via Cancel) if the persisted state already matches, since Save is disabled
 * when nothing changed.
 */
export async function setBypassPayorCheck(page: Page, desired: boolean) {
  await openSettings(page);
  const checkbox = page.getByRole("checkbox", {
    name: "Bypass payor-handled check",
  });
  const currentlyChecked =
    (await checkbox.getAttribute("aria-checked")) === "true";

  if (currentlyChecked === desired) {
    await closeSettingsViaCancel(page);
    return;
  }

  await checkbox.click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}

/**
 * Navigates to the patient summary page and clicks Start Encounter, which
 * fires the encounter-start CDS hook. Returns that hook's HTTP response.
 */
export async function startEncounter(
  page: Page,
  patientId: string,
): Promise<Response> {
  await page.goto(`/patients/${patientId}`);
  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("encounter-start"),
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Start Encounter" }).click();
  return responsePromise;
}

/**
 * Adds an E0424 oxygen system order, fills in coverage, and signs it. Returns
 * the order-sign hook's HTTP response.
 */
export async function signOxygenOrder(page: Page): Promise<Response> {
  // These SelectTriggers render an unlabeled combobox role in the accessibility
  // tree (no aria-label/associated <label>), so getByRole's name filter never
  // matches. Filtering by visible text content works instead.
  await page
    .getByRole("combobox")
    .filter({ hasText: "Select an order to add..." })
    .click();
  await page.getByRole("option", { name: /E0424/ }).click();
  await page.getByRole("button", { name: "Add" }).click();

  await page
    .getByRole("combobox")
    .filter({ hasText: "Select coverage" })
    .click();
  await page.getByRole("option").first().click();

  await page.getByRole("button", { name: /Sign All Orders/ }).click();

  const responsePromise = page.waitForResponse(
    (res) => res.url().includes("order-sign"),
    { timeout: 30_000 },
  );
  await page.getByRole("button", { name: "Confirm & Sign" }).click();
  return responsePromise;
}
