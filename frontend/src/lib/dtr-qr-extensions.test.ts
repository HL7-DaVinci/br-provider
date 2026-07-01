import type { Extension } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  QR_CONTEXT_EXT_URL,
  QR_COVERAGE_EXT_URL,
  upsertQrDtrExtensions,
} from "./dtr-qr-extensions";

describe("upsertQrDtrExtensions", () => {
  it("adds a qr-context per order and the required qr-coverage", () => {
    const out = upsertQrDtrExtensions(
      [],
      ["ServiceRequest/sr-1"],
      "Coverage/cov-1",
    );
    expect(
      out
        .filter((e) => e.url === QR_CONTEXT_EXT_URL)
        .map((e) => e.valueReference?.reference),
    ).toEqual(["ServiceRequest/sr-1"]);
    expect(
      out.find((e) => e.url === QR_COVERAGE_EXT_URL)?.valueReference?.reference,
    ).toBe("Coverage/cov-1");
  });

  it("omits qr-coverage when no coverage is known", () => {
    const out = upsertQrDtrExtensions([], ["ServiceRequest/sr-1"]);
    expect(out.some((e) => e.url === QR_COVERAGE_EXT_URL)).toBe(false);
  });

  it("replaces existing qr-context/qr-coverage without duplicating, preserving others", () => {
    const existing: Extension[] = [
      {
        url: QR_CONTEXT_EXT_URL,
        valueReference: { reference: "ServiceRequest/old" },
      },
      {
        url: QR_COVERAGE_EXT_URL,
        valueReference: { reference: "Coverage/old" },
      },
      { url: "http://example.org/other", valueString: "keep" },
    ];
    const out = upsertQrDtrExtensions(
      existing,
      ["DeviceRequest/dr-1"],
      "Coverage/cov-2",
    );
    expect(out.filter((e) => e.url === QR_CONTEXT_EXT_URL)).toHaveLength(1);
    expect(
      out.find((e) => e.url === QR_CONTEXT_EXT_URL)?.valueReference?.reference,
    ).toBe("DeviceRequest/dr-1");
    expect(out.filter((e) => e.url === QR_COVERAGE_EXT_URL)).toHaveLength(1);
    expect(
      out.find((e) => e.url === QR_COVERAGE_EXT_URL)?.valueReference?.reference,
    ).toBe("Coverage/cov-2");
    expect(out.some((e) => e.url === "http://example.org/other")).toBe(true);
  });
});
