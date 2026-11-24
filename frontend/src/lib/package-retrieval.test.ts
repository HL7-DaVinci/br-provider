import type { QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  ADAPTIVE_EXT_URL,
  adaptivePackageFromQr,
  changedSinceForQr,
  extractPackageOutcome,
  getPackageRetrievedAt,
  outcomeHasErrors,
  PACKAGE_RETRIEVED_EXT_URL,
  resolveResumeHints,
  retrievalInstant,
  setPackageRetrievedAt,
} from "./package-retrieval";

const Q = "https://example.org/Questionnaire/Q";
const OTHER = "https://example.org/Questionnaire/Other";

function qr(
  id: string,
  questionnaire: string,
  options: {
    status?: QuestionnaireResponse["status"];
    lastUpdated?: string;
    retrievedAt?: string;
  } = {},
): QuestionnaireResponse {
  const result: QuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    id,
    questionnaire,
    status: options.status ?? "in-progress",
    meta: options.lastUpdated
      ? { lastUpdated: options.lastUpdated }
      : undefined,
  };
  if (options.retrievedAt) setPackageRetrievedAt(result, options.retrievedAt);
  return result;
}

describe("package retrieval extension", () => {
  it("replaces an existing value instead of adding a second", () => {
    const r = qr("a", Q, { retrievedAt: "2026-01-01T00:00:00.000Z" });
    setPackageRetrievedAt(r, "2026-02-01T00:00:00.000Z");
    expect(
      r.extension?.filter((e) => e.url === PACKAGE_RETRIEVED_EXT_URL),
    ).toHaveLength(1);
    expect(getPackageRetrievedAt(r)).toBe("2026-02-01T00:00:00.000Z");
  });

  it("prefers the recorded time over meta.lastUpdated", () => {
    expect(
      changedSinceForQr(
        qr("a", Q, {
          lastUpdated: "2026-03-01T00:00:00.000Z",
          retrievedAt: "2026-01-01T00:00:00.000Z",
        }),
      ),
    ).toBe("2026-01-01T00:00:00.000Z");
    expect(
      changedSinceForQr(
        qr("b", Q, { lastUpdated: "2026-03-01T00:00:00.000Z" }),
      ),
    ).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("resolveResumeHints", () => {
  it("uses the most recently updated in-progress QR per canonical", () => {
    const result = resolveResumeHints(
      [`${Q}|1.0`, OTHER],
      [
        qr("old", Q, {
          lastUpdated: "2026-01-01T00:00:00Z",
          retrievedAt: "2025-12-01T00:00:00.000Z",
        }),
        qr("new", `${Q}|1.0`, {
          lastUpdated: "2026-02-01T00:00:00Z",
          retrievedAt: "2026-01-15T00:00:00.000Z",
        }),
      ],
    );
    expect(result).toEqual({
      [`${Q}|1.0`]: { changedSince: "2026-01-15T00:00:00.000Z" },
    });
  });

  it("prefers the launch QR when it is in progress", () => {
    const launch = qr("launch", Q, {
      lastUpdated: "2025-01-01T00:00:00Z",
      retrievedAt: "2024-12-01T00:00:00.000Z",
    });
    const newer = qr("newer", Q, { lastUpdated: "2026-01-01T00:00:00Z" });
    expect(resolveResumeHints([Q], [newer], launch)).toEqual({
      [Q]: { changedSince: "2024-12-01T00:00:00.000Z" },
    });
  });

  it("ignores a completed launch QR", () => {
    const launch = qr("done", Q, {
      status: "completed",
      retrievedAt: "2024-12-01T00:00:00.000Z",
    });
    expect(resolveResumeHints([Q], [], launch)).toEqual({});
  });

  it("matches adaptive QRs through their contained Questionnaire", () => {
    const adaptive: QuestionnaireResponse = {
      ...qr("adaptive", "#aq", { retrievedAt: "2026-04-01T00:00:00.000Z" }),
      contained: [
        {
          resourceType: "Questionnaire",
          id: "aq",
          status: "active",
          derivedFrom: [Q],
        },
      ],
    };
    const hint = resolveResumeHints([Q], [adaptive])[Q];
    expect(hint?.changedSince).toBe("2026-04-01T00:00:00.000Z");
    expect(hint?.unchangedBundle).toBeDefined();
  });
});

describe("retrievalInstant", () => {
  const requested = new Date("2026-11-20T12:00:05.500Z");

  it("takes the earlier of request start and the Date header", () => {
    expect(retrievalInstant(requested, "Fri, 20 Nov 2026 12:00:03 GMT")).toBe(
      "2026-11-20T12:00:03.000Z",
    );
    expect(retrievalInstant(requested, "Fri, 20 Nov 2026 12:09:00 GMT")).toBe(
      "2026-11-20T12:00:05.500Z",
    );
  });

  it("falls back to request start without a usable Date header", () => {
    expect(retrievalInstant(requested, null)).toBe("2026-11-20T12:00:05.500Z");
    expect(retrievalInstant(requested, "garbage")).toBe(
      "2026-11-20T12:00:05.500Z",
    );
  });
});

describe("adaptivePackageFromQr", () => {
  function adaptiveDraft(
    contained: QuestionnaireResponse["contained"],
  ): QuestionnaireResponse {
    return { ...qr("a", "#aq"), contained };
  }

  it("rebuilds the package under the original canonical", () => {
    const bundle = adaptivePackageFromQr(
      adaptiveDraft([
        {
          resourceType: "Questionnaire",
          id: "aq",
          status: "active",
          url: "https://payer.example.org/Questionnaire/instance-1",
          derivedFrom: [`${Q}|2.0`],
          item: [{ linkId: "1", type: "string" }],
        },
        { resourceType: "Library", id: "lib", status: "active", type: {} },
        { resourceType: "ValueSet", id: "vs", status: "active" },
        {
          resourceType: "Coverage",
          id: "cov",
          status: "active",
          beneficiary: {},
          payor: [],
        },
      ]),
    );
    const types = bundle?.entry?.map((e) => e.resource?.resourceType);
    expect(types).toEqual(["Questionnaire", "Library", "ValueSet"]);
    const q = bundle?.entry?.[0]?.resource as {
      url?: string;
      version?: string;
      item?: unknown[];
      extension?: { url: string }[];
    };
    expect(q.url).toBe(Q);
    expect(q.version).toBe("2.0");
    expect(q.item).toHaveLength(1);
    expect(q.extension?.map((e) => e.url)).toContain(ADAPTIVE_EXT_URL);
  });

  it("does not duplicate an existing adaptive extension", () => {
    const bundle = adaptivePackageFromQr(
      adaptiveDraft([
        {
          resourceType: "Questionnaire",
          id: "aq",
          status: "active",
          derivedFrom: [Q],
          extension: [{ url: ADAPTIVE_EXT_URL, valueBoolean: true }],
        },
      ]),
    );
    const q = bundle?.entry?.[0]?.resource as { extension?: unknown[] };
    expect(q.extension).toHaveLength(1);
  });

  it("returns undefined for a QR that answers a canonical", () => {
    expect(adaptivePackageFromQr(qr("std", Q))).toBeUndefined();
  });
});

describe("package outcome", () => {
  const errorOutcome = {
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code: "processing" }],
  };

  it("reads the outcome parameter or a bare OperationOutcome", () => {
    expect(
      extractPackageOutcome({
        resourceType: "Parameters",
        parameter: [{ name: "outcome", resource: errorOutcome }],
      }),
    ).toEqual(errorOutcome);
    expect(extractPackageOutcome(errorOutcome)).toEqual(errorOutcome);
    expect(
      extractPackageOutcome({ resourceType: "Parameters", parameter: [] }),
    ).toBeNull();
  });

  it("counts only error and fatal issues as errors", () => {
    expect(outcomeHasErrors(errorOutcome as never)).toBe(true);
    expect(
      outcomeHasErrors({
        resourceType: "OperationOutcome",
        issue: [{ severity: "information", code: "informational" }],
      }),
    ).toBe(false);
    expect(outcomeHasErrors(null)).toBe(false);
  });
});
