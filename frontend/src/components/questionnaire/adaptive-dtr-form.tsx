import type {
  FhirResource,
  Questionnaire,
  QuestionnaireResponse,
} from "fhir/r4";
import { ArrowRight, CheckCircle, Code, Loader2, Save } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { JsonViewerDialog } from "@/components/json-viewer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNextQuestion } from "@/hooks/use-questionnaire";
import {
  alignChoiceAnswers,
  coerceDateAnswers,
  inlineValueSets,
} from "@/lib/dtr-ingestion";
import {
  type AnswerSnapshot,
  buildOriginIndex,
  fillUnansweredFromPopulate,
  restoreOrigins,
} from "@/lib/information-origin";
import { isTerminalQrStatus } from "@/lib/qr-status";
import {
  LhcFormRenderer,
  type LhcFormRendererHandle,
} from "./lhc-form-renderer";

const SDC_ADAPTIVE_QR_PROFILE =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaireresponse-adapt";

/** Local id for the contained Questionnaire when the payer's has none. */
const ADAPTIVE_CONTAINED_Q_ID = "adaptive-questionnaire";

/**
 * Contained resources the payer returns alongside the adaptive Questionnaire
 * (ValueSets, Libraries). An OperationOutcome describes a single exchange,
 * not the form, so it is not kept.
 */
function siblingResources(qr?: QuestionnaireResponse): FhirResource[] {
  return (qr?.contained ?? []).filter(
    (r) =>
      r.resourceType !== "Questionnaire" &&
      r.resourceType !== "OperationOutcome",
  );
}

/** Merges by id; an incoming resource replaces an existing one with the same id. */
function mergeById(
  existing: FhirResource[],
  incoming: FhirResource[],
): FhirResource[] {
  const merged = [...existing];
  for (const r of incoming) {
    const idx = r.id ? merged.findIndex((m) => m.id === r.id) : -1;
    if (idx >= 0) merged[idx] = r;
    else merged.push(r);
  }
  return merged;
}

interface AdaptiveDtrFormProps {
  questionnaire: Questionnaire;
  prepopulated?: QuestionnaireResponse;
  originIndex?: Map<string, AnswerSnapshot[]>;
  onSave: (
    response: QuestionnaireResponse,
    status: "in-progress" | "completed",
  ) => void;
  isSaving?: boolean;
  payerFhirUrl: string;
  /** When true, renders the form non-editable and hides the action buttons. */
  readOnly?: boolean;
  /**
   * When false, hides the "Save Draft" button so the only save path is
   * "Complete". Used when editing a terminal (completed/amended) QR, where
   * regressing to in-progress is not a valid FHIR transition.
   */
  allowInProgressSave?: boolean;
  /**
   * Populates a Questionnaire revision returned by $next-question, given the
   * revision and the payer's contained support resources (Libraries,
   * ValueSets). Resolves to the populated QR, or null when populate is not
   * available. Without it, new items carry only what the payer answered.
   */
  populate?: (
    questionnaire: Questionnaire,
    resources: FhirResource[],
  ) => Promise<QuestionnaireResponse | null>;
}

/** Answer options inlined so populated choice answers align with them. */
function resolveForRender(
  questionnaire: Questionnaire,
  siblings: FhirResource[],
): Questionnaire {
  return inlineValueSets(
    questionnaire,
    [],
    [...(questionnaire.contained ?? []), ...siblings],
  );
}

/**
 * Orchestrates the SDC adaptive questionnaire loop.
 *
 * Renders the current set of items via LhcFormRenderer, provides a
 * "Continue" button that calls Questionnaire/$next-question to fetch
 * additional items from the payer, and re-renders the form with the
 * growing item set until the payer marks the QR as completed.
 */
