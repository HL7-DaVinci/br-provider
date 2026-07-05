import type {
  Coverage,
  FhirResource,
  Parameters,
  Patient,
  Task,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildSubmitAttachmentParameters,
  memberIdentifier,
  patientIdFromTask,
  providerIdentifier,
  resolvePayerUrl,
  trackingIdentifier,
} from "./cdex-submit-attachment-builder";

const PASTEMP = "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";
const ORG_IDENTIFIER = {
  system: "http://example.org/fhir/org-identifier",
  value: "1122334455",
};

function task(): Task {
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    identifier: [{ system: "http://example.org/acn", value: "ACN-1" }],
    for: { reference: "Patient/pat-1" },
    input: [
      {
        type: { coding: [{ system: PASTEMP, code: "payer-url" }] },
        valueUrl: "http://payer.example/fhir",
      },
    ],
  };
}

function paramByName(parameters: Parameters, name: string) {
  return parameters.parameter?.find((p) => p.name === name);
}

describe("buildSubmitAttachmentParameters", () => {
  it("builds a conformant cdex-parameters-submit-attachment Parameters", () => {
    const member = { system: "http://example.org/MIN", value: "M1" };
    const provider = { system: "http://hl7.org/fhir/sid/us-npi", value: "123" };
    const contents: FhirResource[] = [
      { resourceType: "QuestionnaireResponse", status: "completed", id: "qr1" },
    ];

    const params = buildSubmitAttachmentParameters({
      task: task(),
      memberId: member,
      organizationId: ORG_IDENTIFIER,
      providerId: provider,
      contents,
      final: true,
    });

    expect(params.resourceType).toBe("Parameters");

    const trackingId = paramByName(params, "TrackingId")?.valueIdentifier;
    expect(trackingId?.value).toBe("ACN-1");
    expect(trackingId?.system).toBe("http://example.org/acn");

    expect(paramByName(params, "AttachTo")?.valueCode).toBe("preauthorization");
    expect(paramByName(params, "MemberId")?.valueIdentifier).toEqual(member);
    expect(paramByName(params, "OrganizationId")?.valueIdentifier).toEqual(
      ORG_IDENTIFIER,
    );
    expect(paramByName(params, "ProviderId")?.valueIdentifier).toEqual(
      provider,
    );
    expect(paramByName(params, "Final")?.valueBoolean).toBe(true);

    const attachment = paramByName(params, "Attachment");
    expect(attachment?.part?.[0].name).toBe("Content");
    expect(attachment?.part?.[0].resource?.resourceType).toBe(
      "QuestionnaireResponse",
    );
  });

  it("emits one Attachment per content resource", () => {
    const contents: FhirResource[] = [
      { resourceType: "QuestionnaireResponse", status: "completed", id: "qr1" },
      { resourceType: "DocumentReference", status: "current", content: [] },
    ];
    const params = buildSubmitAttachmentParameters({
      task: task(),
      memberId: { value: "M1" },
      organizationId: ORG_IDENTIFIER,
      contents,
      final: true,
    });
    const attachments = params.parameter?.filter(
      (p) => p.name === "Attachment",
    );
    expect(attachments).toHaveLength(2);
  });

  it("emits an Attachment.LineItem part with valueString for each line item", () => {
    const contents: FhirResource[] = [
      { resourceType: "QuestionnaireResponse", status: "completed", id: "qr1" },
    ];
    const params = buildSubmitAttachmentParameters({
      task: task(),
      memberId: { value: "M1" },
      organizationId: ORG_IDENTIFIER,
      contents,
      lineItems: [2],
      final: true,
    });
    const attachment = paramByName(params, "Attachment");
    const lineItemPart = attachment?.part?.find((p) => p.name === "LineItem");
    expect(lineItemPart?.valueString).toBe("2");
  });

  it("emits Final=false when the submission does not close the last open documentation Task", () => {
    const contents: FhirResource[] = [
      { resourceType: "QuestionnaireResponse", status: "completed", id: "qr1" },
    ];
    const params = buildSubmitAttachmentParameters({
      task: task(),
      memberId: { value: "M1" },
      organizationId: ORG_IDENTIFIER,
      contents,
      final: false,
    });
    expect(paramByName(params, "Final")?.valueBoolean).toBe(false);
  });

  it("emits OrganizationId and omits ProviderId when no practitioner NPI is available", () => {
    const contents: FhirResource[] = [
      { resourceType: "QuestionnaireResponse", status: "completed", id: "qr1" },
    ];
    const params = buildSubmitAttachmentParameters({
      task: task(),
      memberId: { value: "M1" },
      organizationId: ORG_IDENTIFIER,
      contents,
      final: true,
    });
    expect(paramByName(params, "OrganizationId")?.valueIdentifier).toEqual(
      ORG_IDENTIFIER,
    );
    expect(paramByName(params, "ProviderId")).toBeUndefined();
  });
});

