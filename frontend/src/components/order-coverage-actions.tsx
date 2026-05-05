import { Link } from "@tanstack/react-router";
import type { DomainResource, Extension, Resource } from "fhir/r4";
import { CheckCircle, FileText, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useDtrTaskSheet } from "@/components/dtr/use-dtr-task-sheet";
import { Button } from "@/components/ui/button";
import {
  useEncounterOrders,
  useOrderQuestionnaireResponses,
} from "@/hooks/use-clinical-api";
import { useDtrQuestionnaireResponseIds } from "@/hooks/use-dtr-qr-store";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  findReusableQr,
  usePatientQrIndex,
} from "@/hooks/use-patient-qr-index";
import {
  findOrdersSharingCanonicals,
  hasDtrDoc,
  parseCoverageInfoFromResource,
} from "@/lib/coverage-extensions";
import { propagateCoverageInfo } from "@/lib/coverage-propagation";
import {
  serializeOrderRefs,
  serializeQuestionnaireSearch,
} from "@/lib/dtr-search";
import type { OrderEntry } from "@/lib/order-types";
import { isTerminalQrStatus } from "@/lib/qr-status";

const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

interface OrderActionProps {
  order: OrderEntry;
  patientId: string;
  encounterId?: string;
}

/** DTR launch/resume/attach button for an order. Renders nothing if no documentation is needed. */
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

  const canonicalStates = useMemo(
    () =>
      orderCanonicals.map((canonical) => ({
        canonical,
        reusable: findReusableQr(qrIndex, canonical),
      })),
    [orderCanonicals, qrIndex],
  );

  const unsatisfiedCanonicals = useMemo(
    () => canonicalStates.filter((s) => !s.reusable).map((s) => s.canonical),
    [canonicalStates],
  );

  const allSatisfied =
    canonicalStates.length > 0 && unsatisfiedCanonicals.length === 0;

  const relatedOrderRefs = useMemo(() => {
    if (!encounterId || !orderRef) return [];
    return findOrdersSharingCanonicals(
      encounterOrdersQuery.data ?? [],
      orderRef,
      orderCanonicals,
    );
  }, [encounterId, orderRef, encounterOrdersQuery.data, orderCanonicals]);

  const sourceOrderRef = useMemo(() => {
    for (const state of canonicalStates) {
      if (!state.reusable) continue;
      const ref = findOtherOrderFromQr(state.reusable.extension, orderRef);
      if (ref) return ref;
    }
    return undefined;
  }, [canonicalStates, orderRef]);

  const handleClick = useCallback(async () => {
    if (!orderRef || !primaryCi) return;
    setIsLaunching(true);
    try {
      // Attach any reusable QRs' CoverageInformation extension to this order
      // before opening the workspace, so the order's coverage status reflects
      // the reused documentation even if the user never amends.
      if (providerFhirUrl) {
        for (const state of canonicalStates) {
          if (!state.reusable) continue;
          try {
            await propagateCoverageInfo({
              qr: state.reusable,
              orderRefs: [orderRef],
              providerFhirUrl,
            });
          } catch (err) {
            console.warn("Attach reusable QR coverage info failed:", err);
          }
        }
      }

      const fhirContext = [primaryCi.coverage, orderRef].filter(
        (x): x is string => !!x,
      );

      // Resume hint: prefer the first unsatisfied canonical's draft QR. If
      // everything is satisfied, the per-canonical lookup in the workspace
      // surfaces each tab's terminal QR for view/amend.
      const firstUnsatisfied = unsatisfiedCanonicals[0];
      const firstEntry = firstUnsatisfied
        ? qrIndex.byCanonical.get(firstUnsatisfied)
        : undefined;
      const resumeQrId =
        firstEntry?.inProgress[0]?.id ?? firstEntry?.completed[0]?.id;
      if (resumeQrId) {
        fhirContext.push(`QuestionnaireResponse/${resumeQrId}`);
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
    unsatisfiedCanonicals,
    canonicalStates,
    qrIndex.byCanonical,
    providerFhirUrl,
    patientId,
    encounterId,
    openDtrTask,
    relatedOrderRefs,
  ]);

  if (!needsDoc) return null;

  const hasInProgress = unsatisfiedCanonicals.some((canonical) => {
    const entry = qrIndex.byCanonical.get(canonical);
    return (entry?.inProgress.length ?? 0) > 0;
  });

  const label = allSatisfied
    ? `Documentation provided${sourceOrderRef ? ` (from ${sourceOrderRef})` : ""}`
    : hasInProgress
      ? "Resume DTR"
      : "Launch DTR";

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={isLaunching}
      onClick={handleClick}
    >
      {allSatisfied ? (
        <CheckCircle className="h-3 w-3 mr-1" />
      ) : (
        <FileText className="h-3 w-3 mr-1" />
      )}
      {label}
    </Button>
  );
}

/** Find an order ref from a QR's qr-context extensions that is not the current order. */
function findOtherOrderFromQr(
  extensions: Extension[] | undefined,
  selfOrderRef: string | undefined,
): string | undefined {
  if (!extensions) return undefined;
  for (const ext of extensions) {
    if (ext.url !== QR_CONTEXT_EXT_URL) continue;
    const ref = ext.valueReference?.reference;
    if (ref && ref !== selfOrderRef) return ref;
  }
  return undefined;
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
    .filter((e) => isTerminalQrStatus(e.resource?.status))
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
