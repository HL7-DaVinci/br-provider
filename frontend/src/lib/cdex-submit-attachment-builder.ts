import type {
  FhirResource,
  Identifier,
  Parameters,
  ParametersParameter,
  Patient,
  Task,
} from "fhir/r4";

/**
 * Client-side builder for the CDex `$submit-attachment` operation. Assembles a
 * cdex-parameters-submit-attachment Parameters resource from a documentation Task and the
 * resolved attachment content (QuestionnaireResponse / DocumentReference), so the conformant
 * artifact is constructed in the browser and observable on the wire. The thin FHIR proxy
 * injects the payer B2B token; this module owns the FHIR shaping.
 */

const NPI_SYSTEM = "http://hl7.org/fhir/sid/us-npi";
const MEMBER_SYSTEM = "http://example.org/MIN";
const MEMBER_TYPE_CODE = "MB";
const DEFAULT_PROVIDER_NPI = "0000000000";

const PARAM_TRACKING_ID = "TrackingId";
const PARAM_ATTACH_TO = "AttachTo";
const PARAM_MEMBER_ID = "MemberId";
const PARAM_PROVIDER_ID = "ProviderId";
const PARAM_ATTACHMENT = "Attachment";
const PARAM_ATTACHMENT_CONTENT = "Content";
const PARAM_FINAL = "Final";

const CLAIM_USE_PREAUTHORIZATION = "preauthorization";
const INPUT_PAYER_URL = "payer-url";

/** Builds the cdex-parameters-submit-attachment Parameters for the PAS (preauthorization) path. */
export function buildSubmitAttachmentParameters(
  task: Task,
  memberId: Identifier,
  providerId: Identifier,
  contents: FhirResource[],
): Parameters {
  const parameter: ParametersParameter[] = [
    { name: PARAM_TRACKING_ID, valueIdentifier: trackingIdentifier(task) },
    { name: PARAM_ATTACH_TO, valueCode: CLAIM_USE_PREAUTHORIZATION },
    { name: PARAM_MEMBER_ID, valueIdentifier: memberId },
    { name: PARAM_PROVIDER_ID, valueIdentifier: providerId },
    ...contents.map((content) => ({
      name: PARAM_ATTACHMENT,
      part: [{ name: PARAM_ATTACHMENT_CONTENT, resource: content }],
    })),
    { name: PARAM_FINAL, valueBoolean: true },
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
 * Resolves the MemberId identifier: prefers a type=MB identifier, then the first identifier,
 * then a placeholder derived from the patient id.
 */
export function memberIdentifier(
  patient: Patient,
  patientId: string,
): Identifier {
  const ids = patient.identifier ?? [];
  const memberTyped = ids.find((id) =>
    hasCode(id.type?.coding, MEMBER_TYPE_CODE),
  );
  if (memberTyped) {
    return identifierFields(memberTyped);
  }
  if (ids.length > 0) {
    return identifierFields(ids[0]);
  }
  return { system: MEMBER_SYSTEM, value: patientId };
}

/** ProviderId identifier from an NPI, falling back to a placeholder NPI. */
export function providerIdentifier(npi?: string): Identifier {
  const value = npi?.trim() ? npi : DEFAULT_PROVIDER_NPI;
  return { system: NPI_SYSTEM, value };
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
