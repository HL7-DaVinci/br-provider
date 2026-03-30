import { Link } from "@tanstack/react-router";
import type { DomainResource, Resource } from "fhir/r4";
import { CheckCircle, FileText, ShieldCheck } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { useOrderQuestionnaireResponses } from "@/hooks/use-clinical-api";
import { useDtrQuestionnaireResponseIds } from "@/hooks/use-dtr-qr-store";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { deriveDtrStatus } from "@/hooks/use-pipeline-status";
import { launchSmartApp } from "@/lib/api";
import {
  hasDtrDoc,
  parseCoverageInfoFromResource,
} from "@/lib/coverage-extensions";
import type { OrderEntry } from "@/lib/order-types";

interface OrderActionProps {
  order: OrderEntry;
  patientId: string;
  encounterId?: string;
}

/** DTR launch/resume/view button for an order. Renders nothing if no documentation is needed. */
export function DtrAction({ order, patientId, encounterId }: OrderActionProps) {
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const [isLaunching, setIsLaunching] = useState(false);

  const resource = order.resource as DomainResource;
  const coverageInfo = parseCoverageInfoFromResource(resource);

  const orderId = (order.resource as Resource).id;
  const orderRef = orderId ? `${order.resourceType}/${orderId}` : undefined;
  const needsDoc = coverageInfo.some(hasDtrDoc);

  const { data: existingQrBundle } = useOrderQuestionnaireResponses(
    needsDoc ? orderRef : undefined,
    needsDoc ? patientId : undefined,
  );

  const qrEntries = existingQrBundle?.entry ?? [];
  const completedQrs = qrEntries.filter(
    (e) => e.resource?.status === "completed",
  );
  const inProgressQrs = qrEntries.filter(
    (e) => e.resource?.status === "in-progress",
  );

  const dtrStatus = deriveDtrStatus(existingQrBundle);
  const dtrLabel =
    dtrStatus === "completed"
      ? "View DTR"
      : dtrStatus === "in-progress"
        ? "Resume DTR"
        : "Launch DTR";

  const handleDtrLaunch = useCallback(async () => {
    const ci = coverageInfo.find(hasDtrDoc);
    if (!ci || !orderId) return;

    setIsLaunching(true);
    try {
      const resumeQrId =
        inProgressQrs[0]?.resource?.id ?? completedQrs[0]?.resource?.id;

      const fhirContext = [
        ci.coverage,
        `${order.resourceType}/${orderId}`,
        ...(resumeQrId ? [`QuestionnaireResponse/${resumeQrId}`] : []),
      ].filter(Boolean);

      await launchSmartApp({
        patientId,
        encounterId: encounterId ?? null,
        fhirContext,
        coverageAssertionId: ci.coverageAssertionId ?? null,
        questionnaire: ci.questionnaire ?? [],
        providerFhirUrl,
      });
    } catch (err) {
      console.error("DTR launch failed:", err);
    } finally {
      setIsLaunching(false);
    }
  }, [
    coverageInfo,
    orderId,
    order.resourceType,
    patientId,
    encounterId,
    providerFhirUrl,
    inProgressQrs,
    completedQrs,
  ]);

  if (!needsDoc) return null;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isLaunching}
      onClick={handleDtrLaunch}
    >
      {dtrStatus === "completed" ? (
        <CheckCircle className="h-3 w-3 mr-1" />
      ) : (
        <FileText className="h-3 w-3 mr-1" />
      )}
      {dtrLabel}
    </Button>
  );
}

/** PA submit link for an order. Renders nothing if no prior auth is needed. */
export function PaAction({
  order,
  patientId,
}: Omit<OrderActionProps, "encounterId">) {
  const resource = order.resource as DomainResource;
  const coverageInfo = parseCoverageInfoFromResource(resource);

  const orderId = (order.resource as Resource).id;
  const orderRef = orderId ? `${order.resourceType}/${orderId}` : undefined;
  const needsDoc = coverageInfo.some(hasDtrDoc);
  const needsAuth = coverageInfo.some((ci) => ci.paNeeded === "auth-needed");

  const { data: existingQrBundle } = useOrderQuestionnaireResponses(
    needsDoc ? orderRef : undefined,
    needsDoc ? patientId : undefined,
  );
  const localQrIds = useDtrQuestionnaireResponseIds(orderRef);

  const completedQrIds = (existingQrBundle?.entry ?? [])
    .filter((e) => e.resource?.status === "completed")
    .map((e) => e.resource?.id)
    .filter((id): id is string => !!id);
  const qrIdsForPas = completedQrIds.length > 0 ? completedQrIds : localQrIds;

  if (!needsAuth || !orderId) return null;

  const coverageRef = coverageInfo.find((ci) => ci.coverage)?.coverage;
  const coverageId = coverageRef?.replace(/^Coverage\//, "") ?? "";

  return (
    <Link
      to="/patients/$patientId/orders/$orderId/pas"
      params={{ patientId, orderId }}
      search={{
        coverageId,
        orderType: order.resourceType,
        ...(qrIdsForPas.length > 0 && {
          qrIds: qrIdsForPas.join(","),
        }),
      }}
    >
      <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
        <ShieldCheck className="h-3 w-3 mr-1" />
        Submit PA
      </Button>
    </Link>
  );
}
