import type {
  Bundle,
  ClaimResponse,
  CommunicationRequestPayload,
} from "fhir/r4";
import { describe, expect, it } from "vitest";
import {
  buildPasTasks,
  ensurePasTasks,
  mapOutcomeToTaskStatus,
  questionnaireContexts,
} from "./pas-task-builder";

const SERVICE_LINE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-serviceLineNumber";
const ITEM_TRACE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemTraceNumber";
const QUESTIONNAIRE_TRACE_NUMBER_SYSTEM = "urn:trnorg:PASPAYER";
const ORDER_REF = "DeviceRequest/dev-1";
const PATIENT_REF = "Patient/pat-1";
const PAYER = "http://payer.example/fhir";

const QUESTIONNAIRE_PAYLOAD: CommunicationRequestPayload[] = [
  { contentString: "102089-0" },
];

function baseClaimResponseFields() {
  return {
    id: "cr-1",
    identifier: [
      {
        system: "http://example.org/PATIENT_EVENT_TRACE_NUMBER",
        value: "ACN-1",
      },
    ],
    status: "active" as const,
    type: { coding: [{ code: "professional" }] },
    use: "preauthorization" as const,
    patient: { reference: "Patient/pat-1" },
    created: "2026-06-04T10:00:00Z",
    insurer: {
      reference: "Organization/org-1",
      identifier: {
        system: "urn:oid:2.16.840.1.113883.6.300",
        value: "00001",
      },
    },
    outcome: "queued" as const,
  };
}

function crWithItemTrn(
  system: string | undefined,
  value: string,
  itemSequence = 1,
): ClaimResponse {
  return {
    resourceType: "ClaimResponse",
    ...baseClaimResponseFields(),
    communicationRequest: [{ reference: "urn:uuid:commreq-1" }],
    item: [
      {
        itemSequence,
        adjudication: [],
        extension: [
          { url: ITEM_TRACE_NUMBER_EXT, valueIdentifier: { system, value } },
        ],
      },
    ],
  } as ClaimResponse;
}

