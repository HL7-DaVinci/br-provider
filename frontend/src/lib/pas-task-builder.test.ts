import type { Bundle, CommunicationRequestPayload } from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildPasTasks,
  ensurePasTasks,
  mapOutcomeToTaskStatus,
} from "./pas-task-builder";

const SERVICE_LINE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-serviceLineNumber";
const ITEM_TRACE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemTraceNumber";
const QUESTIONNAIRE_TRACE_NUMBER_SYSTEM = "urn:trnorg:PASPAYER";
const ORDER_REF = "DeviceRequest/dev-1";
const PAYER = "http://payer.example/fhir";

const QUESTIONNAIRE_PAYLOAD: CommunicationRequestPayload[] = [
  { contentString: "102089-0" },
];

function claimResponse(communicationRequest = true): Bundle["entry"] {
  return [
    {
      resource: {
        resourceType: "ClaimResponse",
        id: "cr-1",
        identifier: [
          {
            system: "http://example.org/PATIENT_EVENT_TRACE_NUMBER",
            value: "ACN-1",
          },
        ],
        status: "active",
        type: { coding: [{ code: "professional" }] },
        use: "preauthorization",
        patient: { reference: "Patient/pat-1" },
        created: "2026-06-04T10:00:00Z",
        insurer: { reference: "Organization/org-1" },
        outcome: "queued",
        ...(communicationRequest
          ? {
              communicationRequest: [{ reference: "urn:uuid:commreq-1" }],
              item: [
                {
                  itemSequence: 1,
                  adjudication: [],
                  extension: [
                    {
                      url: ITEM_TRACE_NUMBER_EXT,
                      valueIdentifier: {
                        system: QUESTIONNAIRE_TRACE_NUMBER_SYSTEM,
                        value: "home-o2-std-questionnaire",
                      },
                    },
                  ],
                },
              ],
            }
          : {}),
      },
    },
  ];
}

function pendedBundle(payload: CommunicationRequestPayload[]): Bundle {
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      ...(claimResponse(true) ?? []),
      {
        fullUrl: "urn:uuid:commreq-1",
        resource: {
          resourceType: "CommunicationRequest",
          id: "commreq-1",
          status: "active",
          extension: [{ url: SERVICE_LINE_NUMBER_EXT, valuePositiveInt: 1 }],
          payload,
        },
      },
    ],
  };
}

describe("buildPasTasks", () => {
  it("builds a questionnaire Task linked to its order and ClaimResponse", () => {
    const task = buildPasTasks(
      pendedBundle(QUESTIONNAIRE_PAYLOAD),
      PAYER,
      ORDER_REF,
    )[0];

    expect(task.code?.coding?.[0].code).toBe(
      "attachment-request-questionnaire",
    );
    expect(task.focus?.reference).toBe(ORDER_REF);
    expect(task.identifier?.[0].value).toBe("ACN-1");
    expect(task.for?.reference).toBe("Patient/pat-1");
    const crOutput = task.output?.find((o) => o.type?.text === "ClaimResponse");
    expect(crOutput?.valueReference?.identifier?.value).toBe("ACN-1");
  });

  it("carries the questionnaire context (item trace number) as a string input", () => {
    const task = buildPasTasks(
      pendedBundle(QUESTIONNAIRE_PAYLOAD),
      PAYER,
      ORDER_REF,
    )[0];

    const input = task.input?.find(
      (i) => i.type?.coding?.[0].code === "questionnaire-context",
    );
    expect(input?.valueString).toBe("home-o2-std-questionnaire");
    expect(input?.valueCanonical).toBeUndefined();
    expect(task.requester).toBeDefined();
    expect(task.owner).toBeDefined();
  });

  it("builds a code Task from a contentString code payload", () => {
    const tasks = buildPasTasks(
      pendedBundle([{ contentString: "18776-5" }]),
      PAYER,
      ORDER_REF,
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].code?.coding?.[0].code).toBe("attachment-request-code");
    const input = tasks[0].input?.find(
      (i) => i.type?.coding?.[0].code === "attachments-needed",
    );
    expect(input?.valueCodeableConcept?.coding?.[0].code).toBe("18776-5");
  });

  it("returns no tasks when the ClaimResponse has no communicationRequest", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: claimResponse(false),
    };
    expect(buildPasTasks(bundle, PAYER, ORDER_REF)).toEqual([]);
  });
});

describe("ensurePasTasks", () => {
  it("synthesizes a base PA-tracking Task when no documentation is requested", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: claimResponse(false),
    };

    const tasks = ensurePasTasks(bundle, PAYER, ORDER_REF);

    expect(tasks).toHaveLength(1);
    const task = tasks[0];
    expect(task.code).toBeUndefined();
    expect(task.focus?.reference).toBe(ORDER_REF);
    expect(task.identifier?.[0].value).toBe("ACN-1");
    expect(task.status).toBe("in-progress"); // queued -> in-progress
    expect(task.output?.[0].valueReference?.identifier?.value).toBe("ACN-1");
  });

  it("returns the documentation Tasks when present", () => {
    const tasks = ensurePasTasks(
      pendedBundle(QUESTIONNAIRE_PAYLOAD),
      PAYER,
      ORDER_REF,
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].code?.coding?.[0].code).toBe(
      "attachment-request-questionnaire",
    );
  });

  it("never emits a pa-status custom extension", () => {
    const tasks = ensurePasTasks(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: claimResponse(false),
      },
      PAYER,
      ORDER_REF,
    );
    expect(JSON.stringify(tasks)).not.toContain("pa-status");
  });
});

describe("mapOutcomeToTaskStatus", () => {
  it("maps ClaimResponse outcomes to Task lifecycle", () => {
    expect(mapOutcomeToTaskStatus("complete")).toBe("completed");
    expect(mapOutcomeToTaskStatus("error")).toBe("failed");
    expect(mapOutcomeToTaskStatus("queued")).toBe("in-progress");
    expect(mapOutcomeToTaskStatus("partial")).toBe("in-progress");
    expect(mapOutcomeToTaskStatus(undefined)).toBe("requested");
  });
});
