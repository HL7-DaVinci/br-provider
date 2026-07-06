import type { Bundle, QuestionnaireResponse } from "fhir/r4";

export type ActiveQrStatus = "in-progress";
export type TerminalQrStatus = "completed" | "amended";
export type AnyQrStatus = NonNullable<QuestionnaireResponse["status"]>;

export function isTerminalQrStatus(
  status: AnyQrStatus | string | null | undefined,
): status is TerminalQrStatus {
  return status === "completed" || status === "amended";
}

/**
 * Documentation completed in response to a payer request: terminal-status
 * responses authored at or after the anchor date. The anchor is normally the
 * documentation Task's authoredOn so the selection survives the claim being
 * resolved, since a resolved ClaimResponse may carry a later created date.
 * Entries with missing dates are included permissively.
 */
export function selectNewCompletedQrs(
  entries: Bundle<QuestionnaireResponse>["entry"],
  anchor: string | undefined,
): QuestionnaireResponse[] {
  return (entries ?? [])
    .filter((e) => isTerminalQrStatus(e.resource?.status))
    .map((e) => e.resource as QuestionnaireResponse)
    .filter((qr) => {
      if (!anchor) return true;
      const qrDate = qr.authored ? new Date(qr.authored) : null;
      return qrDate ? qrDate >= new Date(anchor) : true;
    });
}
