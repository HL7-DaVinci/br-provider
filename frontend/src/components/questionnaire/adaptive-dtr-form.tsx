import type {
  FhirResource,
  Questionnaire,
  QuestionnaireResponse,
} from "fhir/r4";
import { ArrowRight, CheckCircle, Loader2, Save } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNextQuestion } from "@/hooks/use-questionnaire";
import type { AnswerSnapshot } from "@/lib/information-origin";
import {
  LhcFormRenderer,
  type LhcFormRendererHandle,
} from "./lhc-form-renderer";

const SDC_ADAPTIVE_QR_PROFILE =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaireresponse-adapt";

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
  const [isCompleted, setIsCompleted] = useState(
    prepopulated?.status === "completed",
  );
  // Incrementing key forces LhcFormRenderer to fully re-mount with new items
  const [round, setRound] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

      if (updatedQ) {
        setCurrentQuestionnaire(updatedQ);
      }

      setCurrentQr(result);
      setRound((r) => r + 1);

      if (result.status === "completed") {
        setIsCompleted(true);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get next question",
      );
    }
  }, [currentQuestionnaire, nextQuestion, questionnaire.url]);

  // Re-inject the contained Questionnaire into the QR before saving so that
  // future resume can extract it and render the full accumulated item set
  const prepareForSave = useCallback(
    (qr: QuestionnaireResponse): QuestionnaireResponse => ({
      ...qr,
      contained: [currentQuestionnaire as FhirResource],
      questionnaire: `#${currentQuestionnaire.id}`,
    }),
    [currentQuestionnaire],
  );

  const handleSaveDraft = useCallback(() => {
    const qr = formRef.current?.extractQr("in-progress");
    if (qr) onSave(prepareForSave(qr), "in-progress");
  }, [onSave, prepareForSave]);

  const handleSaveCompleted = useCallback(() => {
    const qr = formRef.current?.extractQr("completed");
    if (qr) onSave(prepareForSave(qr), "completed");
  }, [onSave, prepareForSave]);

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
          questionnaire={currentQuestionnaire}
          prepopulated={renderQr}
          originIndex={originIndex}
          onSave={noop}
          hideFooter
        />
      </div>

      <div className="shrink-0 border-t pt-4 space-y-3">
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
              Round {round + 1} — answer the questions above and click Continue
            </span>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleSaveDraft}
            disabled={isSaving}
          >
            <Save className="h-4 w-4 mr-1.5" />
            Save Draft
          </Button>

          {!isCompleted ? (
            <Button onClick={handleContinue} disabled={nextQuestion.isPending}>
              {nextQuestion.isPending ? (
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-1.5" />
              )}
              {nextQuestion.isPending ? "Loading..." : "Continue"}
            </Button>
          ) : (
            <Button onClick={handleSaveCompleted} disabled={isSaving}>
              <CheckCircle className="h-4 w-4 mr-1.5" />
              {isSaving ? "Saving..." : "Complete"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
