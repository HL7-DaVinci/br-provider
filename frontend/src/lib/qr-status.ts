import type { QuestionnaireResponse } from "fhir/r4";

export type ActiveQrStatus = "in-progress";
export type TerminalQrStatus = "completed" | "amended";
export type AnyQrStatus = NonNullable<QuestionnaireResponse["status"]>;

export function isTerminalQrStatus(
  status: AnyQrStatus | string | null | undefined,
): status is TerminalQrStatus {
  return status === "completed" || status === "amended";
}