function claimResponse(communicationRequest = true): Bundle["entry"] {
  return [
    {
      resource: {
        resourceType: "ClaimResponse",
        ...baseClaimResponseFields(),
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
      PATIENT_REF,
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
      PATIENT_REF,
    )[0];

    const input = task.input?.find(
      (i) => i.type?.coding?.[0].code === "questionnaire-context",
    );
    expect(input?.valueString).toBe("home-o2-std-questionnaire");
    expect(input?.valueCanonical).toBeUndefined();
    expect(task.requester?.identifier?.value).toBe("00001");
    expect(task.owner).toBeDefined();
  });

  it("sets Task.requester from the insurer Organization inlined in the response bundle", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);
    bundle.entry?.push({
      fullUrl: "http://payer.example/fhir/Organization/org-1",
      resource: {
        resourceType: "Organization",
        id: "org-1",
        identifier: [
          { system: "urn:oid:2.16.840.1.113883.6.300", value: "00777" },
        ],
      },
    });

    const task = buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF)[0];

    expect(task.requester?.identifier?.value).toBe("00777");
    expect(task.owner?.identifier?.value).not.toBe("00777");
  });

  it("aggregates multiple questionnaire CommunicationRequests into one Task with deduplicated contexts", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);
    bundle.entry?.push({
      fullUrl: "urn:uuid:commreq-2",
      resource: {
        resourceType: "CommunicationRequest",
        id: "commreq-2",
        status: "active",
        extension: [{ url: SERVICE_LINE_NUMBER_EXT, valuePositiveInt: 1 }],
        payload: QUESTIONNAIRE_PAYLOAD,
      },
    });
    const cr = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse;
    cr.communicationRequest = [
      { reference: "urn:uuid:commreq-1" },
      { reference: "urn:uuid:commreq-2" },
    ];

    const tasks = buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF);
    const questionnaireTasks = tasks.filter(
      (t) => t.code?.coding?.[0].code === "attachment-request-questionnaire",
    );

    expect(questionnaireTasks).toHaveLength(1);
    const contexts = questionnaireTasks[0].input?.filter(
      (i) => i.type?.coding?.[0].code === "questionnaire-context",
    );
    expect(contexts).toHaveLength(1);
    expect(contexts?.[0].valueString).toBe("home-o2-std-questionnaire");
  });

  it("builds a code Task from a contentString code payload", () => {
    const tasks = buildPasTasks(
      pendedBundle([{ contentString: "18776-5" }]),
      PAYER,
      ORDER_REF,
      PATIENT_REF,
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].code?.coding?.[0].code).toBe("attachment-request-code");
    const input = tasks[0].input?.find(
      (i) => i.type?.coding?.[0].code === "attachments-needed",
    );
    expect(input?.valueCodeableConcept?.coding?.[0].code).toBe("18776-5");
  });

  it("sets reasonReference to the Claim, not the ClaimResponse", () => {
    const task = buildPasTasks(
      pendedBundle(QUESTIONNAIRE_PAYLOAD),
      PAYER,
      ORDER_REF,
      PATIENT_REF,
    )[0];

    expect(task.reasonReference?.type).toBe("Claim");
    expect(task.reasonReference?.identifier?.value).toBe("ACN-1");
  });

  it("throws instead of emitting a Task without a tracking identifier or patient reference", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);
    const cr = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse;
    cr.identifier = undefined;
    cr.patient = undefined as unknown as ClaimResponse["patient"];

    expect(() => buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF)).toThrow(
      /tracking identifier/i,
    );
  });

  it("throws when the provider patient reference is missing", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);

    expect(() => buildPasTasks(bundle, PAYER, ORDER_REF, "")).toThrow(
      /patient reference/i,
    );
  });

  it("uses the provider patient reference for Task.for, never the payer's", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);
    const cr = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse;
    cr.patient = { reference: "Patient/1822" };

    const task = buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF)[0];

    expect(task.for?.reference).toBe(PATIENT_REF);
  });

  it("falls back to the submitted Claim's tracking identifier when the ClaimResponse has none", () => {
    const bundle = pendedBundle(QUESTIONNAIRE_PAYLOAD);
    const cr = bundle.entry?.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse;
    cr.identifier = undefined;
    const claimIdentifier = {
      system: "http://example.org/CLAIM_ID",
      value: "claim-123",
    };

    const task = buildPasTasks(
      bundle,
      PAYER,
      ORDER_REF,
      PATIENT_REF,
      claimIdentifier,
    )[0];

    expect(task.identifier?.[0].value).toBe("claim-123");
    expect(task.reasonReference?.identifier?.value).toBe("claim-123");
    expect(task.output).toBeUndefined();
  });

  it("splits LOINC and PWK01 attachment codes into separate attachment-request-code Tasks", () => {
    const tasks = buildPasTasks(
      pendedBundle([{ contentString: "18748-4" }, { contentString: "OZ" }]),
      PAYER,
      ORDER_REF,
      PATIENT_REF,
    );

    const codeTasks = tasks.filter(
      (t) => t.code?.coding?.[0].code === "attachment-request-code",
    );
    expect(codeTasks).toHaveLength(2);
    const systems = codeTasks.map(
      (t) =>
        t.input?.find((i) => i.type?.coding?.[0].code === "attachments-needed")
          ?.valueCodeableConcept?.coding?.[0].system,
    );
    expect(systems).toContain("http://loinc.org");
    expect(systems).toContain("https://codesystem.x12.org/005010/755");
  });

  it("copies the CommunicationRequest payload's contentModifier extension onto the AttachmentsNeeded input", () => {
    const contentModifierExt = {
      url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-contentModifier",
      valueCodeableConcept: {
        coding: [{ system: "http://loinc.org", code: "18804-5" }],
      },
    };
    const tasks = buildPasTasks(
      pendedBundle([
        { contentString: "18776-5", extension: [contentModifierExt] },
      ]),
      PAYER,
      ORDER_REF,
      PATIENT_REF,
    );

    const input = tasks[0].input?.find(
      (i) => i.type?.coding?.[0].code === "attachments-needed",
    );
    expect(input?.extension).toContainEqual(contentModifierExt);
  });

  it("returns no tasks when the ClaimResponse has no communicationRequest", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: claimResponse(false),
    };
    expect(buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF)).toEqual([]);
  });

  it("returns multiple TRNs and emits one questionnaire-context input per TRN", () => {
    const cr = crWithItemTrn("urn:trnorg:X", "ctx-1");
    cr.item?.[0].extension?.push({
      url: ITEM_TRACE_NUMBER_EXT,
      valueIdentifier: { value: "ctx-2" },
    });
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: cr },
        {
          fullUrl: "urn:uuid:commreq-1",
          resource: {
            resourceType: "CommunicationRequest",
            id: "commreq-1",
            status: "active",
            extension: [{ url: SERVICE_LINE_NUMBER_EXT, valuePositiveInt: 1 }],
            payload: QUESTIONNAIRE_PAYLOAD,
          },
        },
      ],
    };

    const tasks = buildPasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF);
    const qTask = tasks.find(
      (t) => t.code?.coding?.[0].code === "attachment-request-questionnaire",
    );
    const contexts = qTask?.input?.filter(
      (i) => i.type?.coding?.[0].code === "questionnaire-context",
    );
    expect(contexts?.map((i) => i.valueString)).toEqual(["ctx-1", "ctx-2"]);
  });
});

