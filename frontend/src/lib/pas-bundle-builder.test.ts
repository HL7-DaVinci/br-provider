import type {
  Claim,
  Coverage,
  Organization,
  Patient,
  Practitioner,
  ServiceRequest,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildPasInquiryBundle,
  buildPasRequestBundle,
  buildPasUpdateBundle,
  extractOrderCode,
  type PasSubmitResources,
} from "./pas-bundle-builder";

function resources(
  overrides: Partial<PasSubmitResources> = {},
): PasSubmitResources {
  const patient: Patient = { resourceType: "Patient", id: "pat013" };
  const practitioner: Practitioner = {
    resourceType: "Practitioner",
    id: "prac1",
  };
  const insurer: Organization = { resourceType: "Organization", id: "org1" };
  const coverage: Coverage = {
    resourceType: "Coverage",
    id: "cov013",
    status: "active",
    beneficiary: { reference: "Patient/pat013" },
    payor: [{ reference: "Organization/org1" }],
    subscriberId: "MEM-42",
  };
  const order: ServiceRequest = {
    resourceType: "ServiceRequest",
    id: "1720",
    status: "active",
    intent: "order",
    subject: { reference: "Patient/pat013" },
    code: { coding: [{ system: "http://snomed.info/sct", code: "12345" }] },
  };
  return {
    patient,
    practitioner,
    insurer,
    coverage,
    order,
    orderType: "ServiceRequest",
    questionnaireResponses: [],
    ...overrides,
  };
}

function claimOf(bundle: { entry?: Array<{ resource?: unknown }> }): Claim {
  const claim = bundle.entry?.find(
    (e) => (e.resource as { resourceType?: string })?.resourceType === "Claim",
  )?.resource as Claim | undefined;
  if (!claim) throw new Error("no Claim in bundle");
  return claim;
}

describe("buildPasRequestBundle", () => {
  it("produces a conformant collection Bundle with the request-bundle profile", () => {
    const bundle = buildPasRequestBundle(resources());
    expect(bundle.type).toBe("collection");
    expect(bundle.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-pas-request-bundle",
    );
    expect(bundle.identifier?.system).toBe(
      "http://example.org/SUBMITTER_TRANSACTION_IDENTIFIER",
    );
    expect(bundle.timestamp).toBeTruthy();
  });

  it("stamps the initial Claim profile and a Claim.identifier", () => {
    const claim = claimOf(buildPasRequestBundle(resources()));
    expect(claim.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim",
    );
    expect(claim.identifier?.[0]?.value).toBeTruthy();
    expect(claim.identifier?.[0]?.system).toBe(
      "http://example.org/PATIENT_EVENT_TRACE_NUMBER",
    );
    expect(claim.use).toBe("preauthorization");
    expect(claim.related).toBeUndefined();
  });

  it("carries TransmissionIdentifiers with the provider sender code the subscription filters on", () => {
    const claim = claimOf(buildPasRequestBundle(resources()));
    const ti = claim.extension?.find(
      (e) =>
        e.url ===
        "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-TransmissionIdentifiers",
    );
    const senderCode = ti?.extension?.find(
      (e) => e.url === "applicationSenderCode",
    )?.valueString;
    const receiverCode = ti?.extension?.find(
      (e) => e.url === "applicationReceiverCode",
    )?.valueString;
    expect(senderCode).toBe("1122334455");
    expect(receiverCode).toBeTruthy();
  });

  it("adds the mandatory item requestType + certificationType extensions", () => {
    const item = claimOf(buildPasRequestBundle(resources())).item?.[0];
    const exts = item?.extension ?? [];
    const requestType = exts.find((e) =>
      e.url.endsWith("extension-serviceItemRequestType"),
    );
    const certType = exts.find((e) =>
      e.url.endsWith("extension-certificationType"),
    );
    expect(requestType?.valueCodeableConcept?.coding?.[0]).toMatchObject({
      system: "https://codesystem.x12.org/005010/1525",
      code: "HS",
    });
    expect(certType?.valueCodeableConcept?.coding?.[0]).toMatchObject({
      system: "https://codesystem.x12.org/005010/1322",
      code: "I",
    });
  });

  it("references bundled resources by type/id", () => {
    const bundle = buildPasRequestBundle(
      resources({
        questionnaireResponses: [
          {
            resourceType: "QuestionnaireResponse",
            id: "qr1",
            status: "completed",
          },
        ],
      }),
    );
    const byTypeId = new Set(
      (bundle.entry ?? []).map((e) => {
        const res = e.resource as { resourceType?: string; id?: string };
        return `${res.resourceType}/${res.id}`;
      }),
    );
    const claim = claimOf(bundle);
    for (const ref of [
      claim.patient?.reference,
      claim.provider?.reference,
      claim.insurer?.reference,
      claim.insurance?.[0]?.coverage?.reference,
      claim.supportingInfo?.[0]?.valueReference?.reference,
    ]) {
      expect(ref).toMatch(/^[A-Za-z]+\/.+/);
      expect(byTypeId.has(ref ?? "")).toBe(true);
    }
  });

  it("derives the productOrService from the order code", () => {
    const item = claimOf(buildPasRequestBundle(resources())).item?.[0];
    expect(item?.productOrService?.coding?.[0]?.code).toBe("12345");
  });

  it("synthesizes a type=MB member identifier from Coverage.subscriberId", () => {
    const bundle = buildPasRequestBundle(resources());
    const patient = bundle.entry?.find(
      (e) => e.resource?.resourceType === "Patient",
    )?.resource as Patient;
    const mb = patient.identifier?.find((id) =>
      id.type?.coding?.some((c) => c.code === "MB"),
    );
    expect(mb?.value).toBe("MEM-42");
  });
});

