import { AlertCircle, Code } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { CdsCard } from "@/components/order-form/cds-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { useOrderContext } from "@/hooks/use-order-context";
import { launchSmartApp } from "@/lib/api";
import type {
  CdsCard as CdsCardType,
  CdsLink,
  CdsSuggestion,
} from "@/lib/cds-types";

export function CdsResponsePanel() {
  const { state, dispatch } = useOrderContext();
  const {
    lastHookName,
    lastRawResponse,
    isHookLoading,
    hookError,
    cdsCards,
    appliedSuggestions,
  } = state;
  const { viewerData, openViewer, closeViewer } = useJsonViewer();
  const { serverUrl } = useFhirServer();
  const hasCards = cdsCards.length > 0;

  const handleApplySuggestion = useCallback(
    (card: CdsCardType, suggestion: CdsSuggestion) => {
      const suggestionId = suggestion.uuid ?? suggestion.label;
      const siblingIds =
        card.selectionBehavior === "at-most-one"
          ? (card.suggestions ?? [])
              .filter((sib) => sib !== suggestion)
              .map((sib) => sib.uuid ?? sib.label)
          : [];

      dispatch({
        type: "APPLY_SUGGESTION",
        payload: {
          cardId: card.uuid ?? card.summary,
          suggestionId,
          actions: suggestion.actions ?? [],
          disableIds: siblingIds,
        },
      });
    },
    [dispatch],
  );

  const handleSmartLaunch = useCallback(
    async (link: CdsLink) => {
      const rawAppContext =
        typeof link.appContext === "string" ? link.appContext : undefined;

      // Best-effort JSON parsing for known fields; do not require JSON.
      let parsedContext: Record<string, unknown> | null = null;
      if (rawAppContext?.trim().startsWith("{")) {
        try {
          parsedContext = JSON.parse(rawAppContext) as Record<string, unknown>;
        } catch {
          parsedContext = null;
        }
      }

      const fhirContext: string[] = [];
      if (typeof parsedContext?.coverageRef === "string") {
        fhirContext.push(parsedContext.coverageRef);
      }
      if (typeof parsedContext?.orderRef === "string") {
        fhirContext.push(parsedContext.orderRef);
      }

      try {
        await launchSmartApp({
          patientId: state.patientId,
          encounterId: state.encounter?.id,
          fhirContext,
          coverageAssertionId:
            typeof parsedContext?.coverageAssertionId === "string"
              ? parsedContext.coverageAssertionId
              : undefined,
          questionnaire: Array.isArray(parsedContext?.questionnaire)
            ? parsedContext.questionnaire
            : [],
          providerFhirUrl: serverUrl,
          appContext: rawAppContext,
        });
      } catch (err) {
        console.error("SMART launch failed:", err);
        toast.error("Failed to launch SMART app");
      }
    },
    [state.patientId, state.encounter?.id, serverUrl],
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            CDS Response
            {lastHookName && (
              <Badge variant="outline" className="ml-2 text-xs font-mono">
                {lastHookName}
              </Badge>
            )}
            {isHookLoading && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Loading...
              </span>
            )}
          </CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-3">
        {hookError && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
            <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <p>{hookError.message}</p>
            </div>
          </div>
        )}

        {hasCards ? (
          <div className="space-y-2">
            {cdsCards.map((card) => (
              <CdsCard
                key={card.uuid ?? card.summary}
                card={card}
                onApplySuggestion={(suggestion) =>
                  handleApplySuggestion(card, suggestion)
                }
                onSmartLaunch={handleSmartLaunch}
                appliedSuggestions={appliedSuggestions}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isHookLoading
              ? "Checking..."
              : lastHookName
                ? "No cards returned"
                : "No CDS hooks fired"}
          </p>
        )}
      </CardContent>

      {viewerData && (
        <JsonViewerDialog
          data={viewerData.data}
          title={viewerData.title}
          description={viewerData.description}
          onClose={closeViewer}
        />
      )}
    </Card>
  );
}
