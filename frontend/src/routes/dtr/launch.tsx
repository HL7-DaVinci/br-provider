import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AlertCircle, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { serializeQuestionnaireSearch } from "@/lib/dtr-search";

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
 * Receives iss (FHIR server URL) and launch (launch token) search params.
 *
 * For this reference implementation, instead of the full SMART OAuth2 flow,
 * we consume the launch token to load context and navigate to the DTR form.
 */
function DtrLaunchPage() {
  const { iss, launch } = Route.useSearch();
  const navigate = useNavigate();
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
      const response = await fetch(
        `/api/smart/context?launch=${encodeURIComponent(launch)}`,
        {
          credentials: "same-origin",
        },
      );

      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? "This SMART launch token is invalid, expired, or has already been used."
            : `Failed to load SMART launch context (${response.status}).`,
        );
      }

      const context = await response.json();
      navigate({
        to: "/dtr",
        search: {
          iss,
          patientId: context.patientId ?? "",
          encounterId: context.encounterId ?? "",
          fhirContext: context.fhirContext?.join(",") ?? "",
          coverageAssertionId: context.coverageAssertionId ?? undefined,
          questionnaire: serializeQuestionnaireSearch(context.questionnaire),
        },
      });
    } catch (err) {
      fetchedRef.current = false;
      setError(
        err instanceof Error
          ? err.message
          : "Failed to launch the DTR application.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [iss, launch, navigate]);

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