describe("buildPasUpdateBundle", () => {
  it("uses the claim-update profile and references the prior Claim", () => {
    const claim = claimOf(
      buildPasUpdateBundle(
        resources(),
        "claim-123",
        "http://payer.example/fhir",
      ),
    );
    expect(claim.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-update",
    );
    expect(claim.related?.[0]?.claim?.reference).toBe(
      "http://payer.example/fhir/Claim/claim-123",
    );
    expect(claim.related?.[0]?.relationship?.coding?.[0]?.code).toBe("prior");
  });
});

describe("buildPasInquiryBundle", () => {
  it("builds a profile-claim-inquiry Claim with a wildcard item", () => {
    const r = resources();
    const bundle = buildPasInquiryBundle({
      patient: r.patient,
      practitioner: r.practitioner,
      insurer: r.insurer,
      coverage: r.coverage,
    });
    expect(bundle.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-pas-inquiry-request-bundle",
    );
    const claim = claimOf(bundle);
    expect(claim.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-claim-inquiry",
    );
    expect(claim.item?.[0]?.productOrService?.coding?.[0]?.code).toBe(
      "not-applicable",
    );
  });
});

describe("extractOrderCode", () => {
  it("reads the type-specific code element per order type", () => {
    expect(
      extractOrderCode(
        {
          resourceType: "MedicationRequest",
          status: "active",
          intent: "order",
          subject: { reference: "Patient/x" },
          medicationCodeableConcept: { coding: [{ code: "med-1" }] },
        },
        "MedicationRequest",
      )?.coding?.[0]?.code,
    ).toBe("med-1");

    expect(
      extractOrderCode(
        {
          resourceType: "DeviceRequest",
          status: "active",
          intent: "order",
          subject: { reference: "Patient/x" },
          codeCodeableConcept: { coding: [{ code: "dev-1" }] },
        } as never,
        "DeviceRequest",
      )?.coding?.[0]?.code,
    ).toBe("dev-1");

    expect(
      extractOrderCode({ resourceType: "Patient" } as never, "UnknownType"),
    ).toBeUndefined();
  });
});
