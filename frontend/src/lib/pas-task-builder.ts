import type {
  Bundle,
  ClaimResponse,
  CommunicationRequest,
  Extension,
  Identifier,
  Task,
} from "fhir/r4";
import { getStoredPractitionerRef } from "@/hooks/use-practitioner-ref";
import {
  PROVIDER_ORG_IDENTIFIER_SYSTEM,
  providerOrgIdentifier,
} from "./pas-bundle-builder";
import { isPendedClaimResponse } from "./pas-pend-status";

type TaskInput = NonNullable<Task["input"]>[number];

interface TaskContext {
  patientRef?: string;
  orderRef: string;
  payerFhirUrl: string;
  trackingId?: Identifier;
  claimIdentifier?: Identifier;
  insurerIdentifier?: Identifier;
}

/**
 * Task.requester.identifier maps from ClaimResponse.insurer.identifier[0]
 * (PAS additional-information mapping): the payer requests the documentation.
 * The insurer Organization inlined in the response bundle carries the
 * identifier; a logical insurer reference identifier is the fallback.
 */
function insurerIdentifierFrom(
  claimResponse: ClaimResponse,
  bundle?: Bundle,
): Identifier | undefined {
  const insurerRef = claimResponse.insurer?.reference;
  if (bundle && insurerRef) {
    const idPart = insurerRef.split("/").pop();
    const org = bundle.entry?.find(
      (e) =>
        e.resource?.resourceType === "Organization" &&
        (e.fullUrl === insurerRef ||
          (e.resource as { id?: string }).id === idPart),
    )?.resource as { identifier?: Identifier[] } | undefined;
    const first = org?.identifier?.[0];
    if (first?.value) {
      return { system: first.system, value: first.value };
    }
  }
  const logical = claimResponse.insurer?.identifier;
  return logical?.value
    ? { system: logical.system, value: logical.value }
    : undefined;
}

const TASK_CODE_SYSTEM =
  "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";
const TASK_CODE_QUESTIONNAIRE_REQUEST = "attachment-request-questionnaire";
const TASK_CODE_ATTACHMENT_REQUEST = "attachment-request-code";
const TASK_REASON_PRIOR_AUTH = "priorAuthorization";
const TASK_INPUT_PAYER_URL = "payer-url";
const TASK_INPUT_QUESTIONNAIRE_CONTEXT = "questionnaire-context";
const TASK_INPUT_ATTACHMENTS_NEEDED = "attachments-needed";
export const SERVICE_LINE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-serviceLineNumber";
const CONTENT_MODIFIER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-contentModifier";
const LOINC_SYSTEM = "http://loinc.org";
const X12_755_SYSTEM = "https://codesystem.x12.org/005010/755";
const LOINC_CODE_SHAPE = /^\d+-\d$/;
const CLAIM_RESPONSE_OUTPUT = "ClaimResponse";
const LOINC_QUESTIONNAIRE_REQUEST = "102089-0";
const ITEM_TRACE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemTraceNumber";

function findClaimResponseInBundle(
  bundle: Bundle | undefined,
): ClaimResponse | undefined {
  return bundle?.entry?.find(
    (e) => e.resource?.resourceType === "ClaimResponse",
  )?.resource as ClaimResponse | undefined;
}

export function mapOutcomeToTaskStatus(
  outcome: ClaimResponse["outcome"] | undefined,
): Task["status"] {
  switch (outcome) {
    case "complete":
      return "completed";
    case "error":
      return "failed";
    case "queued":
    case "partial":
      return "in-progress";
    default:
      return "requested";
  }
}

/**
 * Builds the provider's local PAS Task(s) from a PAS Response Bundle, deriving them from the
 * ClaimResponse.communicationRequest references. Each Task links to its order via Task.focus and to
 * its ClaimResponse via Task.output.
 */
