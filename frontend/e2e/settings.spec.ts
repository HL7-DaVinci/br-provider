import { expect, test } from "@playwright/test";
import { login, openSettings } from "./helpers";

const LOCAL_PRACTITIONER_MATCH = "pra1234";

test.describe("settings dialog", () => {
  test("tabs render and save is disabled with no changes", async ({ page }) => {
    await page.goto("/");
    await openSettings(page, "Provider/EHR");
    await expect(page.getByRole("tab", { name: "Provider/EHR" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByRole("tab", { name: "Payer" }).click();
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("payer custom header persists and rides CDS requests as X-Fwd-", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    // Discovery only fires on a patient workflow page (the encounter editor
    // mounts useCdsHooks), so this needs a logged-in practitioner rather than
    // the home page used by the other two tests.
    await login(page, LOCAL_PRACTITIONER_MATCH);

    await openSettings(page, "Payer");
    await page.getByRole("button", { name: "Add header" }).click();
    await page.getByLabel("Header 1 name").fill("X-Trace");
    await page.getByLabel("Header 1 value").fill("e2e-token");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("payer-server") ?? "{}"),
    );
    expect(stored.headers).toEqual([{ name: "X-Trace", value: "e2e-token" }]);

    // The discovery GET is proxied through the BFF, so the custom header
    // arrives prefixed X-Fwd- and gets stripped/forwarded server-side.
    const discoveryRequestPromise = page.waitForRequest(
      (req) => req.url().includes("/api/cds-services?"),
      { timeout: 30_000 },
    );
    await page.goto("/patients/pat013");
    await page.getByRole("button", { name: "Start Encounter" }).click();
    const request = await discoveryRequestPromise;
    expect(request.headers()["x-fwd-x-trace"]).toBe("e2e-token");
  });

  test("saved custom payer appears under Recent and can be removed", async ({
    page,
  }) => {
    await page.goto("/");
    await openSettings(page, "Payer");
    await page.getByLabel("Server").click();
    await page.getByRole("option", { name: "Custom..." }).click();
    await page
      .getByLabel("CDS Services URL")
      .fill("http://localhost:8081/cds-services");
    await page.getByLabel("FHIR URL").fill("http://localhost:8081/fhir");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();

    await openSettings(page, "Payer");
    await page.getByLabel("Server").click();
    await expect(page.getByText("Recent")).toBeVisible();
    const recentOption = page.getByRole("option", { name: /Custom Payer/ });
    await expect(recentOption).toBeVisible();

    await page
      .getByRole("button", { name: "Remove Custom Payer from recents" })
      .click();
    await expect(recentOption).toBeHidden();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Cancel" }).click();
  });
});
