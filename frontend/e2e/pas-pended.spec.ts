import { expect, type Page, test } from "@playwright/test";
import {
  login,
  setBypassPayorCheck,
  signOxygenOrder,
  startEncounter,
} from "./helpers";

const LOCAL_PRACTITIONER_MATCH = "pra1234";

test.describe("PAS pended prior-authorization workflow", () => {
  test.describe.configure({ mode: "serial", timeout: 240_000 });

  let page: Page;
  let encounterUrl: string;
  let pasUrl: string;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.setTimeout(240_000);
    page = await browser.newPage();
    await login(page, LOCAL_PRACTITIONER_MATCH);
    await setBypassPayorCheck(page, false);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("pended PA: submit, additional documentation, approval", async () => {
    const encounterStart = await startEncounter(page, "pat013");
    expect(encounterStart.status()).toBe(200);
    encounterUrl = page.url();

    const orderSign = await signOxygenOrder(page);
    expect(orderSign.status()).toBe(200);

    // Submit PA from the Linked Orders table.
    await page.getByRole("button", { name: "Submit PA" }).click();
    await page.waitForURL(/\/orders\/[^/]+\/pas/, { timeout: 30_000 });
    pasUrl = page.url();

    const claimSubmitPromise = page.waitForResponse(
      (res) =>
        res.url().includes("$submit") &&
        !res.url().includes("$submit-attachment"),
      { timeout: 30_000 },
    );
    // ensureSubscription searches for an existing Subscription (keyed by
    // payer + notification URL, not per-claim) before creating one, so on a
    // long-lived dev server that already has one registered, only the search
    // GET fires and the create POST is skipped.
    const subscriptionSearchPromise = page.waitForResponse(
      (res) => res.url().includes("Subscription"),
      { timeout: 30_000 },
    );
    await page
      .getByRole("button", { name: "Submit Prior Authorization" })
      .click();

    const claimSubmitResponse = await claimSubmitPromise;
    expect(claimSubmitResponse.status()).toBe(200);
    await subscriptionSearchPromise;

    await expect(page.getByText("Pended")).toBeVisible();
    await expect(
      page.getByText("Waiting for payer review. Refreshing automatically."),
    ).toBeVisible();
    await expect(
      page.getByText("Additional Documentation Requested"),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Complete Additional Documentation" }),
    ).toBeVisible();

    // Mid-flow check: the task worklist reflects the outstanding documentation request.
    // Worklist rows have an onRowClick handler, which renders them with an
    // explicit role="button" (not the table's implicit "row" role).
    await page.goto("/practitioner/tasks");
    const activeRow = page
      .getByRole("button", { name: /Questionnaire requested/ })
      .first();
    await expect(activeRow).toBeVisible();
    await expect(activeRow).toHaveText(/Waiting on you: complete AUTH TRN/);

    await activeRow.click();
    const taskSheet = page.getByRole("dialog");
    await expect(
      taskSheet.getByRole("button", { name: "Complete questionnaire" }),
    ).toBeVisible();
    await expect(
      taskSheet.getByRole("link", { name: "Open order" }),
    ).toBeVisible();
    await expect(
      taskSheet.getByRole("button", { name: "Submit to payer" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(taskSheet).toBeHidden();

    // Complete the requested documentation from the PAS page.
    await page.goto(pasUrl);
    await expect(page.getByText("Pended")).toBeVisible();

    await page
      .getByRole("button", { name: "Complete Additional Documentation" })
      .click();

    const docSheet = page
      .getByRole("dialog")
      .filter({ hasText: "Documentation" });
    await expect(docSheet).toBeVisible();
    // The payer compiles the questionnaire's CQL libraries on first use, so a
    // cold stack can take tens of seconds to serve the questionnaire package.
    await expect(
      docSheet.getByRole("heading", {
        name: "Home Oxygen Therapy Order Template",
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The CDex $submit-attachment fires automatically after Complete.
    const submitAttachmentPromise = page.waitForResponse(
      (res) =>
        res.url().includes("$submit-attachment") &&
        res.request().method() === "POST",
      { timeout: 30_000 },
    );
    await docSheet.getByRole("button", { name: "Complete" }).click();

    await expect(
      docSheet.getByText(/Viewing: QuestionnaireResponse/),
    ).toBeVisible();
    const submitAttachmentResponse = await submitAttachmentPromise;
    expect(submitAttachmentResponse.status()).toBe(200);

    await docSheet.getByRole("button", { name: "Close task sheet" }).click();
    await expect(docSheet).toBeHidden();

    // The payer resolves the pended PA asynchronously. The page self-polls.
    await expect(page.getByText("Approved")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText("Certified in total")).toBeVisible();
    await expect(page.getByText(/AUTH-\d+/)).toBeVisible();
    await expect(
      page.getByText("Documentation submitted to the payer."),
    ).toBeVisible();

    // Completed tab in the task worklist reflects the fulfilled request.
    // Worklist rows have an onRowClick handler, which renders them with an
    // explicit role="button" (not the table's implicit "row" role).
    await page.goto("/practitioner/tasks");
    await page.getByRole("tab", { name: /Completed/ }).click();
    const completedRow = page
      .getByRole("button", { name: /Questionnaire requested/ })
      .first();
    await expect(completedRow).toBeVisible();
    await expect(completedRow).toHaveText(/Completed/);
    await expect(completedRow).toHaveText(/Documentation submitted to payer/);

    // Back on the encounter, the order shows the approved authorization.
    await page.goto(encounterUrl);
    const orderRow = page.getByRole("row").filter({ hasText: "Approved" });
    await expect(orderRow).toBeVisible();
    await expect(
      orderRow.getByRole("button", { name: "View PA" }),
    ).toBeVisible();
  });
});
