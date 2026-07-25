import type {
  Coverage,
  FhirResource,
  Identifier,
  Parameters,
  ParametersParameter,
  Patient,
  Task,
} from "fhir/r4";
import {
  PROVIDER_ORG_IDENTIFIER_SYSTEM,
  providerOrgIdentifier,
} from "./pas-bundle-builder";
import { SERVICE_LINE_NUMBER_EXT } from "./pas-task-builder";

/**
 * Client-side builder for the CDex `$submit-attachment` operation. Assembles a
 * cdex-parameters-submit-attachment Parameters resource from a documentation Task and the
 * resolved attachment content (QuestionnaireResponse / DocumentReference), so the conformant
 * artifact is constructed in the browser and observable on the wire. The thin FHIR proxy
 * injects the payer B2B token; this module owns the FHIR shaping.
 */

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const MEMBER_TYPE_CODE = "MB";
const MEMBER_IDENTIFIER_SYSTEM = "http://example.org/MIN";

const PARAM_TRACKING_ID = "TrackingId";
const PARAM_ATTACH_TO = "AttachTo";
const PARAM_MEMBER_ID = "MemberId";
const PARAM_ORGANIZATION_ID = "OrganizationId";
const PARAM_PROVIDER_ID = "ProviderId";
const PARAM_ATTACHMENT = "Attachment";
const PARAM_ATTACHMENT_LINE_ITEM = "LineItem";
const PARAM_ATTACHMENT_CONTENT = "Content";
const PARAM_FINAL = "Final";

const CLAIM_USE_PREAUTHORIZATION = "preauthorization";
const INPUT_PAYER_URL = "payer-url";

export interface SubmitAttachmentInput {
  task: Task;
  memberId: Identifier;
  organizationId: Identifier;
  /** Omitted when no real practitioner NPI is available; never a placeholder NPI. */
  providerId?: Identifier;
  contents: FhirResource[];
  /** Claim line numbers this attachment applies to, from the Task's serviceLineNumber extension. */
  lineItems?: number[];
  final: boolean;
}

/** Builds the cdex-parameters-submit-attachment Parameters for the PAS (preauthorization) path. */
export function buildSubmitAttachmentParameters(
  input: SubmitAttachmentInput,
): Parameters {
  const {
    task,
    memberId,
    organizationId,
    providerId,
    contents,
    lineItems,
    final,
  } = input;

  const lineItemParts = (lineItems ?? []).map((lineItem) => ({
    name: PARAM_ATTACHMENT_LINE_ITEM,
    valueString: String(lineItem),
  }));

  const parameter: ParametersParameter[] = [
    { name: PARAM_TRACKING_ID, valueIdentifier: trackingIdentifier(task) },
    { name: PARAM_ATTACH_TO, valueCode: CLAIM_USE_PREAUTHORIZATION },
    { name: PARAM_MEMBER_ID, valueIdentifier: memberId },
    { name: PARAM_ORGANIZATION_ID, valueIdentifier: organizationId },
    ...(providerId
      ? [{ name: PARAM_PROVIDER_ID, valueIdentifier: providerId }]
      : []),
    ...contents.map((content) => ({
      name: PARAM_ATTACHMENT,
      part: [
        ...lineItemParts,
        { name: PARAM_ATTACHMENT_CONTENT, resource: content },
      ],
    })),
    { name: PARAM_FINAL, valueBoolean: final },
  ];

  return { resourceType: "Parameters", parameter };
}

/** TrackingId derived from the Task's first identifier; throws if the Task carries none. */
export function trackingIdentifier(task: Task): Identifier {
  const first = task.identifier?.[0];
  if (!first) {
    throw new Error("Task has no identifier to use as TrackingId");
  }
  return identifierFields(first);
}

/** Resolves the submit-attachment base URL from the Task `payer-url` input, else the fallback. */
export function resolvePayerUrl(task: Task, fallback: string): string {
  for (const input of task.input ?? []) {
    if (hasCode(input.type?.coding, INPUT_PAYER_URL) && input.valueUrl) {
      return input.valueUrl;
    }
  }
  return fallback;
}

/** Extracts the Patient id from Task.for; throws if Task.for is not a Patient reference. */
export function patientIdFromTask(task: Task): string {
  const ref = task.for?.reference;
  if (!ref || !ref.includes("Patient/")) {
    throw new Error("Task.for does not reference a Patient");
  }
  return ref.substring(ref.indexOf("Patient/") + "Patient/".length);
}

/**
 * Resolves the payer-issued MemberId identifier: the Patient's type=MB identifier, else the
 * Coverage's type=MB identifier, else Coverage.subscriberId (the same member value the PAS
 * bundle stamps). Throws rather than fabricating one when no source is available.
 */
export function memberIdentifier(
  patient: Patient,
  coverage?: Coverage,
): Identifier {
  const memberTyped = (patient.identifier ?? []).find((id) =>
    hasCode(id.type?.coding, MEMBER_TYPE_CODE),
  );
  if (memberTyped) {
    return identifierFields(memberTyped);
  }

  const coverageMember = (coverage?.identifier ?? []).find((id) =>
    hasCode(id.type?.coding, MEMBER_TYPE_CODE),
  );
  if (coverageMember) {
    return identifierFields(coverageMember);
  }

  if (coverage?.subscriberId) {
    return { system: MEMBER_IDENTIFIER_SYSTEM, value: coverage.subscriberId };
  }

  throw new Error(
    "No payer member identifier available for $submit-attachment",
  );
}

/** ProviderId identifier from a real NPI; undefined when none is available (no placeholder NPI). */
export function providerIdentifier(npi?: string): Identifier | undefined {
  const value = npi?.trim();
  return value ? { system: NPI_SYSTEM, value } : undefined;
}

/** OrganizationId identifier: the provider org identifier used by the PAS bundles. */
export function organizationIdentifier(): Identifier {
  return {
    system: PROVIDER_ORG_IDENTIFIER_SYSTEM,
    value: providerOrgIdentifier(),
  };
}

/** Distinct claim line numbers from the Task's input serviceLineNumber extensions. */
export function taskLineItems(task: Task): number[] {
  const values = (task.input ?? []).flatMap((input) =>
    (input.extension ?? [])
      .filter((extension) => extension.url === SERVICE_LINE_NUMBER_EXT)
      .map((extension) => extension.valuePositiveInt)
      .filter((value): value is number => value != null),
  );
  return [...new Set(values)];
}

function identifierFields(identifier: Identifier): Identifier {
  const result: Identifier = {};
  if (identifier.system) result.system = identifier.system;
  if (identifier.value) result.value = identifier.value;
  return result;
}

function hasCode(
  codings: Array<{ code?: string }> | undefined,
  code: string,
): boolean {
  return !!codings?.some((c) => c.code === code);
}
