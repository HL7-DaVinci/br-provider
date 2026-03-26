import type { Questionnaire, QuestionnaireResponse } from "fhir/r4";
import { AlertCircle, Code, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { JsonViewerDialog } from "@/components/json-viewer-dialog";
import { Button } from "@/components/ui/button";
import {
  type AnswerSnapshot,
  applyOriginTracking,
} from "@/lib/information-origin";
import { loadLhcForms } from "@/lib/lhc-forms-loader";

interface LhcFormRendererProps {
  questionnaire: Questionnaire;
  prepopulated?: QuestionnaireResponse;
  originIndex?: Map<string, AnswerSnapshot[]>;
  onSave: (
    response: QuestionnaireResponse,
    status: "in-progress" | "completed",
  ) => void;
  isSaving?: boolean;
}

/**
 * Renders a FHIR Questionnaire using NLM's LHC-Forms library.
 * Handles lazy script loading, pre-population from a QuestionnaireResponse,
 * and exports the completed response on save.
 */
export function LhcFormRenderer({
  questionnaire,
  prepopulated,
  originIndex,
  onSave,
  isSaving = false,
}: LhcFormRendererProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const formReadyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shouldPinActions, setShouldPinActions] = useState(false);
  const [viewingResponse, setViewingResponse] =
    useState<QuestionnaireResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        await loadLhcForms();
        if (cancelled || !containerRef.current) return;

        const { LForms } = window;

        let formDef = LForms.Util.convertFHIRQuestionnaireToLForms(
          questionnaire,
          "R4",
        );

        if (prepopulated) {
          formDef = LForms.Util.mergeFHIRDataIntoLForms(
            "QuestionnaireResponse",
            prepopulated,
            formDef,
            "R4",
          );
        }

        if (cancelled || !containerRef.current) return;

        try {
          await LForms.Util.addFormToPage(formDef, containerRef.current);
        } catch (formErr) {
          console.warn("LHC-Forms onError:", formErr);
        }

        if (!cancelled) {
          const hasForm =
            containerRef.current?.querySelector("wc-lhc-form") !== null;
          if (hasForm) {
            formReadyRef.current = true;
            setLoading(false);
          } else {
            setError("Failed to render questionnaire form");
            setLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load form");
          setLoading(false);
        }
      }
    }

    init();
    return () => {
      cancelled = true;
      if (containerRef.current) {
        while (containerRef.current.firstChild) {
          containerRef.current.removeChild(containerRef.current.firstChild);
        }
      }
    };
  }, [questionnaire, prepopulated]);

  /** Extracts the current QR from LHC-Forms and applies origin tracking. */
  const extractCurrentQr = useCallback(
    (status: "in-progress" | "completed"): QuestionnaireResponse | null => {
      if (!formReadyRef.current || !containerRef.current) return null;

      let qr = window.LForms.Util.getFormFHIRData(
        "QuestionnaireResponse",
        "R4",
        containerRef.current,
      ) as QuestionnaireResponse;

      if (originIndex?.size) {
        qr = applyOriginTracking(qr, originIndex);
      }

      qr.status = status;
      return qr;
    },
    [originIndex],
  );

  const handleSave = useCallback(
    (status: "in-progress" | "completed") => {
      const qr = extractCurrentQr(status);
      if (qr) onSave(qr, status);
    },
    [extractCurrentQr, onSave],
  );

  const handleViewResponse = useCallback(() => {
    const qr = extractCurrentQr("in-progress");
    if (qr) setViewingResponse(qr);
  }, [extractCurrentQr]);

  useEffect(() => {
    if (loading || error) {
      setShouldPinActions(false);
      return;
    }

    let frameId: number | null = null;

    const recalc = () => {
      if (
        !shellRef.current ||
        !headerRef.current ||
        !containerRef.current ||
        !footerRef.current
      ) {
        return;
      }

      const shellHeight = shellRef.current.clientHeight;
      const headerHeight = headerRef.current.offsetHeight;
      const footerHeight = footerRef.current.offsetHeight;
      const formHeight = containerRef.current.scrollHeight;

      setShouldPinActions(
        formHeight + headerHeight + footerHeight > shellHeight + 1,
      );
    };

    const scheduleRecalc = () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(recalc);
    };

    scheduleRecalc();

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(scheduleRecalc)
        : null;

    const shellEl = shellRef.current;
    const headerEl = headerRef.current;
    const containerEl = containerRef.current;
    const footerEl = footerRef.current;

    if (observer && shellEl && headerEl && containerEl && footerEl) {
      observer.observe(shellEl);
      observer.observe(headerEl);
      observer.observe(containerEl);
      observer.observe(footerEl);
    }
    window.addEventListener("resize", scheduleRecalc);

    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleRecalc);
    };
  }, [loading, error]);

  return (
    <div ref={shellRef} className="flex h-full min-h-0 flex-col">
      <div ref={headerRef} className="shrink-0 pb-4">
        <h2 className="text-lg font-semibold">
          {questionnaire.title ?? "Questionnaire"}
        </h2>
        {questionnaire.description && (
          <p className="text-sm text-muted-foreground mt-1">
            {questionnaire.description}
          </p>
        )}
      </div>

      <div
        className={shouldPinActions ? "relative min-h-0 flex-1" : "relative"}
      >
        <div
          className={`min-h-0 h-full ${
            loading || error
              ? "overflow-hidden"
              : shouldPinActions
                ? "overflow-y-auto pr-1"
                : ""
          }`}
        >
          <div
            ref={containerRef}
            className={`lhc-form-container pb-8 ${
              loading || error ? "pointer-events-none opacity-0" : ""
            }`}
            aria-hidden={loading || error ? true : undefined}
          />
        </div>

        {loading && !error && (
          <div className="absolute inset-0 flex items-center justify-center py-12">
            <div className="text-center space-y-3">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Loading form...</p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center py-12">
            <div className="max-w-md space-y-4 text-center">
              <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </div>
        )}
      </div>

      {!loading && !error && (
        <div
          ref={footerRef}
          className={`shrink-0 ${
            shouldPinActions
              ? "border-t border-border/60 bg-background/88 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-4 backdrop-blur supports-[backdrop-filter]:bg-background/72"
              : "pt-4"
          }`}
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleViewResponse}
              className="w-fit rounded-full border border-border/60 bg-muted/35 px-3 text-muted-foreground hover:border-border hover:bg-muted/60 hover:text-foreground"
            >
              <span className="flex size-6 items-center justify-center rounded-full bg-background/80">
                <Code className="h-3.5 w-3.5" />
              </span>
              View Response
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => handleSave("in-progress")}
                disabled={isSaving}
              >
                Save Draft
              </Button>
              <Button
                onClick={() => handleSave("completed")}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : "Complete"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {viewingResponse && (
        <JsonViewerDialog
          data={viewingResponse}
          title="QuestionnaireResponse"
          description="Current in-progress response state"
          onClose={() => setViewingResponse(null)}
        />
      )}
    </div>
  );
}