describe("trackingIdentifier", () => {
  it("throws when the Task has no identifier", () => {
    expect(() =>
      trackingIdentifier({
        resourceType: "Task",
        status: "requested",
        intent: "order",
      }),
    ).toThrow();
  });
});

describe("resolvePayerUrl", () => {
  it("reads the Task payer-url input, then the fallback", () => {
    expect(resolvePayerUrl(task(), "http://fallback/fhir")).toBe(
      "http://payer.example/fhir",
    );
    expect(
      resolvePayerUrl(
        { resourceType: "Task", status: "requested", intent: "order" },
        "http://fallback/fhir",
      ),
    ).toBe("http://fallback/fhir");
  });
});

describe("patientIdFromTask", () => {
  it("extracts the patient id or throws", () => {
    expect(patientIdFromTask(task())).toBe("pat-1");
    expect(() =>
      patientIdFromTask({
        resourceType: "Task",
        status: "requested",
        intent: "order",
      }),
    ).toThrow();
  });
});

describe("memberIdentifier", () => {
  it("returns the type=MB identifier", () => {
    const withMb: Patient = {
      resourceType: "Patient",
      identifier: [
        { system: "http://other", value: "X" },
        {
          type: { coding: [{ code: "MB" }] },
          system: "http://example.org/MIN",
          value: "MEM-9",
        },
      ],
    };
    expect(memberIdentifier(withMb).value).toBe("MEM-9");
  });

  it("falls back to the Coverage's MB-typed identifier when the patient has none", () => {
    const noMb: Patient = {
      resourceType: "Patient",
      identifier: [{ system: "http://other", value: "FIRST" }],
    };
    const coverage: Coverage = {
      resourceType: "Coverage",
      status: "active",
      beneficiary: { reference: "Patient/pat-1" },
      payor: [],
      identifier: [
        {
          type: { coding: [{ code: "MB" }] },
          system: "http://example.org/MIN",
          value: "COV-MEM-1",
        },
      ],
    };
    expect(memberIdentifier(noMb, coverage).value).toBe("COV-MEM-1");
  });

  it("falls back to Coverage.subscriberId when neither carries an MB identifier", () => {
    const noMb: Patient = { resourceType: "Patient" };
    const coverage: Coverage = {
      resourceType: "Coverage",
      status: "active",
      beneficiary: { reference: "Patient/pat-1" },
      payor: [],
      subscriberId: "10A3D58WH1600",
    };
    expect(memberIdentifier(noMb, coverage)).toEqual({
      system: "http://example.org/MIN",
      value: "10A3D58WH1600",
    });
  });

  it("throws when no member identifier source exists instead of fabricating one", () => {
    const noMb: Patient = {
      resourceType: "Patient",
      identifier: [{ system: "http://other", value: "FIRST" }],
    };
    expect(() => memberIdentifier(noMb)).toThrow(
      "No payer member identifier available for $submit-attachment",
    );

    const noIds: Patient = { resourceType: "Patient" };
    expect(() => memberIdentifier(noIds)).toThrow();
  });
});

describe("providerIdentifier", () => {
  it("returns an NPI identifier when a real NPI is available", () => {
    expect(providerIdentifier("789")).toEqual({
      system: "http://hl7.org/fhir/sid/us-npi",
      value: "789",
    });
  });

  it("returns undefined instead of a placeholder NPI when none is available", () => {
    expect(providerIdentifier(undefined)).toBeUndefined();
    expect(providerIdentifier("  ")).toBeUndefined();
  });
});
