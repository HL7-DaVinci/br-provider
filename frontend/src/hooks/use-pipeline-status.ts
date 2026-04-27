import type {
  Bundle,
  DomainResource,
  QuestionnaireResponse,
  Resource,
} from "fhir/r4";
import type { OrderPaStatus } from "@/hooks/use-clinical-api";
import { useOrderQuestionnaireResponses } from "@/hooks/use-clinical-api";
import {
  hasDtrDoc,
  parseCoverageInfoFromResource,
} from "@/lib/coverage-extensions";
import type { OrderEntry } from "@/lib/order-types";
import {
  derivePipelineStatus,
  type PipelineStatus,
} from "@/lib/pipeline-status";
import { isTerminalQrStatus } from "@/lib/qr-status";

export function deriveDtrStatus(
  qrBundle: Bundle<QuestionnaireResponse> | undefined,
): "none" | "in-progress" | "completed" {
  const entries = qrBundle?.entry ?? [];
  if (entries.some((e) => isTerminalQrStatus(e.resource?.status)))
    return "completed";
  if (entries.some((e) => e.resource?.status === "in-progress"))
    return "in-progress";
  return "none";
}

export function usePipelineStatus(
  order: OrderEntry,
  patientId: string,
  paStatus: OrderPaStatus | undefined,
): PipelineStatus {
  const resource = order.resource as DomainResource;
  const coverageInfo = parseCoverageInfoFromResource(resource);
  const orderId = (order.resource as Resource).id;
  const orderRef = orderId ? `${order.resourceType}/${orderId}` : undefined;
  const needsDoc = coverageInfo.some(hasDtrDoc);

  const { data: qrBundle } = useOrderQuestionnaireResponses(
    needsDoc ? orderRef : undefined,
    needsDoc ? patientId : undefined,
  );
  const dtrStatus = needsDoc ? deriveDtrStatus(qrBundle) : ("none" as const);

  return derivePipelineStatus(coverageInfo, dtrStatus, paStatus);
}
