import type { Bundle, QuestionnaireResponse } from "fhir/r4";
import { useMemo } from "react";
import { usePatientQuestionnaireResponses } from "@/hooks/use-clinical-api";

const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

export interface PatientQrIndexEntry {
  completed: QuestionnaireResponse[];
  inProgress: QuestionnaireResponse[];
}

export interface PatientQrIndex {
  byCanonical: Map<string, PatientQrIndexEntry>;
  isLoading: boolean;
}

/**
 * Tri-state DTR satisfaction for one order's requirement. Anchored on the
 * (canonical, orderRef) pair via the qr-context extension; QRs without a
 * matching qr-context are excluded.
 */
export type OrderSatisfactionState =
  | { kind: "notStarted" }
  | { kind: "inProgressForThisOrder"; qr: QuestionnaireResponse }
  | { kind: "completedForThisOrder"; qr: QuestionnaireResponse };

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
    ensure(stripCanonicalVersion(qr.questionnaire)).completed.push(qr);
  }
  for (const qr of inProgress) {
    if (!qr.questionnaire) continue;
    ensure(stripCanonicalVersion(qr.questionnaire)).inProgress.push(qr);
  }
  // Sort each bucket so consumers can rely on [0] being most-recent.
  const byUpdatedDesc = (a: QuestionnaireResponse, b: QuestionnaireResponse) =>
    (b.meta?.lastUpdated ?? "").localeCompare(a.meta?.lastUpdated ?? "");
  for (const entry of map.values()) {
    entry.completed.sort(byUpdatedDesc);
    entry.inProgress.sort(byUpdatedDesc);
  }
  return map;
}

/**
 * Returns the most-recent in-progress QR matching `canonical`, or undefined.
 * Completed QRs are intentionally excluded — DTR's "Retrieving Questionnaire
 * Packages" SHALL NOT permits resuming an in-progress QR but forbids reusing
 * a completed one to satisfy a freshly-arrived DTR request.
 */
export function findReusableQr(
  index: PatientQrIndex,
  canonical: string,
): QuestionnaireResponse | undefined {
  const entry = index.byCanonical.get(stripCanonicalVersion(canonical));
  return entry?.inProgress[0];
}

/**
 * Tri-state lookup keyed on (canonical, orderRef). A completed QR satisfies
 * an order only when its qr-context extension references that exact order;
 * QRs for other orders or without qr-context are out of satisfaction scope.
 */
export function getOrderSatisfactionState(
  index: PatientQrIndex,
  canonical: string,
  orderRef: string,
): OrderSatisfactionState {
  const entry = index.byCanonical.get(stripCanonicalVersion(canonical));
  if (!entry) return { kind: "notStarted" };

  const inProgressForOrder = entry.inProgress.filter((qr) =>
    hasQrContext(qr, orderRef),
  );
  if (inProgressForOrder[0]) {
    return { kind: "inProgressForThisOrder", qr: inProgressForOrder[0] };
  }
  const completedForOrder = entry.completed.filter((qr) =>
    hasQrContext(qr, orderRef),
  );
  if (completedForOrder[0]) {
    return { kind: "completedForThisOrder", qr: completedForOrder[0] };
  }
  return { kind: "notStarted" };
}

/**
 * Reduces per-canonical satisfaction states to a single state for a multi-
 * questionnaire order's UI affordance. Any notStarted wins, then 
 * inProgressForThisOrder, otherwise completedForThisOrder when every 
 * canonical is satisfied.
 */
export function aggregateOrderState(
  states: OrderSatisfactionState[],
): OrderSatisfactionState {
  if (states.length === 0) return { kind: "notStarted" };
  if (states.some((s) => s.kind === "notStarted"))
    return { kind: "notStarted" };
  const inProgress = states.find((s) => s.kind === "inProgressForThisOrder");
  if (inProgress) return inProgress;
  return (
    states.find((s) => s.kind === "completedForThisOrder") ?? {
      kind: "notStarted",
    }
  );
}

/**
 * Returns all completed QRs for the canonical, regardless of order linkage.
 * View-only — callers SHALL NOT pass these into openDtrTask or fhirContext.
 */
export function findCompletedQrsForView(
  index: PatientQrIndex,
  canonical: string,
): QuestionnaireResponse[] {
  const entry = index.byCanonical.get(stripCanonicalVersion(canonical));
  return entry?.completed ?? [];
}

function hasQrContext(qr: QuestionnaireResponse, orderRef: string): boolean {
  return (qr.extension ?? []).some(
    (ext) =>
      ext.url === QR_CONTEXT_EXT_URL &&
      ext.valueReference?.reference === orderRef,
  );
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