export function buildPasTasks(
  bundle: Bundle | undefined,
  payerFhirUrl: string,
  orderRef: string,
  patientRef: string,
  claimIdentifier?: Identifier,
): Task[] {
  const claimResponse = findClaimResponseInBundle(bundle);
  if (!bundle || !claimResponse) return [];

  // Task.for must reference this provider's Patient; the ClaimResponse.patient
  // reference is a payer-side id that does not resolve here.
  const context: TaskContext = {
    patientRef,
    orderRef,
    payerFhirUrl,
    trackingId: claimResponse.identifier?.[0],
    claimIdentifier,
    insurerIdentifier: insurerIdentifierFrom(claimResponse, bundle),
  };

  const tasks: Task[] = [];
  // ainfo-7: one Task per request type (PWK01, LOINC, questionnaire), so inputs are collected
  // across every CommunicationRequest and each type emitted as a single Task. The payer sends one
  // questionnaire CommunicationRequest per canonical; their contexts are deduplicated per line.
  const loincInputs: TaskInput[] = [];
  const pwk01Inputs: TaskInput[] = [];
  const questionnaireInputs: TaskInput[] = [];
  const questionnaireContextKeys = new Set<string>();
  let loincRequestId: string | undefined;
  let pwk01RequestId: string | undefined;
  let questionnaireRequestId: string | undefined;

  for (const ref of claimResponse.communicationRequest ?? []) {
    const request = resolveCommunicationRequest(bundle, ref.reference);
    if (!request) continue;

    const lineNumber = serviceLineNumber(request);
    const payloads = request.payload ?? [];
    // A 102089-0 payload is a questionnaire request; its DTR context is the item trace number.
    const isQuestionnaireRequest = payloads.some(
      (p) => p.contentString === LOINC_QUESTIONNAIRE_REQUEST,
    );

    if (isQuestionnaireRequest) {
      const contextIds = questionnaireContexts(claimResponse, lineNumber);
      if (contextIds.length > 0) {
        questionnaireRequestId ??= request.id;
        for (const contextId of contextIds) {
          const key = `${contextId}|${lineNumber ?? ""}`;
          if (!questionnaireContextKeys.has(key)) {
            questionnaireContextKeys.add(key);
            questionnaireInputs.push(
              questionnaireContextInput(contextId, lineNumber),
            );
          }
        }
      } else {
        console.warn(
          "102089-0 questionnaire request has no itemTraceNumber TRN; skipping questionnaire-context Task per ainfo-3",
        );
      }
    }

    for (const payload of payloads) {
      const code = payload.contentString;
      if (!code || code === LOINC_QUESTIONNAIRE_REQUEST) continue;
      const contentModifier = payload.extension?.find(
        (e) => e.url === CONTENT_MODIFIER_EXT,
      );
      const input = attachmentInput(code, lineNumber, contentModifier);
      if (attachmentCodeSystem(code) === LOINC_SYSTEM) {
        loincInputs.push(input);
        loincRequestId ??= request.id;
      } else {
        pwk01Inputs.push(input);
        pwk01RequestId ??= request.id;
      }
    }
  }

  if (questionnaireInputs.length > 0) {
    tasks.push(
      buildTask(
        TASK_CODE_QUESTIONNAIRE_REQUEST,
        context,
        questionnaireRequestId ? `task-${questionnaireRequestId}` : undefined,
        questionnaireInputs,
      ),
    );
  }
  if (loincInputs.length > 0) {
    tasks.push(
      buildTask(
        TASK_CODE_ATTACHMENT_REQUEST,
        context,
        loincRequestId ? `task-${loincRequestId}-loinc` : undefined,
        loincInputs,
      ),
    );
  }
  if (pwk01Inputs.length > 0) {
    tasks.push(
      buildTask(
        TASK_CODE_ATTACHMENT_REQUEST,
        context,
        pwk01RequestId ? `task-${pwk01RequestId}-pwk01` : undefined,
        pwk01Inputs,
      ),
    );
  }
  return tasks;
}

/**
 * Builds a base FHIR Task tracking a prior authorization that requested no documentation, so every
 * submitted PA has a Task linking its order (Task.focus) to its ClaimResponse.
 */
export function buildPaStatusTask(
  claimResponse: ClaimResponse,
  orderRef: string,
  payerFhirUrl: string,
  patientRef: string,
  claimIdentifier?: Identifier,
  bundle?: Bundle,
): Task {
  const context: TaskContext = {
    patientRef,
    orderRef,
    payerFhirUrl,
    trackingId: claimResponse.identifier?.[0],
    claimIdentifier,
    insurerIdentifier: insurerIdentifierFrom(claimResponse, bundle),
  };
  const status = isPendedClaimResponse(claimResponse)
    ? "in-progress"
    : mapOutcomeToTaskStatus(claimResponse.outcome);
  const task = baseTask(context, status);
  const trackingValue = context.trackingId?.value ?? claimIdentifier?.value;
  if (trackingValue) task.id = `pa-task-${sanitizeId(trackingValue)}`;
  return task;
}

/** Returns the doc-request Tasks if any, else a single PA-tracking Task, so the order always has one. */
export function ensurePasTasks(
  bundle: Bundle | undefined,
  payerFhirUrl: string,
  orderRef: string,
  patientRef: string,
  claimIdentifier?: Identifier,
): Task[] {
  const docTasks = buildPasTasks(
    bundle,
    payerFhirUrl,
    orderRef,
    patientRef,
    claimIdentifier,
  );
  if (docTasks.length > 0) return docTasks;
  const claimResponse = findClaimResponseInBundle(bundle);
  return claimResponse
    ? [
        buildPaStatusTask(
          claimResponse,
          orderRef,
          payerFhirUrl,
          patientRef,
          claimIdentifier,
          bundle,
        ),
      ]
    : [];
}

function resolveCommunicationRequest(
  bundle: Bundle,
  reference: string | undefined,
): CommunicationRequest | undefined {
  if (!reference) return undefined;
  const entry = bundle.entry?.find(
    (e) =>
      e.fullUrl === reference ||
      (e.resource?.resourceType === "CommunicationRequest" &&
        (reference === `urn:uuid:${e.resource.id}` ||
          reference.endsWith(`CommunicationRequest/${e.resource.id}`))),
  );
  const resource = entry?.resource;
  return resource?.resourceType === "CommunicationRequest"
    ? (resource as CommunicationRequest)
    : undefined;
}

