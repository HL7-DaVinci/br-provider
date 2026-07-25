import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredCustomOpenServer,
  getPasNotificationUrl,
  getServerByRequestUrl,
  isStoredCustomOpenServer,
  setStoredCustomOpenServer,
} from "./fhir-config";

describe("getPasNotificationUrl", () => {
  afterEach(() => {
    window.APP_CONFIG = undefined;
  });

  it("appends the ehr param to the derived origin URL", () => {
    window.APP_CONFIG = { apiBaseUrl: "http://localhost:8080" };
    expect(getPasNotificationUrl("http://localhost:8080/fhir")).toBe(
      "http://localhost:8080/api/pas/notification?ehr=http%3A%2F%2Flocalhost%3A8080%2Ffhir",
    );
  });

  it("falls back to window.location.origin when apiBaseUrl is not configured", () => {
    expect(getPasNotificationUrl("http://localhost:8090/fhir")).toBe(
      `${window.location.origin}/api/pas/notification?ehr=http%3A%2F%2Flocalhost%3A8090%2Ffhir`,
    );
  });

  it("appends with & when the configured override already has a query", () => {
    window.APP_CONFIG = {
      pasNotificationUrl: "https://me.example.com/api/pas/notification?x=1",
    };
    expect(getPasNotificationUrl("https://ehr.example.com/fhir")).toBe(
      "https://me.example.com/api/pas/notification?x=1&ehr=https%3A%2F%2Fehr.example.com%2Ffhir",
    );
  });

  it("derives the webhook base from the app's own API base URL, not an external provider FHIR base", () => {
    window.APP_CONFIG = { apiBaseUrl: "http://localhost:8080" };
    expect(getPasNotificationUrl("http://localhost:8090/fhir")).toBe(
      "http://localhost:8080/api/pas/notification?ehr=http%3A%2F%2Flocalhost%3A8090%2Ffhir",
    );
  });
});

describe("custom open server storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("round trips through set and clear, normalizing a trailing slash", () => {
    setStoredCustomOpenServer("https://custom.example.com/fhir/");

    expect(isStoredCustomOpenServer("https://custom.example.com/fhir")).toBe(
      true,
    );

    clearStoredCustomOpenServer();

    expect(isStoredCustomOpenServer("https://custom.example.com/fhir")).toBe(
      false,
    );
  });

  it("returns false for a URL that does not match the stored record", () => {
    setStoredCustomOpenServer("https://custom.example.com/fhir");

    expect(isStoredCustomOpenServer("https://other.example.com/fhir")).toBe(
      false,
    );
  });

  it("returns false when no record has been stored", () => {
    expect(isStoredCustomOpenServer("https://custom.example.com/fhir")).toBe(
      false,
    );
  });

  it("returns false for malformed stored JSON", () => {
    localStorage.setItem("fhir-custom-open-server", "not json");

    expect(isStoredCustomOpenServer("https://custom.example.com/fhir")).toBe(
      false,
    );
  });
});

describe("getServerByRequestUrl for a custom server", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("includes requiresAuth: false when the current server matches a stored open record", () => {
    localStorage.setItem("fhir-server-url", "https://custom.example.com/fhir");
    setStoredCustomOpenServer("https://custom.example.com/fhir");

    const server = getServerByRequestUrl(
      "https://custom.example.com/fhir/Patient/1",
    );

    expect(server?.requiresAuth).toBe(false);
  });

  it("omits requiresAuth when no open record matches the current server", () => {
    localStorage.setItem("fhir-server-url", "https://custom.example.com/fhir");

    const server = getServerByRequestUrl(
      "https://custom.example.com/fhir/Patient/1",
    );

    expect(server?.requiresAuth).toBeUndefined();
  });
});