export function AdaptiveDtrForm({
  questionnaire,
  prepopulated,
  originIndex,
  onSave,
  isSaving = false,
  payerFhirUrl,
  readOnly = false,
  allowInProgressSave = true,
  populate,
}: AdaptiveDtrFormProps) {
  const formRef = useRef<LhcFormRendererHandle>(null);
  const nextQuestion = useNextQuestion(payerFhirUrl);

  // When resuming a saved adaptive QR, use the contained Questionnaire
  // (which has all accumulated items) instead of the original minimal one
  const resumedQ = prepopulated?.contained?.find(
    (r) => r.resourceType === "Questionnaire",
  ) as Questionnaire | undefined;

  const [currentQuestionnaire, setCurrentQuestionnaire] =
    useState<Questionnaire>(resumedQ ?? questionnaire);
  const [currentQr, setCurrentQr] = useState<QuestionnaireResponse | undefined>(
    prepopulated,
  );
  // Kept locally, not echoed to $next-question; written back only on save so
  // the stored QR stays self-contained and can be resumed.
  const [siblings, setSiblings] = useState<FhirResource[]>(() =>
    siblingResources(prepopulated),
  );
  const [isCompleted, setIsCompleted] = useState(
    isTerminalQrStatus(prepopulated?.status),
  );
  // Origins for the answers rendered after a $next-question round. The
  // prop index only describes the launch-time QR, so answers that arrive in
  // later rounds would otherwise be stamped manual on extraction.
  const [roundOriginIndex, setRoundOriginIndex] = useState<Map<
    string,
    AnswerSnapshot[]
  > | null>(null);
  const [isPopulating, setIsPopulating] = useState(false);
  // Incrementing key forces LhcFormRenderer to fully re-mount with new items
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [viewingResponse, setViewingResponse] =
    useState<QuestionnaireResponse | null>(null);

  const handleViewResponse = useCallback(() => {
    const qr = formRef.current?.extractQr("in-progress");
    if (qr) setViewingResponse(qr);
    else if (currentQr) setViewingResponse(currentQr);
  }, [currentQr]);

  const handleContinue = useCallback(async () => {
    setError(null);
    const extracted = formRef.current?.extractQr("in-progress");
    if (!extracted) return;

    // Build the $next-question request per SDC/DTR spec:
    // include the Questionnaire as a contained resource with derivedFrom
    // pointing to the original questionnaire's canonical URL
    const containedQ: Questionnaire = {
      ...currentQuestionnaire,
      derivedFrom:
        currentQuestionnaire.derivedFrom ??
        (questionnaire.url ? [questionnaire.url] : undefined),
    };
    const requestQr: QuestionnaireResponse = {
      ...extracted,
      status: "in-progress",
      meta: {
        ...extracted.meta,
        profile: [SDC_ADAPTIVE_QR_PROFILE],
      },
      contained: [containedQ as FhirResource],
      questionnaire: `#${containedQ.id}`,
    };

    try {
      const result = await nextQuestion.mutateAsync(requestQr);

      // Extract the updated Questionnaire from contained resources
      const updatedQ = result.contained?.find(
        (r) => r.resourceType === "Questionnaire",
      ) as Questionnaire | undefined;

      const nextQ = updatedQ ?? currentQuestionnaire;
      const nextSiblings = mergeById(siblings, siblingResources(result));

      // Payers need not echo information-origin. An answer that comes back
      // unchanged keeps the origin it was sent with; anything else the
      // payer supplied.
      let nextQr = restoreOrigins(result, extracted, "auto-server");

      // Populate the revision so new items with initialExpression or CQL
      // get answers. Only unanswered items are filled.
      if (populate) {
        setIsPopulating(true);
        try {
          const populated = await populate(nextQ, [
            ...(nextQ.contained ?? []),
            ...nextSiblings,
          ]);
          if (populated) {
            const forRender = resolveForRender(nextQ, nextSiblings);
            nextQr = fillUnansweredFromPopulate(
              nextQr,
              coerceDateAnswers(
                alignChoiceAnswers(populated, forRender),
                forRender,
              ),
            );
          }
        } catch (populateErr) {
          console.warn("[adaptive] populate failed:", populateErr);
        } finally {
          setIsPopulating(false);
        }
      }

      if (updatedQ) {
        setCurrentQuestionnaire(updatedQ);
      }
      setSiblings(nextSiblings);
      setCurrentQr(nextQr);
      setRoundOriginIndex(buildOriginIndex(nextQr));
      setRound((r) => r + 1);

      if (isTerminalQrStatus(result.status)) {
        setIsCompleted(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get next question",
      );
    }
  }, [
    currentQuestionnaire,
    nextQuestion,
    questionnaire.url,
    siblings,
    populate,
  ]);

  // Re-inject the contained Questionnaire into the QR before saving so that
  // future resume can extract it and render the full accumulated item set.
  // derivedFrom carries the original canonical, which is how the saved QR
  // is matched back to its questionnaire (see qrCanonical).
  const prepareForSave = useCallback(
    (qr: QuestionnaireResponse): QuestionnaireResponse => {
      const containedQ: Questionnaire = {
        ...currentQuestionnaire,
        id: currentQuestionnaire.id ?? ADAPTIVE_CONTAINED_Q_ID,
        derivedFrom:
          currentQuestionnaire.derivedFrom ??
          (questionnaire.url ? [questionnaire.url] : undefined),
      };
      const profiles = qr.meta?.profile ?? [];
      return {
        ...qr,
        meta: {
          ...qr.meta,
          profile: profiles.includes(SDC_ADAPTIVE_QR_PROFILE)
            ? profiles
            : [...profiles, SDC_ADAPTIVE_QR_PROFILE],
        },
        contained: [containedQ as FhirResource, ...siblings],
        questionnaire: `#${containedQ.id}`,
      };
    },
    [currentQuestionnaire, questionnaire.url, siblings],
  );

  // Resolve answerValueSet against the payer's contained ValueSets for
  // rendering only; currentQuestionnaire stays as the payer authored it.
  const renderQuestionnaire = useMemo(
    () => resolveForRender(currentQuestionnaire, siblings),
    [currentQuestionnaire, siblings],
  );

  const handleSaveDraft = useCallback(() => {
    const qr = formRef.current?.extractQr("in-progress");
    if (qr) onSave(prepareForSave(qr), "in-progress");
  }, [onSave, prepareForSave]);

  const handleSaveCompleted = useCallback(() => {
    const qr = formRef.current?.extractQr("completed");
    if (qr) onSave(prepareForSave(qr), "completed");
  }, [onSave, prepareForSave]);

  const isAdvancing = nextQuestion.isPending || isPopulating;

  // Adaptive forms don't use onSave from LhcFormRenderer since we control the footer
  const noop = useCallback(() => {}, []);

  // Strip contained resources and internal questionnaire ref before passing
  // to LHC-Forms -- it only needs the .item answers for merging
  const renderQr = useMemo(() => {
    if (!currentQr) return undefined;
    const { contained, questionnaire: _qRef, ...rest } = currentQr;
    return rest as QuestionnaireResponse;
  }, [currentQr]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <LhcFormRenderer
          ref={formRef}
          key={round}
          questionnaire={renderQuestionnaire}
          prepopulated={renderQr}
          originIndex={roundOriginIndex ?? originIndex}
          onSave={noop}
          hideFooter
          readOnly={readOnly}
        />
      </div>

      <div className="shrink-0 border-t pt-4 space-y-3">
        {!readOnly && (
          <>
            {/* Adaptive progress indicator */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="secondary" className="text-xs">
                Adaptive
              </Badge>
              {isCompleted ? (
                <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                  <CheckCircle className="h-3.5 w-3.5" />
                  All questions answered
                </span>
              ) : (
                <span>
                  Round {round + 1} - answer the questions above and click
                  Continue
                </span>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </>
        )}

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

          {!readOnly && (
            <div className="flex gap-2">
              {allowInProgressSave && (
                <Button
                  variant="outline"
                  onClick={handleSaveDraft}
                  disabled={isSaving}
                >
                  <Save className="h-4 w-4 mr-1.5" />
                  Save Draft
                </Button>
              )}

              {!isCompleted ? (
                <Button onClick={handleContinue} disabled={isAdvancing}>
                  {isAdvancing ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <ArrowRight className="h-4 w-4 mr-1.5" />
                  )}
                  {isAdvancing ? "Loading..." : "Continue"}
                </Button>
              ) : (
                <Button onClick={handleSaveCompleted} disabled={isSaving}>
                  <CheckCircle className="h-4 w-4 mr-1.5" />
                  {isSaving ? "Saving..." : "Complete"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {viewingResponse && (
        <JsonViewerDialog
          data={viewingResponse}
          title="QuestionnaireResponse"
          description="Current adaptive response state"
          onClose={() => setViewingResponse(null)}
        />
      )}
    </div>
  );
}
