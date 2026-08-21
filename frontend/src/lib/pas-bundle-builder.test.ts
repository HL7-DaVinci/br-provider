import type {
  Claim,
  Coverage,
  FhirResource,
  Organization,
  Patient,
  Practitioner,
  PractitionerRole,
  ServiceRequest,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildClaimItem,
  buildPasInquiryBundle,
  buildPasRequestBundle,
  ensureCoverageRelationship,
  extractOrderCode,
  type PasSubmitResources,
  providerOrgIdentifier,
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

const PROVIDER_FHIR_BASE = "http://provider.example.org/fhir";

function claimOf(bundle: { entry?: Array<{ resource?: unknown }> }): Claim {
  const claim = bundle.entry?.find(
    (e) => (e.resource as { resourceType?: string })?.resourceType === "Claim",
  )?.resource as Claim | undefined;
  if (!claim) throw new Error("no Claim in bundle");
  return claim;
}

describe("buildPasRequestBundle", () => {
  it("produces a conformant collection Bundle with the request-bundle profile", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
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
    const claim = claimOf(
      buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE),
    );
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
    const claim = claimOf(
      buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE),
    );
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
    expect(senderCode).toBe(providerOrgIdentifier());
    expect(receiverCode).toBeTruthy();
  });

  it("adds the mandatory item requestType + certificationType extensions", () => {
    const item = claimOf(buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE))
      .item?.[0];
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
      PROVIDER_FHIR_BASE,
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
    const item = claimOf(buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE))
      .item?.[0];
    expect(item?.productOrService?.coding?.[0]?.code).toBe("12345");
  });

  it("synthesizes a type=MB member identifier from Coverage.subscriberId", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const patient = bundle.entry?.find(
      (e) => e.resource?.resourceType === "Patient",
    )?.resource as Patient;
    const mb = patient.identifier?.find((id) =>
      id.type?.coding?.some((c) => c.code === "MB"),
    );
    expect(mb?.value).toBe("MEM-42");
  });

  it("emits required item category from the X12 1365 service type code system", () => {
    const claim = claimOf(
      buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE),
    );
    const category = claim.item?.[0]?.category?.coding?.[0];
    expect(category?.system).toBe("https://codesystem.x12.org/005010/1365");
    expect(category?.code).toBe("42");
  });

  it("emits required item location as a CMS place of service code", () => {
    const claim = claimOf(
      buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE),
    );
    const location = claim.item?.[0]?.locationCodeableConcept?.coding?.[0];
    expect(location?.system).toBe(
      "https://www.cms.gov/Medicare/Coding/place-of-service-codes/Place_of_Service_Code_Set",
    );
    expect(location?.code).toBe("12");
  });

  it("references a requestor Organization from Claim.provider, not a Practitioner", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const claim = claimOf(bundle);
    expect(claim.provider?.reference).toMatch(/^Organization\//);
    const org = bundle.entry
      ?.map((e) => e.resource)
      .find(
        (r) =>
          (r as { resourceType?: string; id?: string })?.resourceType ===
            "Organization" && (r as { id?: string })?.id !== "org1",
      );
    expect(org).toBeDefined();
    expect((org as { meta?: { profile?: string[] } })?.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-requestor",
    );
  });

  it("gives the careTeam PractitionerRole contact info and defaults Coverage.relationship to self", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const pr = bundle.entry
      ?.map((e) => e.resource)
      .find((r) => r?.resourceType === "PractitionerRole") as PractitionerRole;
    expect((pr.telecom ?? []).length).toBeGreaterThan(0);
    const coverage = bundle.entry
      ?.map((e) => e.resource)
      .find((r) => r?.resourceType === "Coverage") as Coverage;
    expect(coverage.relationship?.coding?.[0]?.code).toBe("self");
    expect(
      coverage.relationship?.coding?.some(
        (c) =>
          c.system === "https://codesystem.x12.org/005010/1069" &&
          c.code === "18",
      ),
    ).toBe(true);
  });

  it("emits a careTeam member with the careTeamClaimScope extension and links the item", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const claim = claimOf(bundle);
    const member = claim.careTeam?.[0];
    expect(member?.sequence).toBe(1);
    expect(member?.provider?.reference).toMatch(/^PractitionerRole\//);
    expect(member?.extension?.[0]?.url).toBe(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-careTeamClaimScope",
    );
    expect(member?.extension?.[0]?.valueBoolean).toBe(true);
    expect(claim.item?.[0]?.careTeamSequence).toEqual([1]);
  });

  it("backs careTeam.provider with a PractitionerRole referencing the bundled Practitioner", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const claim = claimOf(bundle);
    const careTeamProviderRef = claim.careTeam?.[0]?.provider?.reference;
    const practitionerRole = bundle.entry
      ?.map((e) => e.resource)
      .find(
        (r) =>
          (r as { resourceType?: string })?.resourceType === "PractitionerRole",
      ) as
      | {
          id?: string;
          practitioner?: { reference?: string };
          meta?: { profile?: string[] };
        }
      | undefined;
    expect(practitionerRole).toBeDefined();
    expect(`PractitionerRole/${practitionerRole?.id}`).toBe(
      careTeamProviderRef,
    );
    const practitioner = bundle.entry
      ?.map((e) => e.resource)
      .find(
        (r) =>
          (r as { resourceType?: string })?.resourceType === "Practitioner",
      ) as { id?: string } | undefined;
    expect(practitionerRole?.practitioner?.reference).toBe(
      `Practitioner/${practitioner?.id}`,
    );
    expect(practitionerRole?.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-practitionerrole",
    );
  });

  it("adds a type=MB member identifier to Coverage matching Coverage.subscriberId", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const coverage = bundle.entry?.find(
      (e) => e.resource?.resourceType === "Coverage",
    )?.resource as Coverage;
    const mb = coverage.identifier?.find((id) =>
      id.type?.coding?.some((c) => c.code === "MB"),
    );
    expect(mb?.value).toBe("MEM-42");
  });

  it("emits diagnosis from the order reasonCode when present and links the item", () => {
    const r = resources();
    const order: ServiceRequest = {
      ...(r.order as ServiceRequest),
      reasonCode: [
        {
          coding: [
            { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "J96.11" },
          ],
        },
      ],
    };
    const bundle = buildPasRequestBundle(
      resources({ order }),
      PROVIDER_FHIR_BASE,
    );
    const claim = claimOf(bundle);
    expect(claim.diagnosis?.[0]?.sequence).toBe(1);
    expect(
      claim.diagnosis?.[0]?.diagnosisCodeableConcept?.coding?.[0]?.code,
    ).toBe("J96.11");
    expect(claim.item?.[0]?.diagnosisSequence).toEqual([1]);
  });

  it("omits diagnosis when the order carries none", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    expect(claimOf(bundle).diagnosis).toBeUndefined();
  });

  it("pairs RESTful fullUrls with relative references so intra-bundle resolution works", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    expect(bundle.entry?.length).toBeGreaterThan(0);
    for (const e of bundle.entry ?? []) {
      expect(e.fullUrl).toMatch(/^https?:\/\/.+\/[A-Za-z]+\/[A-Za-z0-9-]+$/);
      expect(
        e.fullUrl?.endsWith(`/${e.resource?.resourceType}/${e.resource?.id}`),
      ).toBe(true);
    }
  });
});

