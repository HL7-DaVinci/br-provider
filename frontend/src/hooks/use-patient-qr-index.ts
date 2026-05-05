import type { Bundle, QuestionnaireResponse } from "fhir/r4";
import { useMemo } from "react";
import { usePatientQuestionnaireResponses } from "@/hooks/use-clinical-api";

export interface PatientQrIndexEntry {
  completed: QuestionnaireResponse[];
  inProgress: QuestionnaireResponse[];
}

export interface PatientQrIndex {
  byCanonical: Map<string, PatientQrIndexEntry>;
  isLoading: boolean;
}

/**
 * Indexes the patient's completed/amended and in-progress QuestionnaireResponses
 * by their `questionnaire` canonical URL. Used to detect reuse opportunities
 * when an order's CoverageInformation requires a particular questionnaire.
 */
export function usePatientQrIndex(patientId: string): PatientQrIndex {
  const completedQuery = usePatientQuestionnaireResponses(patientId, [
    "completed",
    "amended",
  ]);
  const inProgressQuery = usePatientQuestionnaireResponses(
    patientId,
    "in-progress",
  );

  const byCanonical = useMemo(
    () =>
      indexQrsByCanonical(
        extractQrs(completedQuery.data),
        extractQrs(inProgressQuery.data),
      ),
    [completedQuery.data, inProgressQuery.data],
  );

  return {
    byCanonical,
    isLoading: completedQuery.isLoading || inProgressQuery.isLoading,
  };
}

export function indexQrsByCanonical(
  completed: QuestionnaireResponse[],
  inProgress: QuestionnaireResponse[],
): Map<string, PatientQrIndexEntry> {
  const map = new Map<string, PatientQrIndexEntry>();
  const ensure = (canonical: string): PatientQrIndexEntry => {
    let entry = map.get(canonical);
    if (!entry) {
      entry = { completed: [], inProgress: [] };
      map.set(canonical, entry);
    }
    return entry;
  };
  for (const qr of completed) {
    if (!qr.questionnaire) continue;
    ensure(qr.questionnaire).completed.push(qr);
  }
  for (const qr of inProgress) {
    if (!qr.questionnaire) continue;
    ensure(qr.questionnaire).inProgress.push(qr);
  }
  return map;
}

/**
 * Looks up a completed QR satisfying `canonical`. Tries the raw canonical
 * first, then falls back to a version-stripped form so callers can match
 * regardless of whether the lookup or the stored QR carries a |version
 * suffix.
 */
export function findReusableQr(
  index: PatientQrIndex,
  canonical: string,
): QuestionnaireResponse | undefined {
  const entry =
    index.byCanonical.get(canonical) ??
    index.byCanonical.get(stripCanonicalVersion(canonical));
  return entry?.completed[0];
}

function extractQrs(
  bundle: Bundle<QuestionnaireResponse> | undefined,
): QuestionnaireResponse[] {
  return (bundle?.entry ?? [])
    .map((e) => e.resource)
    .filter(isQuestionnaireResponse);
}

function isQuestionnaireResponse(
  resource: unknown,
): resource is QuestionnaireResponse {
  return (
    !!resource &&
    typeof resource === "object" &&
    (resource as { resourceType?: string }).resourceType ===
      "QuestionnaireResponse"
  );
}

function stripCanonicalVersion(canonical: string): string {
  const pipeIdx = canonical.indexOf("|");
  return pipeIdx === -1 ? canonical : canonical.substring(0, pipeIdx);
}
