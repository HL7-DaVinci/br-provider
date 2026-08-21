import type { Extension, QuestionnaireResponse } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  copyMissingExtensionsWithContained,
  INTENDED_USE_EXT_URL,
  QR_CONTEXT_EXT_URL,
  QR_COVERAGE_EXT_URL,
  upsertQrDtrExtensions,
} from "./dtr-qr-extensions";

function emptyQr(): QuestionnaireResponse {
  return { resourceType: "QuestionnaireResponse", status: "in-progress" };
}

function findExt(
  qr: QuestionnaireResponse,
  url: string,
): Extension | undefined {
  return qr.extension?.find((e) => e.url === url);
}

function qrWithIntendedUse(code: string): QuestionnaireResponse {
  return {
    resourceType: "QuestionnaireResponse",
    status: "in-progress",
    extension: [
      {
        url: INTENDED_USE_EXT_URL,
        valueCodeableConcept: {
          coding: [
            {
              system:
                "http://hl7.org/fhir/us/davinci-crd/CodeSystem/coverage-information-codes",
              code,
            },
          ],
        },
      },
    ],
  };
}

describe("upsertQrDtrExtensions", () => {
  it("always writes qr-coverage", () => {
    const qr = emptyQr();
    upsertQrDtrExtensions(qr, {
      orderRefs: [],
      coverageRef: "Coverage/c1",
      intendedUse: "withorder",
    });
    expect(findExt(qr, QR_COVERAGE_EXT_URL)?.valueReference?.reference).toBe(
      "Coverage/c1",
    );
  });

  it("writes intendedUse withpa for task-launched questionnaires", () => {
    const qr = emptyQr();
    upsertQrDtrExtensions(qr, {
      orderRefs: ["ServiceRequest/sr1"],
      coverageRef: "Coverage/c1",
      intendedUse: "withpa",
    });
    const concept = findExt(qr, INTENDED_USE_EXT_URL)?.valueCodeableConcept;
    expect(concept?.coding?.[0]).toMatchObject({
      system:
        "http://hl7.org/fhir/us/davinci-crd/CodeSystem/coverage-information-codes",
      code: "withpa",
    });
  });

  it("leaves an agreeing payer draft intendedUse untouched", () => {
    const qr = qrWithIntendedUse("withpa");
    const ext = qr.extension?.find((e) => e.url === INTENDED_USE_EXT_URL);
    if (ext?.valueCodeableConcept) ext.valueCodeableConcept.text = "payer text";
    upsertQrDtrExtensions(qr, {
      orderRefs: [],
      coverageRef: "Coverage/c1",
      intendedUse: "withpa",
    });
    const concept = findExt(qr, INTENDED_USE_EXT_URL)?.valueCodeableConcept;
    expect(concept?.coding?.[0]?.code).toBe("withpa");
    expect(concept?.text).toBe("payer text");
  });

  it("corrects a payer draft intendedUse that disagrees with the launch provenance", () => {
    const qr = qrWithIntendedUse("withorder");
    upsertQrDtrExtensions(qr, {
      orderRefs: [],
      coverageRef: "Coverage/c1",
      intendedUse: "withpa",
    });
    const concept = findExt(qr, INTENDED_USE_EXT_URL)?.valueCodeableConcept;
    expect(concept?.coding?.[0]?.code).toBe("withpa");
  });

  it("adds qr-contexts for orders and the Coverage plus the qr-coverage", () => {
    const qr = emptyQr();
    upsertQrDtrExtensions(qr, {
      orderRefs: ["ServiceRequest/sr-1"],
      coverageRef: "Coverage/cov-1",
      intendedUse: "withorder",
    });
    expect(
      (qr.extension ?? [])
        .filter((e) => e.url === QR_CONTEXT_EXT_URL)
        .map((e) => e.valueReference?.reference),
    ).toEqual(["ServiceRequest/sr-1", "Coverage/cov-1"]);
    expect(findExt(qr, QR_COVERAGE_EXT_URL)?.valueReference?.reference).toBe(
      "Coverage/cov-1",
    );
  });

  it("adds an Encounter qr-context so encounter-launched sessions without an order stay conformant", () => {
    const qr = emptyQr();
    upsertQrDtrExtensions(qr, {
      orderRefs: [],
      coverageRef: "Coverage/cov-1",
      encounterRef: "Encounter/enc-1",
      intendedUse: "withorder",
    });
    expect(
      (qr.extension ?? [])
        .filter((e) => e.url === QR_CONTEXT_EXT_URL)
        .map((e) => e.valueReference?.reference),
    ).toEqual(["Coverage/cov-1", "Encounter/enc-1"]);
  });

  it("replaces existing qr-context/qr-coverage without duplicating, preserving others", () => {
    const qr: QuestionnaireResponse = {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      extension: [
        {
          url: "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context",
          valueReference: { reference: "ServiceRequest/old" },
        },
        {
          url: QR_COVERAGE_EXT_URL,
          valueReference: { reference: "Coverage/old" },
        },
        { url: "http://example.org/other", valueString: "keep" },
      ],
    };
    upsertQrDtrExtensions(qr, {
      orderRefs: ["DeviceRequest/dr-1"],
      coverageRef: "Coverage/cov-2",
      intendedUse: "withorder",
    });
    const contextExts = (qr.extension ?? []).filter(
      (e) => e.url === QR_CONTEXT_EXT_URL,
    );
    expect(contextExts.map((e) => e.valueReference?.reference)).toEqual([
      "DeviceRequest/dr-1",
      "Coverage/cov-2",
    ]);
    expect(
      (qr.extension ?? []).filter((e) => e.url === QR_COVERAGE_EXT_URL),
    ).toHaveLength(1);
    expect(findExt(qr, QR_COVERAGE_EXT_URL)?.valueReference?.reference).toBe(
      "Coverage/cov-2",
    );
    expect(
      (qr.extension ?? []).some((e) => e.url === "http://example.org/other"),
    ).toBe(true);
  });
});

