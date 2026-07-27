import { afterEach, describe, expect, it } from "vitest";
import {
  clearStoredCustomOpenServer,
  getPasNotificationUrl,
  getServerByRequestUrl,
  getStoredServerHeaders,
  isStoredCustomOpenServer,
  resolvePayerAuthMode,
  sanitizeCustomHeaders,
  sanitizePayerAuthMode,
  setStoredCustomOpenServer,
  setStoredServerHeaders,
} from "./fhir-config";

describe("stored server headers", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips headers keyed by normalized url", () => {
    setStoredServerHeaders("http://s.test/fhir/", [
      { name: "X-One", value: "1" },
    ]);
    expect(getStoredServerHeaders("http://s.test/fhir")).toEqual([
      { name: "X-One", value: "1" },
    ]);
  });

  it("clears the entry when saved empty", () => {
    setStoredServerHeaders("http://s.test/fhir", [
      { name: "X-One", value: "1" },
    ]);
    setStoredServerHeaders("http://s.test/fhir", undefined);
    expect(getStoredServerHeaders("http://s.test/fhir")).toEqual([]);
    expect(localStorage.getItem("fhir-server-headers")).toBe("{}");
  });

  it("sanitizes on read and survives corrupt blobs", () => {
    localStorage.setItem("fhir-server-headers", "not json");
    expect(getStoredServerHeaders("http://s.test/fhir")).toEqual([]);
    localStorage.setItem(
      "fhir-server-headers",
      JSON.stringify({
        "http://s.test/fhir": [
          { name: "Host", value: "evil" },
          { name: "X-Ok", value: "1" },
        ],
      }),
    );
    expect(getStoredServerHeaders("http://s.test/fhir")).toEqual([
      { name: "X-Ok", value: "1" },
    ]);
  });
});

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

describe("sanitizeCustomHeaders", () => {
  it("keeps valid entries and trims names", () => {
    expect(
      sanitizeCustomHeaders([{ name: " X-Api-Key ", value: "abc" }]),
    ).toEqual([{ name: "X-Api-Key", value: "abc" }]);
  });

  it("drops disallowed, duplicate, empty, and malformed entries", () => {
    expect(
      sanitizeCustomHeaders([
        { name: "Host", value: "evil" },
        { name: "Expect", value: "100-continue" },
        { name: "X-One", value: "1" },
        { name: "x-one", value: "2" },
        { name: "", value: "x" },
        { name: "X-Two" },
        "junk",
        null,
      ]),
    ).toEqual([{ name: "X-One", value: "1" }]);
  });

  it("returns undefined for non-arrays and empty results", () => {
    expect(sanitizeCustomHeaders("nope")).toBeUndefined();
    expect(
      sanitizeCustomHeaders([{ name: "Host", value: "x" }]),
    ).toBeUndefined();
  });

  it("drops an entry whose name Headers.set() would reject", () => {
    expect(
      sanitizeCustomHeaders([
        { name: "X Api Key", value: "abc" },
        { name: "X-Api-Key", value: "abc" },
      ]),
    ).toEqual([{ name: "X-Api-Key", value: "abc" }]);
  });

  it("drops an entry whose value contains a newline", () => {
    expect(
      sanitizeCustomHeaders([
        { name: "X-Bad", value: "abc\ndef" },
        { name: "X-Good", value: "abc" },
      ]),
    ).toEqual([{ name: "X-Good", value: "abc" }]);
  });
});

describe("resolvePayerAuthMode", () => {
  const base = { name: "P", cdsUrl: "http://p/cds", fhirUrl: "http://p/fhir" };

  it("authMode wins over requiresAuth", () => {
    expect(
      resolvePayerAuthMode({ ...base, authMode: "open", requiresAuth: true }),
    ).toBe("open");
  });

  it("maps requiresAuth false to open and true to udap-b2b", () => {
    expect(resolvePayerAuthMode({ ...base, requiresAuth: false })).toBe("open");
    expect(resolvePayerAuthMode({ ...base, requiresAuth: true })).toBe(
      "udap-b2b",
    );
  });

  it("defaults to auto", () => {
    expect(resolvePayerAuthMode(base)).toBe("auto");
  });
});

describe("sanitizePayerAuthMode", () => {
  it("accepts known modes and rejects everything else", () => {
    expect(sanitizePayerAuthMode("udap-b2b")).toBe("udap-b2b");
    expect(sanitizePayerAuthMode("smart")).toBeUndefined();
    expect(sanitizePayerAuthMode(42)).toBeUndefined();
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
