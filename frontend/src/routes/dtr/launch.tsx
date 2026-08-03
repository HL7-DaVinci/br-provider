import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { startExternalDtrLaunch } from "@/lib/dtr-launch";

interface DtrLaunchSearch {
  iss: string;
  launch: string;
}

export const Route = createFileRoute("/dtr/launch")({
  validateSearch: (search: Record<string, unknown>): DtrLaunchSearch => ({
    iss: (search.iss as string) ?? "",
    launch: (search.launch as string) ?? "",
  }),
  component: DtrLaunchPage,
});

/**
 * SMART EHR launch handler for DTR.
 * Receives iss (FHIR server URL) and launch (launch token) search params,
 * exchanges the launch token for an authorize URL, and redirects the window
 * into the SMART OAuth2 flow. The callback route resumes into /dtr.
 */
function DtrLaunchPage() {
  const { iss, launch } = Route.useSearch();
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Prevents StrictMode double-mount from consuming the one-time launch token
  // twice. React preserves refs across the development remount cycle, so the
  // second mount sees fetchedRef.current === true and skips the fetch.
  const fetchedRef = useRef(false);

  const loadLaunchContext = useCallback(async () => {
    if (!iss || !launch) {
      setError("Missing required launch parameters (iss and launch).");
      setIsLoading(false);
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setError(null);
    setIsLoading(true);

    try {
      const authorizeUrl = await startExternalDtrLaunch(iss, launch);
      // Leaves isLoading true: window.location.assign is a full-page
      // navigation, and flipping isLoading here would flash the "Launch
      // Failed" fallback for the round-trip before the browser leaves.
      window.location.assign(authorizeUrl);
    } catch (err) {
      fetchedRef.current = false;
      setIsLoading(false);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to launch the DTR application.",
      );
    }
  }, [iss, launch]);

  useEffect(() => {
    void loadLaunchContext();
  }, [loadLaunchContext]);

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-lg font-semibold">Launch Failed</h1>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex justify-center">
            <Button onClick={() => void loadLaunchContext()}>
              Try Launch Again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
          <h1 className="text-lg font-semibold">Launch Failed</h1>
          <p className="text-sm text-muted-foreground">
            Unable to start the DTR application.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Launching DTR application...
        </p>
      </div>
    </div>
  );
}
