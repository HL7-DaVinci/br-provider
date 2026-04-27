import { AlertCircle, Code } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { useDtrTaskSheet } from "@/components/dtr/use-dtr-task-sheet";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { CdsCard } from "@/components/order-form/cds-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFhirServer } from "@/hooks/use-fhir-server";
import type {
  CdsCard as CdsCardType,
  CdsHookResponse,
  CdsLink,
} from "@/lib/cds-types";
import { serializeQuestionnaireSearch } from "@/lib/dtr-search";

interface AppointmentCdsPanelProps {
  cards: CdsCardType[];
  isLoading: boolean;
  hookError: Error | null;
  patientId: string;
  rawResponse: CdsHookResponse | null;
}

export function AppointmentCdsPanel({
  cards,
  isLoading,
  hookError,
  patientId,
  rawResponse,
}: AppointmentCdsPanelProps) {
  const { serverUrl } = useFhirServer();
  const { viewerData, openViewer, closeViewer } = useJsonViewer();
  const openDtrTask = useDtrTaskSheet();

  const handleSmartLaunch = useCallback(
    (link: CdsLink) => {
      const rawAppContext =
        typeof link.appContext === "string" ? link.appContext : undefined;

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

      try {
        openDtrTask({
          iss: serverUrl,
          patientId,
          fhirContext: fhirContext.join(","),
          coverageAssertionId:
            typeof parsedContext?.coverageAssertionId === "string"
              ? parsedContext.coverageAssertionId
              : undefined,
          questionnaire: serializeQuestionnaireSearch(
            Array.isArray(parsedContext?.questionnaire)
              ? parsedContext.questionnaire
              : [],
          ),
          appContext: rawAppContext,
        });
      } catch (err) {
        console.error("SMART launch failed:", err);
        toast.error("Failed to launch SMART app");
      }
    },
    [patientId, serverUrl, openDtrTask],
  );

  const hasCards = cards.length > 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">
            Insurance Review
            {isLoading && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Loading...
              </span>
            )}
          </CardTitle>
          {rawResponse && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                openViewer(
                  rawResponse,
                  "CDS Response: appointment-book",
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
            {cards.map((card) => (
              <CdsCard
                key={card.uuid ?? card.summary}
                card={card}
                onSmartLaunch={handleSmartLaunch}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Checking coverage..."
              : rawResponse
                ? "No additional actions required by your insurer."
                : "Click Check Coverage to review insurance requirements."}
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
