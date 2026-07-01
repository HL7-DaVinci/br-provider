import type { ServiceRequest } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  coverageInfoPrimaryKeyEquals,
  findOrdersSharingCanonicals,
  parseCoverageInfoFromResource,
} from "./coverage-extensions";
import type { OrderEntry } from "./order-types";

const COVERAGE_INFO_EXT_URL =
  "http://hl7.org/fhir/us/davinci-crd/StructureDefinition/ext-coverage-information";

function order(
  id: string,
  canonicals: string[],
  docNeeded: "yes" | "no-doc" = "yes",
): OrderEntry {
  const sr: ServiceRequest = {
    resourceType: "ServiceRequest",
    id,
    status: "active",
    intent: "order",
    subject: { reference: "Patient/p1" },
    extension: canonicals.length
      ? [
          {
            url: COVERAGE_INFO_EXT_URL,
            extension: [
              { url: "doc-needed", valueCode: docNeeded },
              ...canonicals.map((c) => ({
                url: "questionnaire",
                valueCanonical: c,
              })),
            ],
          },
        ]
      : undefined,
  };
  return { resourceType: "ServiceRequest", resource: sr };
}

describe("findOrdersSharingCanonicals", () => {
  const Q_A = "https://example.org/Questionnaire/A";
  const Q_B = "https://example.org/Questionnaire/B";

  it("returns refs of orders sharing any focus canonical", () => {
    const orders: OrderEntry[] = [
      order("o1", [Q_A]),
      order("o2", [Q_A, Q_B]),
      order("o3", [Q_B]),
    ];
    const refs = findOrdersSharingCanonicals(orders, "ServiceRequest/o1", [
      Q_A,
    ]);
    expect(refs).toEqual(["ServiceRequest/o2"]);
  });

  it("excludes the focus order itself", () => {
    const orders: OrderEntry[] = [order("o1", [Q_A]), order("o2", [Q_A])];
    const refs = findOrdersSharingCanonicals(orders, "ServiceRequest/o1", [
      Q_A,
    ]);
    expect(refs).toEqual(["ServiceRequest/o2"]);
  });

  it("ignores orders whose CoverageInformation has docNeeded=no-doc", () => {
    const orders: OrderEntry[] = [
      order("o1", [Q_A]),
      order("o2", [Q_A], "no-doc"),
    ];
    const refs = findOrdersSharingCanonicals(orders, "ServiceRequest/o1", [
      Q_A,
    ]);
    expect(refs).toEqual([]);
  });

  it("returns empty when focusCanonicals is empty", () => {
    const orders: OrderEntry[] = [order("o1", [Q_A]), order("o2", [Q_A])];
    expect(
      findOrdersSharingCanonicals(orders, "ServiceRequest/o1", []),
    ).toEqual([]);
  });
});

describe("coverageInfoPrimaryKeyEquals", () => {
  it("matches when both coverage and coverageAssertionId are equal", () => {
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
      ),
    ).toBe(true);
  });

  it("does not match when coverage differs", () => {
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
        { coverage: "Coverage/c2", coverageAssertionId: "a1" },
      ),
    ).toBe(false);
  });

  it("does not match when coverageAssertionId differs", () => {
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
        { coverage: "Coverage/c1", coverageAssertionId: "a2" },
      ),
    ).toBe(false);
  });

  it("does not match when either side is missing coverage", () => {
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverageAssertionId: "a1" },
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
      ),
    ).toBe(false);
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
        { coverageAssertionId: "a1" },
      ),
    ).toBe(false);
  });

  it("does not match when either side is missing coverageAssertionId", () => {
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1" },
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
      ),
    ).toBe(false);
    expect(
      coverageInfoPrimaryKeyEquals(
        { coverage: "Coverage/c1", coverageAssertionId: "a1" },
        { coverage: "Coverage/c1" },
      ),
    ).toBe(false);
  });

  it("does not match when both sides are missing both halves of the key", () => {
    expect(coverageInfoPrimaryKeyEquals({}, {})).toBe(false);
  });
});

describe("CoverageInformation parsing", () => {
  it("parses coverage-information fields and ignores any pa-status block", () => {
    const order: ServiceRequest = {
      resourceType: "ServiceRequest",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/p1" },
      extension: [
        {
          url: COVERAGE_INFO_EXT_URL,
          extension: [
            { url: "coverage", valueReference: { reference: "Coverage/c1" } },
            { url: "pa-needed", valueCode: "auth-needed" },
          ],
        },
      ],
    };

    const [ci] = parseCoverageInfoFromResource(order);
    expect(ci.coverage).toBe("Coverage/c1");
    expect(ci.paNeeded).toBe("auth-needed");
  });
});
