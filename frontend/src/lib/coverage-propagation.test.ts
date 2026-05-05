import type { Extension, ServiceRequest } from "fhir/r4";
import { describe, expect, it } from "vitest";
import { COVERAGE_INFO_EXT_URL } from "./coverage-extensions";
import { applyQrCisToOrder } from "./coverage-propagation";

function ciExt(
  coverage: string | undefined,
  coverageAssertionId: string | undefined,
  marker?: string,
): Extension {
  const inner: Extension[] = [];
  if (coverage !== undefined) {
    inner.push({ url: "coverage", valueReference: { reference: coverage } });
  }
  if (coverageAssertionId !== undefined) {
    inner.push({
      url: "coverage-assertion-id",
      valueString: coverageAssertionId,
    });
  }
  if (marker !== undefined) {
    inner.push({ url: "detail", valueString: marker });
  }
  return { url: COVERAGE_INFO_EXT_URL, extension: inner };
}

function unrelatedExt(): Extension {
  return {
    url: "https://example.org/some-other-extension",
    valueString: "leave me alone",
  };
}

function order(extensions: Extension[]): ServiceRequest {
  return {
    resourceType: "ServiceRequest",
    id: "o1",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/p1" },
    extension: extensions,
  };
}

describe("applyQrCisToOrder", () => {
  it("replaces an order CI when its primary key matches a QR CI", () => {
    const qrCis = [ciExt("Coverage/c1", "a1", "from-qr")];
    const ord = order([ciExt("Coverage/c1", "a1", "stale")]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(1);
    expect(result.extension?.[0]).toEqual(qrCis[0]);
  });

  it("appends a QR CI when no order CI has the same primary key", () => {
    const qrCis = [ciExt("Coverage/c2", "a2", "from-qr")];
    const ord = order([ciExt("Coverage/c1", "a1", "existing")]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(2);
    expect(result.extension?.[0]).toEqual(
      ciExt("Coverage/c1", "a1", "existing"),
    );
    expect(result.extension?.[1]).toEqual(qrCis[0]);
  });

  it("appends when only coverage matches but assertion id differs", () => {
    const qrCis = [ciExt("Coverage/c1", "a2", "from-qr")];
    const ord = order([ciExt("Coverage/c1", "a1", "existing")]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(2);
    expect(result.extension?.[0]).toEqual(
      ciExt("Coverage/c1", "a1", "existing"),
    );
    expect(result.extension?.[1]).toEqual(qrCis[0]);
  });

  it("appends when only assertion id matches but coverage differs", () => {
    const qrCis = [ciExt("Coverage/c2", "a1", "from-qr")];
    const ord = order([ciExt("Coverage/c1", "a1", "existing")]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(2);
    expect(result.extension?.[1]).toEqual(qrCis[0]);
  });

  it("handles a QR with multiple CIs, mixed match/no-match", () => {
    const qrCis = [
      ciExt("Coverage/c1", "a1", "replacement-1"),
      ciExt("Coverage/c2", "a2", "addition"),
    ];
    const ord = order([
      ciExt("Coverage/c1", "a1", "stale-1"),
      ciExt("Coverage/c3", "a3", "untouched"),
    ]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(3);
    expect(result.extension?.[0]).toEqual(qrCis[0]); // replaced in place
    expect(result.extension?.[1]).toEqual(
      ciExt("Coverage/c3", "a3", "untouched"),
    ); // untouched
    expect(result.extension?.[2]).toEqual(qrCis[1]); // appended
  });

  it("appends a QR CI missing one half of the primary key (cannot match)", () => {
    const qrCis = [ciExt("Coverage/c1", undefined, "no-assertion-id")];
    const ord = order([ciExt("Coverage/c1", "a1", "existing")]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(2);
    expect(result.extension?.[1]).toEqual(qrCis[0]);
  });

  it("preserves unrelated extensions on the order", () => {
    const qrCis = [ciExt("Coverage/c1", "a1", "from-qr")];
    const ord = order([
      unrelatedExt(),
      ciExt("Coverage/c1", "a1", "stale"),
      unrelatedExt(),
    ]);

    const result = applyQrCisToOrder(ord, qrCis);

    expect(result.extension).toHaveLength(3);
    expect(result.extension?.[0]).toEqual(unrelatedExt());
    expect(result.extension?.[1]).toEqual(qrCis[0]);
    expect(result.extension?.[2]).toEqual(unrelatedExt());
  });

  it("returns the order unchanged when QR CI list is empty", () => {
    const ord = order([ciExt("Coverage/c1", "a1", "untouched")]);
    const result = applyQrCisToOrder(ord, []);
    expect(result.extension).toEqual(ord.extension);
  });

  it("handles an order with no extension array", () => {
    const qrCis = [ciExt("Coverage/c1", "a1", "from-qr")];
    const bare: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "o1",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/p1" },
    };

    const result = applyQrCisToOrder(bare, qrCis);

    expect(result.extension).toHaveLength(1);
    expect(result.extension?.[0]).toEqual(qrCis[0]);
  });
});
