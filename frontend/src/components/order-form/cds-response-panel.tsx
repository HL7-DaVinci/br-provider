import { Link } from "@tanstack/react-router";
import {
  AlertCircle,
  Clock,
  Code,
  FileText,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDtrQuestionnaireResponseIds } from "@/hooks/use-dtr-qr-store";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { useOrderContext } from "@/hooks/use-order-context";
import { CdsCard } from "./cds-card";
import { CoverageDetermination } from "./coverage-determination";

export function CdsResponsePanel() {
  const { state } = useOrderContext();
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const {
    coverageInfo,
    cdsCards,
    lastHookName,
    lastRawResponse,
    isHookLoading,
    hookError,
  } = state;
  const { viewerData, openViewer, closeViewer } = useJsonViewer();
  const [isLaunching, setIsLaunching] = useState(false);

  const hasCoverageInfo = coverageInfo.length > 0;
  const hasCards = cdsCards.length > 0;
  const primaryOrderId = state.savedOrderIds[0] ?? null;
  const primaryOrderType =
    state.selectedOrders[0]?.template.resourceType ?? "ServiceRequest";
  const primaryOrderRef = primaryOrderId
    ? `${primaryOrderType}/${primaryOrderId}`
    : undefined;
  const questionnaireResponseIds =
    useDtrQuestionnaireResponseIds(primaryOrderRef);

  const needsDocs = coverageInfo.some(
    (info) => info.docNeeded && info.docNeeded !== "no-doc",
  );
  const needsAuth = coverageInfo.some(
    (info) => info.paNeeded === "auth-needed",
  );

  // Build fhirContext references from coverage info and saved orders for the SMART launch
  const fhirContextRefs = useMemo(
    () => [
      ...coverageInfo
        .filter((info) => info.coverage)
        .map((info) => info.coverage as string),
      ...state.savedOrderIds
        .filter((id) => !id.startsWith("draft-"))
        .map((id, i) => {
          const resourceType =
            state.selectedOrders[i]?.template.resourceType ?? "ServiceRequest";
          return `${resourceType}/${id}`;
        }),
    ],
    [coverageInfo, state.savedOrderIds, state.selectedOrders],
  );

  const handleDtrLaunch = useCallback(async () => {
    setIsLaunching(true);
    try {
      const response = await fetch("/api/smart/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patientId: state.patientId,
          encounterId: state.encounter?.id ?? null,
          fhirContext: fhirContextRefs,
          coverageAssertionId: coverageInfo[0]?.coverageAssertionId ?? null,
          questionnaire: coverageInfo[0]?.questionnaire ?? null,
          providerFhirUrl,
        }),
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error("Failed to create SMART launch context");
      }

      const { launchUrl } = await response.json();
      window.open(
        new URL(launchUrl, window.location.origin).toString(),
        "_blank",
        "noopener",
      );
    } catch (err) {
      console.error("DTR launch failed:", err);
    } finally {
      setIsLaunching(false);
    }
  }, [
    state.patientId,
    state.encounter?.id,
    fhirContextRefs,
    coverageInfo,
    providerFhirUrl,
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          CDS Response
          {lastHookName && (
            <Badge variant="outline" className="ml-2 text-xs font-mono">
              {lastHookName}
            </Badge>
          )}
        </h3>
        {lastRawResponse && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              openViewer(
                lastRawResponse,
                `CDS Response: ${lastHookName}`,
                "Raw JSON response from the CDS service",
              )
            }
          >
            <Code className="h-3.5 w-3.5 mr-1" />
            View Raw
          </Button>
        )}
      </div>

      {/* Error display */}
      {hookError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p>{hookError.message}</p>
          </div>
        </div>
      )}

      {/* Coverage Information */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            Coverage Information
            {hasCoverageInfo && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {coverageInfo.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isHookLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-3.5 w-3.5 animate-spin" />
              Checking coverage...
            </div>
          ) : hasCoverageInfo ? (
            <CoverageDetermination coverageInfo={coverageInfo} />
          ) : hookError ? (
            <p className="text-sm text-muted-foreground">
              No coverage data (CDS hook returned an error)
            </p>
          ) : lastHookName ? (
            <p className="text-sm text-muted-foreground">
              No coverage requirements indicated
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Waiting for CDS response...
            </p>
          )}
        </CardContent>
      </Card>

      {/* CDS Cards */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            Cards
            {lastHookName && (
              <span className="text-xs font-normal text-muted-foreground">
                ({lastHookName})
              </span>
            )}
            {hasCards && (
              <Badge variant="secondary" className="ml-auto text-xs">
                {cdsCards.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hasCards ? (
            <div className="space-y-2">
              {cdsCards.map((card) => (
                <CdsCard key={card.uuid ?? card.summary} card={card} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">(none)</p>
          )}
        </CardContent>
      </Card>

      {/* Workflow Action Buttons */}
      <div className="space-y-2">
        <Button
          variant="outline"
          className="w-full"
          disabled={!needsDocs || isLaunching}
          onClick={handleDtrLaunch}
        >
          {isLaunching ? (
            <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <FileText className="h-4 w-4 mr-1.5" />
          )}
          {isLaunching ? "Launching..." : "Complete Documentation"}
        </Button>
        <PasButton
          patientId={state.patientId}
          savedOrderId={primaryOrderId}
          orderType={primaryOrderType}
          coverageInfo={coverageInfo}
          questionnaireResponseIds={questionnaireResponseIds}
          needsAuth={needsAuth}
        />
      </div>

      {viewerData && (
        <JsonViewerDialog
          data={viewerData.data}
          title={viewerData.title}
          description={viewerData.description}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}

/**
 * "Submit Prior Auth" button that navigates to the PAS review page.
 * Disabled when auth is not needed or the order has not been saved yet.
 */
function PasButton({
  patientId,
  savedOrderId,
  orderType,
  coverageInfo,
  questionnaireResponseIds,
  needsAuth,
}: {
  patientId: string;
  savedOrderId: string | null;
  orderType: string;
  coverageInfo: { coverage?: string }[];
  questionnaireResponseIds: string[];
  needsAuth: boolean;
}) {
  const isEnabled = needsAuth && !!savedOrderId;

  // Extract coverage ID from the first coverage info reference (e.g. "Coverage/123")
  const coverageRef = coverageInfo.find((ci) => ci.coverage)?.coverage;
  const coverageId = coverageRef?.replace(/^Coverage\//, "") ?? "";

  if (!isEnabled) {
    return (
      <Button variant="outline" className="w-full" disabled>
        <ShieldCheck className="h-4 w-4 mr-1.5" />
        Submit Prior Auth
      </Button>
    );
  }

  return (
    <Link
      to="/patients/$patientId/orders/$orderId/pas"
      params={{ patientId, orderId: savedOrderId }}
      search={{
        coverageId,
        orderType,
        qrIds:
          questionnaireResponseIds.length > 0
            ? questionnaireResponseIds.join(",")
            : undefined,
      }}
    >
      <Button variant="outline" className="w-full">
        <ShieldCheck className="h-4 w-4 mr-1.5" />
        Submit Prior Auth
      </Button>
    </Link>
  );
}
