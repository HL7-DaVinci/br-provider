import type { FhirResource, Parameters, Patient, Task } from "fhir/r4";
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

    const params = buildSubmitAttachmentParameters(
      task(),
      member,
      provider,
      contents,
    );

    expect(params.resourceType).toBe("Parameters");

    const trackingId = paramByName(params, "TrackingId")?.valueIdentifier;
    expect(trackingId?.value).toBe("ACN-1");
    expect(trackingId?.system).toBe("http://example.org/acn");

    expect(paramByName(params, "AttachTo")?.valueCode).toBe("preauthorization");
    expect(paramByName(params, "MemberId")?.valueIdentifier).toEqual(member);
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
    const params = buildSubmitAttachmentParameters(
      task(),
      { value: "M1" },
      { value: "123" },
      contents,
    );
    const attachments = params.parameter?.filter(
      (p) => p.name === "Attachment",
    );
    expect(attachments).toHaveLength(2);
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
  it("prefers a type=MB identifier, then the first, then the patient id", () => {
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
    expect(memberIdentifier(withMb, "pat-1").value).toBe("MEM-9");

    const firstOnly: Patient = {
      resourceType: "Patient",
      identifier: [{ system: "http://other", value: "FIRST" }],
    };
    expect(memberIdentifier(firstOnly, "pat-1").value).toBe("FIRST");

    const noIds: Patient = { resourceType: "Patient" };
    const fallback = memberIdentifier(noIds, "pat-1");
    expect(fallback.value).toBe("pat-1");
    expect(fallback.system).toBe("http://example.org/MIN");
  });
});

describe("providerIdentifier", () => {
  it("uses the NPI or a default placeholder", () => {
    expect(providerIdentifier("789").value).toBe("789");
    expect(providerIdentifier(undefined).value).toBe("0000000000");
    expect(providerIdentifier("  ").value).toBe("0000000000");
  });
});
