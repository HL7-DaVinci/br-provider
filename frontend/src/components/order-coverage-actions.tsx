import { Link } from "@tanstack/react-router";
import type { DomainResource, Resource } from "fhir/r4";
import { Eye, FileText, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useDtrTaskSheet } from "@/components/dtr/use-dtr-task-sheet";
import { Button } from "@/components/ui/button";
import {
  useEncounterOrders,
  useOrderPaStatusMap,
  useOrderQuestionnaireResponses,
} from "@/hooks/use-clinical-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  aggregateOrderState,
  getOrderSatisfactionState,
  usePatientQrIndex,
} from "@/hooks/use-patient-qr-index";
import {
  findOrdersSharingCanonicals,
  hasDtrDoc,
  parseCoverageInfoFromResource,
} from "@/lib/coverage-extensions";
import {
  serializeOrderRefs,
  serializeQuestionnaireSearch,
} from "@/lib/dtr-search";
import type { OrderEntry } from "@/lib/order-types";
import { isTerminalQrStatus } from "@/lib/qr-status";

interface OrderActionProps {
  order: OrderEntry;
  patientId: string;
  encounterId?: string;
}

/** DTR launch/resume/view button for an order. Renders nothing if no documentation is needed. */
export function DtrAction({ order, patientId, encounterId }: OrderActionProps) {
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const [isLaunching, setIsLaunching] = useState(false);
  const openDtrTask = useDtrTaskSheet();

  const orderId = (order.resource as Resource).id;
  const orderRef = orderId ? `${order.resourceType}/${orderId}` : undefined;

  const qrIndex = usePatientQrIndex(patientId);

  const encounterOrdersQuery = useEncounterOrders(
    encounterId ?? "",
    encounterId ? patientId : "",
  );

  const orderCoverageInfos = useMemo(
    () => parseCoverageInfoFromResource(order.resource).filter(hasDtrDoc),
    [order],
  );

  const orderCanonicals = useMemo(() => {
    const seen = new Set<string>();
    for (const ci of orderCoverageInfos) {
      for (const canonical of ci.questionnaire ?? []) {
        seen.add(canonical);
      }
    }
    return Array.from(seen);
  }, [orderCoverageInfos]);

  const needsDoc = orderCanonicals.length > 0;

  const primaryCi = orderCoverageInfos[0];

  const canonicalStates = useMemo(() => {
    if (!orderRef) return [];
    return orderCanonicals.map((canonical) => ({
      canonical,
      state: getOrderSatisfactionState(qrIndex, canonical, orderRef),
    }));
  }, [orderCanonicals, qrIndex, orderRef]);

  const aggregateState = aggregateOrderState(
    canonicalStates.map((s) => s.state),
  );

  const relatedOrderRefs = useMemo(() => {
    if (!encounterId || !orderRef) return [];
    return findOrdersSharingCanonicals(
      encounterOrdersQuery.data ?? [],
      orderRef,
      orderCanonicals,
    );
  }, [encounterId, orderRef, encounterOrdersQuery.data, orderCanonicals]);

  const handleLaunch = useCallback(async () => {
    if (!orderRef || !primaryCi) return;
    setIsLaunching(true);
    try {
      const fhirContext = [primaryCi.coverage, orderRef].filter(
        (x): x is string => !!x,
      );

      // Resume hint: include the in-progress QR id only if one is linked to
      // this order via qr-context. Completed QRs are never seeded into populate.
      const firstInProgress = canonicalStates.find(
        (s) => s.state.kind === "inProgressForThisOrder",
      );
      if (firstInProgress?.state.kind === "inProgressForThisOrder") {
        fhirContext.push(
          `QuestionnaireResponse/${firstInProgress.state.qr.id}`,
        );
      }

      openDtrTask({
        iss: providerFhirUrl,
        patientId,
        encounterId,
        fhirContext: fhirContext.join(","),
        coverageAssertionId: primaryCi.coverageAssertionId,
        questionnaire: serializeQuestionnaireSearch(orderCanonicals),
        relatedOrderRefs: serializeOrderRefs(relatedOrderRefs),
      });
    } catch (err) {
      console.error("DTR launch failed:", err);
    } finally {
      setIsLaunching(false);
    }
  }, [
    orderRef,
    primaryCi,
    orderCanonicals,
    canonicalStates,
    providerFhirUrl,
    patientId,
    encounterId,
    openDtrTask,
    relatedOrderRefs,
  ]);

  if (!needsDoc) return null;

  const isCompleted = aggregateState.kind === "completedForThisOrder";
  const label = isCompleted
    ? "View"
    : aggregateState.kind === "inProgressForThisOrder"
      ? "Resume DTR"
      : "Launch DTR";
  const ActionIcon = isCompleted ? Eye : FileText;

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isLaunching}
      onClick={handleLaunch}
    >
      <ActionIcon className="h-3 w-3 mr-1" />
      {label}
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

  const paStatusMap = useOrderPaStatusMap(patientId);

  const { data: existingQrBundle } = useOrderQuestionnaireResponses(
    needsDoc ? orderRef : undefined,
    needsDoc ? patientId : undefined,
  );

  const completedQrIds = (existingQrBundle?.entry ?? [])
    .filter((e) => isTerminalQrStatus(e.resource?.status))
    .map((e) => e.resource?.id)
    .filter((id): id is string => !!id);
  const qrIdsForPas = completedQrIds;

  if (!orderId) return null;

  // A PA already exists for this order (pended or decided): link to the PAS view of the
  // prior submission instead of the "Submit PA" action, so it cannot be re-submitted on
  // top of the existing authorization.
  const existingPa = paStatusMap.get(`${order.resourceType}/${orderId}`);
  if (existingPa) {
    return (
      <Link
        to="/patients/$patientId/orders/$orderId/pas"
        params={{ patientId, orderId }}
        search={{
          orderType: order.resourceType,
          coverageId: existingPa.coverageId,
          claimResponseId: existingPa.claimResponseId || undefined,
        }}
      >
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs">
          <Eye className="h-3 w-3 mr-1" />
          View PA
        </Button>
      </Link>
    );
  }

  if (!needsAuth) return null;

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
