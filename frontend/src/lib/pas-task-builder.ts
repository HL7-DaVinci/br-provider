import type {
  Bundle,
  ClaimResponse,
  CommunicationRequest,
  Identifier,
  Task,
} from "fhir/r4";
import { PROVIDER_ORG_IDENTIFIER } from "./pas-bundle-builder";

type TaskInput = NonNullable<Task["input"]>[number];

interface TaskContext {
  patientRef?: string;
  orderRef: string;
  payerFhirUrl: string;
  trackingId?: Identifier;
}

const TASK_CODE_SYSTEM =
  "http://hl7.org/fhir/us/davinci-pas/CodeSystem/PASTempCodes";
const TASK_CODE_QUESTIONNAIRE_REQUEST = "attachment-request-questionnaire";
const TASK_CODE_ATTACHMENT_REQUEST = "attachment-request-code";
const TASK_REASON_PRIOR_AUTH = "priorAuthorization";
const TASK_INPUT_PAYER_URL = "payer-url";
const TASK_INPUT_QUESTIONNAIRE_CONTEXT = "questionnaire-context";
const TASK_INPUT_ATTACHMENTS_NEEDED = "attachments-needed";
const SERVICE_LINE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-serviceLineNumber";
const LOINC_SYSTEM = "http://loinc.org";
const US_NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const CLAIM_RESPONSE_OUTPUT = "ClaimResponse";
const LOINC_QUESTIONNAIRE_REQUEST = "102089-0";
const ITEM_TRACE_NUMBER_EXT =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemTraceNumber";
const QUESTIONNAIRE_TRACE_NUMBER_SYSTEM = "urn:trnorg:PASPAYER";

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
): Task[] {
  const claimResponse = findClaimResponseInBundle(bundle);
  if (!bundle || !claimResponse) return [];

  const context: TaskContext = {
    patientRef: claimResponse.patient?.reference,
    orderRef,
    payerFhirUrl,
    trackingId: claimResponse.identifier?.[0],
  };

  const tasks: Task[] = [];
  for (const ref of claimResponse.communicationRequest ?? []) {
    const request = resolveCommunicationRequest(bundle, ref.reference);
    if (!request) continue;

    const lineNumber = serviceLineNumber(request);
    const payloads = request.payload ?? [];
    // A 102089-0 payload is a questionnaire request; its DTR context is the item trace number.
    const isQuestionnaireRequest = payloads.some(
      (p) => p.contentString === LOINC_QUESTIONNAIRE_REQUEST,
    );
    const attachmentCodes = payloads
      .map((p) => p.contentString)
      .filter((c): c is string => !!c && c !== LOINC_QUESTIONNAIRE_REQUEST);

    if (isQuestionnaireRequest) {
      const contextId = questionnaireContext(claimResponse, lineNumber);
      if (contextId) {
        tasks.push(
          buildTask(TASK_CODE_QUESTIONNAIRE_REQUEST, context, request.id, [
            questionnaireContextInput(contextId, lineNumber),
          ]),
        );
      }
    }
    if (attachmentCodes.length > 0) {
      tasks.push(
        buildTask(
          TASK_CODE_ATTACHMENT_REQUEST,
          context,
          request.id,
          attachmentCodes.map((code) => attachmentInput(code, lineNumber)),
        ),
      );
    }
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
): Task {
  const context: TaskContext = {
    patientRef: claimResponse.patient?.reference,
    orderRef,
    payerFhirUrl,
    trackingId: claimResponse.identifier?.[0],
  };
  const task = baseTask(context, mapOutcomeToTaskStatus(claimResponse.outcome));
  const trackingValue = context.trackingId?.value;
  if (trackingValue) task.id = `pa-task-${sanitizeId(trackingValue)}`;
  return task;
}

/** Returns the doc-request Tasks if any, else a single PA-tracking Task, so the order always has one. */
export function ensurePasTasks(
  bundle: Bundle | undefined,
  payerFhirUrl: string,
  orderRef: string,
): Task[] {
  const docTasks = buildPasTasks(bundle, payerFhirUrl, orderRef);
  if (docTasks.length > 0) return docTasks;
  const claimResponse = findClaimResponseInBundle(bundle);
  return claimResponse
    ? [buildPaStatusTask(claimResponse, orderRef, payerFhirUrl)]
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

/** The DTR context (item trace number) for a questionnaire request, matched by service line. */
function questionnaireContext(
  claimResponse: ClaimResponse,
  lineNumber: number | undefined,
): string | undefined {
  const item = claimResponse.item?.find((i) => i.itemSequence === lineNumber);
  return item?.extension
    ?.filter((e) => e.url === ITEM_TRACE_NUMBER_EXT)
    .map((e) => e.valueIdentifier)
    .find((id) => id?.system === QUESTIONNAIRE_TRACE_NUMBER_SYSTEM)?.value;
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

function attachmentInput(code: string, lineNumber?: number): TaskInput {
  return withLineNumber(
    {
      type: {
        coding: [
          { system: TASK_CODE_SYSTEM, code: TASK_INPUT_ATTACHMENTS_NEEDED },
        ],
      },
      valueCodeableConcept: { coding: [{ system: LOINC_SYSTEM, code }] },
    },
    lineNumber,
  );
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
    system: US_NPI_SYSTEM,
    value: PROVIDER_ORG_IDENTIFIER,
  };
  const task: Task = {
    resourceType: "Task",
    status,
    intent: "order",
    authoredOn: new Date().toISOString(),
    reasonCode: {
      coding: [{ system: TASK_CODE_SYSTEM, code: TASK_REASON_PRIOR_AUTH }],
    },
    requester: { identifier: providerId },
    owner: { identifier: providerId },
    focus: { reference: context.orderRef },
  };
  if (context.patientRef) task.for = { reference: context.patientRef };
  if (context.trackingId) {
    task.identifier = [context.trackingId];
    task.reasonReference = {
      type: "ClaimResponse",
      identifier: context.trackingId,
    };
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
  requestId: string | undefined,
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
  if (requestId) task.id = `task-${requestId}`;
  return task;
}

function sanitizeId(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "-").slice(0, 56);
}
