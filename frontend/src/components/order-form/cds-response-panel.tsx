import { AlertCircle, Code } from "lucide-react";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { CdsCard } from "@/components/order-form/cds-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useOrderContext } from "@/hooks/use-order-context";

export function CdsResponsePanel() {
  const { state } = useOrderContext();
  const { lastHookName, lastRawResponse, isHookLoading, hookError, cdsCards } =
    state;
  const { viewerData, openViewer, closeViewer } = useJsonViewer();
  const hasCards = cdsCards.length > 0;

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
              <CdsCard key={card.uuid ?? card.summary} card={card} />
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