describe("questionnaireContexts", () => {
  it("accepts a TRN with any payer-specific identifier system", () => {
    const cr = crWithItemTrn("urn:trnorg:SOMEOTHERPAYER", "ctx-123");
    expect(questionnaireContexts(cr, 1)).toEqual(["ctx-123"]);
  });

  it("collects TRNs across all items when the request has no service line number", () => {
    const cr = crWithItemTrn(
      "http://example.org/ITEM_TRACE_NUMBER",
      "ctx-456",
      2,
    );
    expect(questionnaireContexts(cr, undefined)).toEqual(["ctx-456"]);
  });

  it("collects TRNs from addItem entries", () => {
    const cr = {
      resourceType: "ClaimResponse",
      ...baseClaimResponseFields(),
      addItem: [
        {
          extension: [
            {
              url: ITEM_TRACE_NUMBER_EXT,
              valueIdentifier: { value: "ctx-add" },
            },
          ],
        },
      ],
    } as ClaimResponse;
    expect(questionnaireContexts(cr, undefined)).toEqual(["ctx-add"]);
  });

  it("collects header-level TRNs from identifiers beyond the tracking identifier", () => {
    const cr = crWithItemTrn("urn:trnorg:X", "ctx-1");
    cr.identifier?.push({
      system: "urn:trnorg:HEADER",
      value: "ctx-header",
    });
    expect(questionnaireContexts(cr, 1)).toEqual(["ctx-1", "ctx-header"]);
  });

  it("deduplicates TRN values collected from multiple placements", () => {
    const cr = crWithItemTrn("urn:trnorg:X", "ctx-1");
    cr.identifier?.push({ system: "urn:trnorg:HEADER", value: "ctx-1" });
    expect(questionnaireContexts(cr, 1)).toEqual(["ctx-1"]);
  });
});

describe("ensurePasTasks", () => {
  it("keeps a pended outcome=complete response in-progress, not completed", () => {
    const entries = claimResponse(false);
    const cr = entries?.find(
      (e) => e.resource?.resourceType === "ClaimResponse",
    )?.resource as ClaimResponse;
    cr.outcome = "complete";
    cr.item = [
      {
        itemSequence: 1,
        adjudication: [
          {
            category: { coding: [{ code: "submitted" }] },
            extension: [
              {
                url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction",
                extension: [
                  {
                    url: "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode",
                    valueCodeableConcept: {
                      coding: [
                        {
                          system: "https://codesystem.x12.org/005010/306",
                          code: "A4",
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    ];
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: entries,
    };

    const tasks = ensurePasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF);

    expect(tasks[0].status).toBe("in-progress");
  });

  it("synthesizes a base PA-tracking Task when no documentation is requested", () => {
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: claimResponse(false),
    };

    const tasks = ensurePasTasks(bundle, PAYER, ORDER_REF, PATIENT_REF);

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
      PATIENT_REF,
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
      PATIENT_REF,
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
