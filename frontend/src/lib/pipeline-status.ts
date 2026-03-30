import type { OrderPaStatus } from "@/hooks/use-clinical-api";
import type { CoverageInformation } from "@/lib/cds-types";

export type CoverageStage =
  | "unknown"
  | "covered"
  | "not-covered"
  | "conditional";

export type DocStage = "not-needed" | "needed" | "in-progress" | "completed";

export type AuthStage =
  | "not-needed"
  | "not-started"
  | "pended"
  | "pended-docs-needed"
  | "approved"
  | "denied";

export interface PipelineStatus {
  coverage: CoverageStage;
  documentation: DocStage;
  authorization: AuthStage;
}

export function derivePipelineStatus(
  coverageInfo: CoverageInformation[],
  dtrStatus: "none" | "in-progress" | "completed",
  paStatus: OrderPaStatus | undefined,
): PipelineStatus {
  const primary = coverageInfo[0];

  const coverage: CoverageStage = primary?.covered ?? "unknown";

  const docNeeded = primary?.docNeeded;
  const hasQuestionnaire = (primary?.questionnaire?.length ?? 0) > 0;
  let documentation: DocStage;
  if (!docNeeded || docNeeded === "no-doc" || !hasQuestionnaire) {
    documentation = "not-needed";
  } else {
    documentation =
      dtrStatus === "completed"
        ? "completed"
        : dtrStatus === "in-progress"
          ? "in-progress"
          : "needed";
  }

  const paNeeded = primary?.paNeeded;
  let authorization: AuthStage;
  if (paNeeded !== "auth-needed") {
    authorization = "not-needed";
  } else if (!paStatus) {
    authorization = "not-started";
  } else {
    const outcome = paStatus.outcome;
    if (outcome === "complete") {
      authorization = "approved";
    } else if (outcome === "error") {
      authorization = "denied";
    } else {
      authorization = "pended";
    }
  }

  return { coverage, documentation, authorization };
}