describe("buildClaimItem", () => {
  it("falls back to data-absent-reason not-applicable for productOrService", () => {
    const orderWithoutCode = {
      resourceType: "ServiceRequest",
      id: "sr-1",
    } as FhirResource;
    const item = buildClaimItem(orderWithoutCode, "ServiceRequest");
    const coding = item.productOrService.coding?.[0];
    expect(coding?.system).toBe(
      "http://terminology.hl7.org/CodeSystem/data-absent-reason",
    );
    expect(coding?.code).toBe("not-applicable");
  });

  it("does not misuse a medicationReference as a CodeableConcept", () => {
    const medOrder = {
      resourceType: "MedicationRequest",
      id: "mr-1",
      medicationReference: { reference: "Medication/m1" },
    } as FhirResource;
    const item = buildClaimItem(medOrder, "MedicationRequest");
    expect(item.productOrService.coding?.[0]?.code).toBe("not-applicable");
    expect(
      (item.productOrService as Record<string, unknown>).reference,
    ).toBeUndefined();
  });
});

describe("buildPasInquiryBundle", () => {
  it("builds a profile-claim-inquiry Claim with a wildcard item", () => {
    const r = resources();
    const bundle = buildPasInquiryBundle(
      {
        patient: r.patient,
        practitioner: r.practitioner,
        insurer: r.insurer,
        coverage: r.coverage,
      },
      PROVIDER_FHIR_BASE,
    );
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

  it("references a requestor Organization from Claim.provider, not a Practitioner", () => {
    const r = resources();
    const bundle = buildPasInquiryBundle(
      {
        patient: r.patient,
        practitioner: r.practitioner,
        insurer: r.insurer,
        coverage: r.coverage,
      },
      PROVIDER_FHIR_BASE,
    );
    const claim = claimOf(bundle);
    expect(claim.provider?.reference).toMatch(/^Organization\//);
    const org = bundle.entry
      ?.map((e) => e.resource)
      .find(
        (r) =>
          (r as { resourceType?: string; id?: string })?.resourceType ===
            "Organization" && (r as { id?: string })?.id !== "org1",
      );
    expect(org).toBeDefined();
    expect((org as { meta?: { profile?: string[] } })?.meta?.profile).toContain(
      "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/profile-requestor",
    );
  });

  it("omits the Practitioner entry when no order context is available", () => {
    const r = resources();
    const bundle = buildPasInquiryBundle(
      {
        patient: r.patient,
        insurer: r.insurer,
        coverage: r.coverage,
      },
      PROVIDER_FHIR_BASE,
    );
    const hasPractitioner = bundle.entry?.some(
      (e) => e.resource?.resourceType === "Practitioner",
    );
    expect(hasPractitioner).toBe(false);
  });

  it("pairs RESTful fullUrls with relative references so intra-bundle resolution works", () => {
    const r = resources();
    const bundle = buildPasInquiryBundle(
      {
        patient: r.patient,
        practitioner: r.practitioner,
        insurer: r.insurer,
        coverage: r.coverage,
      },
      PROVIDER_FHIR_BASE,
    );
    expect(bundle.entry?.length).toBeGreaterThan(0);
    for (const e of bundle.entry ?? []) {
      expect(e.fullUrl).toMatch(/^https?:\/\/.+\/[A-Za-z]+\/[A-Za-z0-9-]+$/);
      expect(
        e.fullUrl?.endsWith(`/${e.resource?.resourceType}/${e.resource?.id}`),
      ).toBe(true);
    }
  });
});

describe("requestedService and AdditionalInformation supportingInfo", () => {
  const EXT_REQUESTED_SERVICE =
    "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-requestedService";
  const EXT_DOCUMENT_INFORMATION =
    "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-documentInformation";
  const PAS_TEMP_CODES =
    "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";

  it("conveys the order via the requestedService item extension", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const item = claimOf(bundle).item?.[0];
    const ext = item?.extension?.find((e) => e.url === EXT_REQUESTED_SERVICE);
    expect(ext?.valueReference?.reference).toMatch(/^ServiceRequest\//);
  });

  it("adds the order as a bundle entry referenced by requestedService", () => {
    const bundle = buildPasRequestBundle(resources(), PROVIDER_FHIR_BASE);
    const claim = claimOf(bundle);
    const ext = claim.item?.[0]?.extension?.find(
      (e) => e.url === EXT_REQUESTED_SERVICE,
    );
    const byTypeId = new Set(
      (bundle.entry ?? []).map((e) => {
        const res = e.resource as { resourceType?: string; id?: string };
        return `${res.resourceType}/${res.id}`;
      }),
    );
    expect(byTypeId.has(ext?.valueReference?.reference ?? "")).toBe(true);
  });

  it("puts QuestionnaireResponses in the AdditionalInformation supportingInfo slice", () => {
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
      PROVIDER_FHIR_BASE,
    );
    const info = claimOf(bundle).supportingInfo?.[0];
    expect(info?.category?.coding?.[0]).toMatchObject({
      system: PAS_TEMP_CODES,
      code: "additionalInformation",
    });
    const docInfo = info?.extension?.find(
      (e) => e.url === EXT_DOCUMENT_INFORMATION,
    );
    const reportType = docInfo?.extension?.find(
      (e) => e.url === "reportTypeCode",
    );
    expect(reportType?.valueCodeableConcept?.coding?.[0]).toMatchObject({
      system: "https://codesystem.x12.org/005010/755",
      code: "OZ",
    });
    expect(info?.valueReference?.reference).toBe("QuestionnaireResponse/qr1");
  });

  it("no longer emits the invented supportingInfo code system", () => {
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
      PROVIDER_FHIR_BASE,
    );
    const json = JSON.stringify(bundle);
    expect(json).not.toContain("PASSupportingInfoType");
    expect(json).not.toContain('"code":"order"');
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

describe("order reference pruning", () => {
  it("drops order references that are not included in the bundle", () => {
    const order: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "1720",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/pat013" },
      encounter: { reference: "Encounter/1715" },
      requester: { reference: "Practitioner/prac1" },
      code: { coding: [{ system: "http://snomed.info/sct", code: "12345" }] },
    };

    const bundle = buildPasRequestBundle(
      resources({ order }),
      PROVIDER_FHIR_BASE,
    );
    const bundledOrder = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ServiceRequest",
    )?.resource as ServiceRequest;

    expect(bundledOrder.encounter).toBeUndefined();
    expect(bundledOrder.subject?.reference).toBe("Patient/pat013");
    expect(bundledOrder.requester?.reference).toBe("Practitioner/prac1");
  });

  it("keeps display text when pruning an unbundled reference", () => {
    const order: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "1720",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/pat013" },
      encounter: { reference: "Encounter/1715", display: "Home visit" },
      code: { coding: [{ system: "http://snomed.info/sct", code: "12345" }] },
    };

    const bundle = buildPasRequestBundle(
      resources({ order }),
      PROVIDER_FHIR_BASE,
    );
    const bundledOrder = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ServiceRequest",
    )?.resource as ServiceRequest;

    expect(bundledOrder.encounter?.reference).toBeUndefined();
    expect(bundledOrder.encounter?.display).toBe("Home visit");
  });

  it("does not mutate the caller's order resource", () => {
    const order: ServiceRequest = {
      resourceType: "ServiceRequest",
      id: "1720",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/pat013" },
      encounter: { reference: "Encounter/1715" },
      code: { coding: [{ system: "http://snomed.info/sct", code: "12345" }] },
    };

    buildPasRequestBundle(resources({ order }), PROVIDER_FHIR_BASE);

    expect(order.encounter?.reference).toBe("Encounter/1715");
  });
});

describe("ensureCoverageRelationship", () => {
  it("defaults relationship to self with the X12 1069 code", () => {
    const coverage = {
      resourceType: "Coverage",
      status: "active",
    } as Parameters<typeof ensureCoverageRelationship>[0];
    ensureCoverageRelationship(coverage);
    expect(coverage.relationship?.coding).toEqual([
      {
        system: "http://terminology.hl7.org/CodeSystem/subscriber-relationship",
        code: "self",
      },
      { system: "https://codesystem.x12.org/005010/1069", code: "18" },
    ]);
  });

  it("preserves an existing relationship", () => {
    const relationship = { coding: [{ code: "spouse" }] };
    const coverage = {
      resourceType: "Coverage",
      status: "active",
      relationship,
    } as Parameters<typeof ensureCoverageRelationship>[0];
    ensureCoverageRelationship(coverage);
    expect(coverage.relationship).toBe(relationship);
  });
});