function serviceLineNumber(request: CommunicationRequest): number | undefined {
  return request.extension?.find((e) => e.url === SERVICE_LINE_NUMBER_EXT)
    ?.valuePositiveInt;
}

/** All DTR context TRNs for a questionnaire request, from any identifier system or placement. */
export function questionnaireContexts(
  claimResponse: ClaimResponse,
  lineNumber: number | undefined,
): string[] {
  const trnValues = (
    holder: { extension?: Extension[] } | undefined,
  ): string[] =>
    (holder?.extension ?? [])
      .filter((e) => e.url === ITEM_TRACE_NUMBER_EXT)
      .map((e) => e.valueIdentifier?.value)
      .filter((v): v is string => Boolean(v));

  const items = (claimResponse.item ?? []).filter(
    (it) => lineNumber === undefined || it.itemSequence === lineNumber,
  );
  const headerTrns = (claimResponse.identifier ?? [])
    .slice(1)
    .map((id) => id.value)
    .filter((v): v is string => Boolean(v));
  const collected = [
    ...items.flatMap(trnValues),
    ...(claimResponse.addItem ?? []).flatMap(trnValues),
    ...headerTrns,
  ];
  return [...new Set(collected)];
}

function questionnaireContextInput(
  context: string,
  lineNumber?: number,
): TaskInput {
  return withLineNumber(
    {
      type: {
        coding: [
          { system: TASK_CODE_SYSTEM, code: TASK_INPUT_QUESTIONNAIRE_CONTEXT },
        ],
      },
      valueString: context,
    },
    lineNumber,
  );
}

function attachmentCodeSystem(code: string): string {
  // ponytail: the payer sends a bare contentString with no coding/system today; classify by LOINC's
  // NNNNN-N shape until the payer adopts the profile's contentModifier/system extension instead.
  return LOINC_CODE_SHAPE.test(code) ? LOINC_SYSTEM : X12_755_SYSTEM;
}

function attachmentInput(
  code: string,
  lineNumber?: number,
  contentModifier?: Extension,
): TaskInput {
  const input = withLineNumber(
    {
      type: {
        coding: [
          { system: TASK_CODE_SYSTEM, code: TASK_INPUT_ATTACHMENTS_NEEDED },
        ],
      },
      valueCodeableConcept: {
        coding: [{ system: attachmentCodeSystem(code), code }],
      },
    },
    lineNumber,
  );
  if (contentModifier) {
    input.extension = [...(input.extension ?? []), contentModifier];
  }
  return input;
}

function withLineNumber(input: TaskInput, lineNumber?: number): TaskInput {
  if (lineNumber != null) {
    input.extension = [
      { url: SERVICE_LINE_NUMBER_EXT, valuePositiveInt: lineNumber },
    ];
  }
  return input;
}

function baseTask(context: TaskContext, status: Task["status"]): Task {
  const providerId: Identifier = {
    system: PROVIDER_ORG_IDENTIFIER_SYSTEM,
    value: providerOrgIdentifier(),
  };
  const practitionerRef = getStoredPractitionerRef();
  const trackingId = context.trackingId ?? context.claimIdentifier;
  if (!trackingId || !context.patientRef) {
    throw new Error(
      "Cannot build a PAS Task: no tracking identifier available from the ClaimResponse or the submitted Claim, or no provider patient reference supplied",
    );
  }
  const task: Task = {
    resourceType: "Task",
    status,
    intent: "order",
    authoredOn: new Date().toISOString(),
    reasonCode: {
      coding: [{ system: TASK_CODE_SYSTEM, code: TASK_REASON_PRIOR_AUTH }],
    },
    ...(context.insurerIdentifier
      ? { requester: { identifier: context.insurerIdentifier } }
      : {}),
    // CDex assigns Task.owner to the provider being asked to act; the launching
    // practitioner is used when the SMART fhirUser claim identifies one, with
    // the organization NPI as the fallback for non-SMART launches.
    owner: practitionerRef
      ? { reference: practitionerRef }
      : { identifier: providerId },
    focus: { reference: context.orderRef },
    for: { reference: context.patientRef },
    identifier: [trackingId],
    reasonReference: { type: "Claim", identifier: trackingId },
  };
  if (context.trackingId) {
    task.output = [
      {
        type: { text: CLAIM_RESPONSE_OUTPUT },
        valueReference: {
          type: "ClaimResponse",
          identifier: context.trackingId,
        },
      },
    ];
  }
  return task;
}

function buildTask(
  code: string,
  context: TaskContext,
  id: string | undefined,
  inputs: TaskInput[],
): Task {
  const task = baseTask(context, "requested");
  task.code = { coding: [{ system: TASK_CODE_SYSTEM, code }] };
  task.input = [
    {
      type: {
        coding: [{ system: TASK_CODE_SYSTEM, code: TASK_INPUT_PAYER_URL }],
      },
      valueUrl: context.payerFhirUrl,
    },
    ...inputs,
  ];
  if (id) task.id = id;
  return task;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 56);
}
