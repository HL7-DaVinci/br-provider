import type {
  Bundle,
  FhirResource,
  OperationOutcome,
  Questionnaire,
  QuestionnaireResponse,
} from "fhir/r4";
import { qrCanonical, stripCanonicalVersion } from "@/lib/qr-canonical";

/**
 * Records when the questionnaire package behind a QR was last retrieved from
 * the payer. DTR defines no element for this: the $questionnaire-package
 * operation presumes meta.lastUpdated is the retrieval time, which stops
 * holding once a draft is saved again. Project-defined, not part of the IG.
 */
export const PACKAGE_RETRIEVED_EXT_URL =
  "https://github.com/HL7-DaVinci/br-provider/StructureDefinition/dtr-package-retrieved";

export const ADAPTIVE_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-questionnaireAdaptive";

/** Contained resource types that belong to a questionnaire package. */
const PACKAGE_RESOURCE_TYPES = new Set(["Library", "ValueSet", "CodeSystem"]);

export function getPackageRetrievedAt(
  qr: QuestionnaireResponse,
): string | undefined {
  return qr.extension?.find((e) => e.url === PACKAGE_RETRIEVED_EXT_URL)
    ?.valueInstant;
}

/** Replaces any existing retrieval-time extension. Mutates `qr`. */
export function setPackageRetrievedAt(
  qr: QuestionnaireResponse,
  instant: string,
): void {
  qr.extension = [
    ...(qr.extension ?? []).filter((e) => e.url !== PACKAGE_RETRIEVED_EXT_URL),
    { url: PACKAGE_RETRIEVED_EXT_URL, valueInstant: instant },
  ];
}

/**
 * The `changedsince` to send when resuming a QR: the recorded retrieval
 * time, or meta.lastUpdated as the IG suggests for QRs without one.
 */
export function changedSinceForQr(
  qr: QuestionnaireResponse,
): string | undefined {
  return getPackageRetrievedAt(qr) ?? qr.meta?.lastUpdated;
}

/**
 * What a package request needs to resume a QR: the `changedsince` to send,
 * and, for an adaptive draft, a package rebuilt from the draft to use when
 * the payer reports nothing changed, saving a second full request.
 */
export interface PackageResumeHint {
  changedSince: string;
  unchangedBundle?: Bundle;
}

/**
 * Rebuilds a questionnaire package from an adaptive draft, which stores the
 * payer's Questionnaire revision and its Libraries and ValueSets as contained
 * resources (see AdaptiveDtrForm's prepareForSave). The Questionnaire takes
 * the original canonical so it matches the requested package, and keeps the
 * adaptive extension so the workspace renders the adaptive form. Returns
 * undefined for a QR that does not reference a contained Questionnaire.
 */
export function adaptivePackageFromQr(
  qr: QuestionnaireResponse,
): Bundle | undefined {
  const ref = qr.questionnaire;
  if (!ref?.startsWith("#")) return undefined;
  const contained = qr.contained ?? [];
  const q = contained.find(
    (r): r is Questionnaire =>
      r.resourceType === "Questionnaire" && r.id === ref.slice(1),
  );
  const canonical = qrCanonical(qr);
  if (!q || !canonical) return undefined;

  const [url, version] = canonical.split("|");
  const extension = q.extension?.some((e) => e.url === ADAPTIVE_EXT_URL)
    ? q.extension
    : [...(q.extension ?? []), { url: ADAPTIVE_EXT_URL, valueBoolean: true }];
  const questionnaire: Questionnaire = {
    ...q,
    url,
    version: version ?? q.version,
    extension,
  };
  const supporting = contained.filter((r) =>
    PACKAGE_RESOURCE_TYPES.has(r.resourceType),
  );
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: [questionnaire as FhirResource, ...supporting].map((resource) => ({
      resource,
    })),
  };
}

/**
 * Maps each canonical to the resume hint for the in-progress QR that will be
 * resumed for it. `preferred` (the QR named in the launch fhirContext) wins;
 * otherwise the most recently updated in-progress QR is used, matching the
 * workspace's resume choice. Canonicals with nothing to resume are absent.
 */
export function resolveResumeHints(
  canonicals: string[],
  inProgress: QuestionnaireResponse[],
  preferred?: QuestionnaireResponse,
): Record<string, PackageResumeHint> {
  const candidates = [
    ...(preferred?.status === "in-progress" ? [preferred] : []),
    ...[...inProgress].sort((a, b) =>
      (b.meta?.lastUpdated ?? "").localeCompare(a.meta?.lastUpdated ?? ""),
    ),
  ];
  const result: Record<string, PackageResumeHint> = {};
  for (const canonical of canonicals) {
    const target = stripCanonicalVersion(canonical);
    const qr = candidates.find((c) => {
      const qc = qrCanonical(c);
      return !!qc && stripCanonicalVersion(qc) === target;
    });
    const changedSince = qr ? changedSinceForQr(qr) : undefined;
    if (!qr || !changedSince) continue;
    const unchangedBundle = adaptivePackageFromQr(qr);
    result[canonical] = unchangedBundle
      ? { changedSince, unchangedBundle }
      : { changedSince };
  }
  return result;
}

/**
 * The OperationOutcome a $questionnaire-package response carries, either as
 * the `outcome` parameter or as a bare resource.
 */
export function extractPackageOutcome(data: unknown): OperationOutcome | null {
  if (!data || typeof data !== "object") return null;
  const obj = data as {
    resourceType?: string;
    parameter?: { name?: string; resource?: { resourceType?: string } }[];
  };
  if (obj.resourceType === "OperationOutcome") {
    return obj as unknown as OperationOutcome;
  }
  const param = obj.parameter?.find(
    (p) =>
      p.name === "outcome" && p.resource?.resourceType === "OperationOutcome",
  );
  return (param?.resource as OperationOutcome | undefined) ?? null;
}

export function outcomeHasErrors(outcome: OperationOutcome | null): boolean {
  return (
    outcome?.issue?.some(
      (i) => i.severity === "error" || i.severity === "fatal",
    ) ?? false
  );
}

/**
 * The earlier of the client's request-start time and the response Date
 * header. An earlier `changedsince` can only over-report changes, never miss
 * one, so taking the minimum absorbs clock skew in either direction.
 */
export function retrievalInstant(
  requestedAt: Date,
  dateHeader: string | null,
): string {
  const headerMs = dateHeader ? Date.parse(dateHeader) : Number.NaN;
  const ms = Number.isNaN(headerMs)
    ? requestedAt.getTime()
    : Math.min(headerMs, requestedAt.getTime());
  return new Date(ms).toISOString();
}