describe("copyMissingExtensionsWithContained", () => {
  const OUTCOME_EXT = "http://example.org/populate-outcome";

  function sourceQr(): QuestionnaireResponse {
    return {
      resourceType: "QuestionnaireResponse",
      status: "in-progress",
      contained: [
        {
          resourceType: "OperationOutcome",
          id: "populate-outcome-1",
          issue: [{ severity: "warning", code: "processing" }],
        },
      ],
      extension: [
        {
          url: OUTCOME_EXT,
          valueReference: { reference: "#populate-outcome-1" },
        },
        { url: "http://example.org/plain", valueString: "v" },
      ],
    };
  }

  it("copies the referenced contained resource alongside the extension", () => {
    const target = emptyQr();
    copyMissingExtensionsWithContained(sourceQr(), target);
    expect(
      target.extension?.find((e) => e.url === OUTCOME_EXT)?.valueReference
        ?.reference,
    ).toBe("#populate-outcome-1");
    expect(target.contained?.[0]?.id).toBe("populate-outcome-1");
    expect(
      target.extension?.some((e) => e.url === "http://example.org/plain"),
    ).toBe(true);
  });

  it("drops extensions whose contained target is missing", () => {
    const source = sourceQr();
    source.contained = [];
    const target = emptyQr();
    copyMissingExtensionsWithContained(source, target);
    expect(target.extension?.some((e) => e.url === OUTCOME_EXT)).toBe(false);
    expect(target.contained).toBeUndefined();
    expect(
      target.extension?.some((e) => e.url === "http://example.org/plain"),
    ).toBe(true);
  });

  it("does not overwrite extensions the target already carries", () => {
    const target = emptyQr();
    target.extension = [{ url: "http://example.org/plain", valueString: "t" }];
    copyMissingExtensionsWithContained(sourceQr(), target);
    expect(
      target.extension?.filter((e) => e.url === "http://example.org/plain"),
    ).toHaveLength(1);
    expect(
      target.extension?.find((e) => e.url === "http://example.org/plain")
        ?.valueString,
    ).toBe("t");
  });
});
