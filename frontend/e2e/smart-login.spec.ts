import { expect, test } from "@playwright/test";
import { openSettings } from "./helpers";
import { type SmartStub, startSmartStub } from "./smart-stub";

const CLIENT_ID = "br-provider-e2e";

// In stack mode the provider server runs in Docker and reaches the
// test-local stub through host.docker.internal instead of localhost.
const STUB_BFF_HOST = process.env.E2E_STUB_HOST ?? "localhost";

test.describe("SMART standalone provider login", () => {
  let stub: SmartStub;

  test.beforeAll(async () => {
    stub = await startSmartStub(STUB_BFF_HOST);
  });

  test.afterAll(async () => {
    await stub?.close();
  });

  test("signs in via SMART discovery and proxies FHIR reads through the BFF", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    await page.goto("/");
    await openSettings(page, "Provider/EHR");
    await page.getByLabel("FHIR Server").click();
    await page.getByRole("option", { name: "Custom URL..." }).click();
    await page.getByLabel("Custom Server URL").fill(stub.fhirBaseUrl);
    await page.getByRole("button", { name: "Test Connection" }).click();
    await expect(page.getByText("SMART-enabled server")).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("Client ID").fill(CLIENT_ID);

    // The BFF's /auth/login 302s to the stub's authorize endpoint, which
    // bounces straight back to /callback with a code. Capturing that hop
    // proves the PKCE and aud parameters the server-side client sent. The
    // stub's token endpoint independently verifies the S256 code_verifier.
    const authorizeRequestPromise = page.waitForRequest(
      (req) => req.url().includes(`:${stub.port}/authorize`),
      { timeout: 30_000 },
    );
    const patientSearchPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/fhir-proxy") && res.url().includes("Patient"),
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "Save & Sign In" }).click();

    const authorize = new URL((await authorizeRequestPromise).url());
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorize.searchParams.get("aud")).toBe(stub.fhirBaseUrl);
    expect(authorize.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authorize.searchParams.get("state")).toBeTruthy();

    await page.waitForURL("**/practitioner", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    // Tokens stay in the BFF session. The browser only holds display info.
    const storage = await page.evaluate(() => ({
      keys: Object.keys(sessionStorage),
      userinfo: sessionStorage.getItem("spa_userinfo"),
    }));
    expect(
      storage.keys.filter((k) => k.toLowerCase().includes("token")),
    ).toEqual([]);
    expect(JSON.parse(storage.userinfo ?? "{}").fhirUserType).toBe(
      "Practitioner",
    );

    // The stub's FHIR API rejects requests without the issued Bearer token,
    // so a passing search proves the proxy injected it server-side.
    const patientSearch = await patientSearchPromise;
    expect(patientSearch.ok()).toBe(true);
    await expect(
      page.getByRole("link", { name: /Stub/ }).first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(
      page.getByRole("banner").getByRole("link", { name: "Sign In" }),
    ).toBeVisible();
  });
});
