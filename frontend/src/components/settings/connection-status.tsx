import { CheckCircle, Loader2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ConnectionStatusProps {
  isLoading: boolean;
  isConnected: boolean;
  latency?: number;
  error: Error | null;
  onTest: () => void;
  url: string;
  secondaryUrl?: string;
}

export function ConnectionStatus({
  isLoading,
  isConnected,
  latency,
  error,
  onTest,
  url,
  secondaryUrl,
}: ConnectionStatusProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between p-2.5 rounded-md border bg-muted/50">
        <div className="flex items-center gap-2">
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin text-warning" />
              <span className="text-sm">Connecting...</span>
            </>
          ) : isConnected ? (
            <>
              <CheckCircle className="h-4 w-4 text-success" />
              <span className="text-sm text-success">Connected</span>
              {latency && (
                <span className="text-xs text-muted-foreground">
                  ({latency}ms)
                </span>
              )}
            </>
          ) : (
            <>
              <XCircle className="h-4 w-4 text-destructive" />
              <span className="text-sm text-destructive">Disconnected</span>
            </>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onTest()}
          disabled={isLoading}
        >
          Test
        </Button>
      </div>

      {!isConnected && !isLoading && error && (
        <p className="text-xs text-destructive">
          {error instanceof Error
            ? error.message
            : "Failed to connect to server"}
        </p>
      )}

      <div className="text-xs text-muted-foreground space-y-0.5">
        {secondaryUrl && (
          <div>
            <span className="font-medium">CDS:</span>{" "}
            <code className="bg-muted px-1 py-0.5 rounded text-xs break-all">
              {secondaryUrl}
            </code>
          </div>
        )}
        <div>
          <span className="font-medium">{secondaryUrl ? "FHIR" : "URL"}:</span>{" "}
          <code className="bg-muted px-1 py-0.5 rounded text-xs break-all">
            {url}
          </code>
        </div>
      </div>
    </div>
  );
}
