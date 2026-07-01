import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Questionnaire, QuestionnaireResponse } from "fhir/r4";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdaptiveDtrForm } from "@/components/questionnaire/adaptive-dtr-form";
import { LhcFormRenderer } from "@/components/questionnaire/lhc-form-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import {
  invalidateOrderQueries,
  usePatientQuestionnaireResponses,
} from "@/hooks/use-clinical-api";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  getOrderSatisfactionState,
  usePatientQrIndex,
} from "@/hooks/use-patient-qr-index";
import { usePayerServer } from "@/hooks/use-payer-server";
import {
  type QuestionnairePackageEntry,
  useProviderPopulate,
  useQuestionnairePackage,
  useQuestionnairePackages,
  useSaveQuestionnaireResponse,
} from "@/hooks/use-questionnaire";
import { propagateCoverageInfo } from "@/lib/coverage-propagation";
import { broadcastDtrCompletion } from "@/lib/dtr-completion";
import { upsertQrDtrExtensions } from "@/lib/dtr-qr-extensions";
import { parseOrderRefs, parseQuestionnaireSearch } from "@/lib/dtr-search";
import { normalizeServerUrl } from "@/lib/fhir-config";
import {
  applyPopulateResult,
  buildOriginIndex,
  stampOrigins,
} from "@/lib/information-origin";
import { isTerminalQrStatus, type TerminalQrStatus } from "@/lib/qr-status";
import { cn } from "@/lib/utils";

const ADAPTIVE_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-questionnaireAdaptive";

export interface DtrTaskContext {
  iss: string;
  launch?: string;
  patientId?: string;
  encounterId?: string;
  fhirContext?: string;
  coverageRef?: string;
  orderRef?: string;
  coverageAssertionId?: string;
  questionnaire?: string;
  relatedOrderRefs?: string;
  appContext?: string;
}

interface DtrWorkspaceProps {
  context: DtrTaskContext;
  onClose?: () => void;
}

function isAdaptiveQuestionnaire(q: Questionnaire): boolean {
  return q.extension?.some((e) => e.url === ADAPTIVE_EXT_URL) ?? false;
}

export function DtrWorkspace({ context, onClose }: DtrWorkspaceProps) {
  const { serverUrl: selectedProviderFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();
  const { fhirUserType } = useAuth();
  const isPatientUser = fhirUserType === "Patient";
  const queryClient = useQueryClient();
  const [savedStatus, setSavedStatus] = useState<
    "in-progress" | TerminalQrStatus | null
  >(null);
  const [savedResponseId, setSavedResponseId] = useState<string | undefined>();
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [activeQuestionnaireIndex, setActiveQuestionnaireIndex] =
    useState<number>(0);
  const [activeIndexInitialized, setActiveIndexInitialized] =
    useState<boolean>(false);

  const providerFhirUrl = context.iss
    ? normalizeServerUrl(context.iss)
    : selectedProviderFhirUrl;
  const questionnaireCanonicals = parseQuestionnaireSearch(
    context.questionnaire,
  );
  const fhirContextRefs = useMemo(
    () => context.fhirContext?.split(",").filter(Boolean) ?? [],
    [context.fhirContext],
  );

  const coverageRef =
    context.coverageRef ??
    fhirContextRefs.find((r) => r.startsWith("Coverage/"));
  const orderRef =
    context.orderRef ??
    fhirContextRefs.find(
      (r) =>
        r.startsWith("ServiceRequest/") ||
        r.startsWith("MedicationRequest/") ||
        r.startsWith("DeviceRequest/") ||
        r.startsWith("NutritionOrder/") ||
        r.startsWith("VisionPrescription/") ||
        r.startsWith("CommunicationRequest/") ||
        r.startsWith("Appointment/"),
    );
  const encounterRef = context.encounterId
    ? `Encounter/${context.encounterId}`
    : undefined;

  const relatedOrderRefs = useMemo(
    () => parseOrderRefs(context.relatedOrderRefs),
    [context.relatedOrderRefs],
  );

  const allOrderRefs = useMemo(() => {
    const refs = orderRef ? [orderRef, ...relatedOrderRefs] : relatedOrderRefs;
    return Array.from(new Set(refs.filter(Boolean)));
  }, [orderRef, relatedOrderRefs]);

  const existingQrRef = fhirContextRefs.find((ref) =>
    ref.startsWith("QuestionnaireResponse/"),
  );
  const existingQrId = existingQrRef?.split("/")[1];

  const { data: existingQr } = useQuery({
    queryKey: ["fhir", "QuestionnaireResponse", existingQrId],
    queryFn: () =>
      fhirFetch<QuestionnaireResponse>(
        `${providerFhirUrl}/QuestionnaireResponse/${existingQrId}`,
      ),
    enabled: !!existingQrId && !!providerFhirUrl,
  });

  const inProgressQrsQuery = usePatientQuestionnaireResponses(
    context.patientId ?? "",
    "in-progress",
  );

  // Patient-wide QR index for order-anchored satisfaction state. Drives tab
  // decoration and the read-only display fallback in activeExistingQr when a
  // completed/amended QR is linked to this order via qr-context — so re-opens
  // and post-save renders show the finished documentation instead of a blank
  // form. The DTR cross-questionnaire-prepopulation prohibition (don't pull
  // answers from a completed QR into a *different* questionnaire) is a
  // separate concern, not enforced here.
  const qrIndex = usePatientQrIndex(context.patientId ?? "");

  // qrByCanonical tracks in-progress QRs for the workspace's selected
  // canonicals; it is the resume source. Completed/amended QRs show via
  // qrIndex (above) in read-only mode; Amend is the explicit path to edit.
  const qrByCanonical = useMemo(() => {
    const map = new Map<string, { inProgress: QuestionnaireResponse[] }>();
    for (const c of questionnaireCanonicals) {
      map.set(c, { inProgress: [] });
    }
    for (const entry of inProgressQrsQuery.data?.entry ?? []) {
      const qr = entry.resource;
      if (!isQuestionnaireResponse(qr)) continue;
      const c = qr.questionnaire;
      if (!c) continue;
      const stripped = stripCanonicalVersion(c);
      for (const target of questionnaireCanonicals) {
        if (target === c || stripCanonicalVersion(target) === stripped) {
          map.get(target)?.inProgress.push(qr);
          break;
        }
      }
    }
    const byUpdatedDesc = (
      a: QuestionnaireResponse,
      b: QuestionnaireResponse,
    ) => (b.meta?.lastUpdated ?? "").localeCompare(a.meta?.lastUpdated ?? "");
    for (const entry of map.values()) {
      entry.inProgress.sort(byUpdatedDesc);
    }
    return map;
  }, [questionnaireCanonicals, inProgressQrsQuery.data]);

  const isMultiQ = questionnaireCanonicals.length > 1;

  const packageEntries = useQuestionnairePackages(questionnaireCanonicals, {
    payerFhirUrl,
    providerFhirUrl,
    coverageRef,
    orderRef,
    coverageAssertionId: context.coverageAssertionId,
  });

  const singularQuery = useQuestionnairePackage({
    payerFhirUrl,
    providerFhirUrl,
    coverageRef,
    orderRef,
    coverageAssertionId: context.coverageAssertionId,
    questionnaire: questionnaireCanonicals,
    enabled: !isMultiQ,
  });

  const totalQuestionnaires = isMultiQ ? packageEntries.length : 1;
  const safeActiveIndex = Math.min(
    activeQuestionnaireIndex,
    Math.max(totalQuestionnaires - 1, 0),
  );

  const activeEntry: QuestionnairePackageEntry | null = isMultiQ
    ? (packageEntries[safeActiveIndex] ?? null)
    : null;

  const activePackage = isMultiQ
    ? activeEntry
      ? {
          bundle: activeEntry.bundle,
          questionnaire: activeEntry.questionnaire,
          questionnaireResponse: activeEntry.questionnaireResponse,
          contentServerUrl: activeEntry.contentServerUrl,
          terminologyServerUrl: activeEntry.terminologyServerUrl,
        }
      : null
    : singularQuery.data
      ? {
          bundle: singularQuery.data.bundle,
          questionnaire: singularQuery.data.questionnaire,
          questionnaireResponse: singularQuery.data.questionnaireResponse,
          contentServerUrl: singularQuery.data.contentServerUrl,
          terminologyServerUrl: singularQuery.data.terminologyServerUrl,
        }
      : null;

  const isLoading = isMultiQ
    ? (activeEntry?.isLoading ?? false)
    : singularQuery.isLoading;
  const isError = isMultiQ
    ? (activeEntry?.isError ?? false)
    : singularQuery.isError;
  const error = isMultiQ ? activeEntry?.error : singularQuery.error;

  // Build SDC context entries from launchContext extensions on the active
  // Questionnaire, plus a synthetic `patient` entry to anchor HAPI cr's
  // PopulateRequest.getSubjectId on Patient (it falls back to context[0]
  // when no "patient" context is present, which would otherwise pick the
  // clinical/MedicationRequest binding as the subject).
  const patientRef = context.patientId
    ? `Patient/${context.patientId}`
    : undefined;
  const contexts = useMemo(
    () =>
      buildLaunchContexts(
        activePackage?.questionnaire ?? null,
        patientRef,
        orderRef,
        encounterRef,
      ),
    [activePackage?.questionnaire, patientRef, orderRef, encounterRef],
  );

  const { data: populateResult } = useProviderPopulate({
    questionnaire: activePackage?.questionnaire ?? undefined,
    packageBundle: activePackage?.bundle ?? undefined,
    subject: context.patientId ? `Patient/${context.patientId}` : undefined,
    contexts,
    providerFhirUrl,
  });

  const activeCanonical =
    questionnaireCanonicals[safeActiveIndex] ??
    questionnaireCanonicals[0] ??
    null;

  const activeExistingQr = useMemo(() => {
    if (existingQr?.questionnaire && activeCanonical) {
      const fhirContextStripped = stripCanonicalVersion(
        existingQr.questionnaire,
      );
      const activeStripped = stripCanonicalVersion(activeCanonical);
      if (
        existingQr.questionnaire === activeCanonical ||
        fhirContextStripped === activeStripped
      ) {
        return existingQr;
      }
    }
    if (!activeCanonical) return null;
    const entry = qrByCanonical.get(activeCanonical);
    if (entry?.inProgress[0]) return entry.inProgress[0];
    // No in-progress to resume: fall back to a completed/amended QR anchored
    // to this order via qr-context so the form renders the finished doc in
    // read-only mode. Without this, post-save and re-open paths show a blank
    // form and the user is stuck re-launching DTR for the same order line.
    // The Amend button is the explicit edit path; mergedQr renders the QR
    // verbatim (no populate blending) so the user's answers stay authoritative.
    if (orderRef) {
      const orderState = getOrderSatisfactionState(
        qrIndex,
        activeCanonical,
        orderRef,
      );
      if (orderState.kind === "completedForThisOrder") {
        return orderState.qr;
      }
    }
    return null;
  }, [existingQr, activeCanonical, qrByCanonical, qrIndex, orderRef]);

  // Merge populate result over the existing in-progress QR (resume) or the
  // payer-shipped draft per DTR resumption rules. The base is the existing
  // QR when present so the user's manual/override edits are preserved; fresh
  // auto-* values from populate flow in via applyPopulateResult's merge table.
  // stampOrigins on the payer draft enforces auto-server origin where the
  // payer pre-populated values for the no-existing-QR first-launch path.
  const { mergedQr, originIndex } = useMemo(() => {
    const payerDraft = activePackage?.questionnaireResponse ?? null;
    const candidate = populateResult?.response ?? null;
    // Terminal QRs (completed/amended) render verbatim. The submitted answers
    // are authoritative and must not be blended with a fresh populate result,
    // which would overwrite user-confirmed values with stale auto values.
    if (activeExistingQr && isTerminalQrStatus(activeExistingQr.status)) {
      return {
        mergedQr: activeExistingQr,
        originIndex: buildOriginIndex(activeExistingQr),
      };
    }
    const base =
      activeExistingQr ??
      (payerDraft ? stampOrigins(payerDraft, "auto-server") : null);
    if (!base && !candidate) {
      return {
        mergedQr: null as QuestionnaireResponse | null,
        originIndex: new Map(),
      };
    }
    const merged =
      base && candidate
        ? applyPopulateResult(base, candidate)
        : (base ?? candidate);
    return {
      mergedQr: merged,
      originIndex: merged ? buildOriginIndex(merged) : new Map(),
    };
  }, [activeExistingQr, activePackage?.questionnaireResponse, populateResult]);

  // mergedQr already incorporates activeExistingQr as the base when present,
  // so it's the single source of truth for what to feed LHC-Forms.
  const initialQr = mergedQr;
  const saveResponse = useSaveQuestionnaireResponse(providerFhirUrl);

  // Sync per-tab state when the active questionnaire changes (initial load,
  // tab nav, or QR refetch after save). Drives "view vs edit", QR id continuity,
  // and clears any stale completion-card flag.
  // activeCanonical must be in the deps: when switching between tabs that both
  // lack an existing QR, neither id nor status changes value, so without this
  // the reset is skipped and a stale savedResponseId from the previous tab's
  // POST gets reused as a PUT target on the next tab's save.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeCanonical
  useEffect(() => {
    setSavedResponseId(activeExistingQr?.id);
    setSavedStatus(null);
    setIsEditing(!isTerminalQrStatus(activeExistingQr?.status));
  }, [activeCanonical, activeExistingQr?.id, activeExistingQr?.status]);

  // On initial load (multi-Q only), jump to the first canonical that doesn't
  // already have a terminal QR. If all are terminal, stay on index 0 so the
  // user lands somewhere meaningful.
  useEffect(() => {
    if (activeIndexInitialized) return;
    if (!isMultiQ) {
      setActiveIndexInitialized(true);
      return;
    }
    if (inProgressQrsQuery.isLoading) {
      return;
    }
    // Land on the first canonical without an in-progress resume; otherwise index 0.
    const firstNotResumable = questionnaireCanonicals.findIndex((c) => {
      const entry = qrByCanonical.get(c);
      return !entry?.inProgress.length;
    });
    setActiveQuestionnaireIndex(firstNotResumable >= 0 ? firstNotResumable : 0);
    setActiveIndexInitialized(true);
  }, [
    activeIndexInitialized,
    isMultiQ,
    inProgressQrsQuery.isLoading,
    questionnaireCanonicals,
    qrByCanonical,
  ]);

  const propagateCoverage = useCallback(
    async (qr: QuestionnaireResponse) => {
      if (allOrderRefs.length === 0 || !providerFhirUrl) return;

      await propagateCoverageInfo({
        qr,
        orderRefs: allOrderRefs,
        providerFhirUrl,
      });

      invalidateOrderQueries(queryClient);
    },
    [allOrderRefs, providerFhirUrl, queryClient],
  );

  const notifyDtrCompletion = useCallback(
    (
      response: QuestionnaireResponse,
      status: "in-progress" | TerminalQrStatus,
    ) => {
      broadcastDtrCompletion({
        status,
        orderRef: allOrderRefs[0] ?? orderRef,
        orderRefs: allOrderRefs.length > 0 ? allOrderRefs : undefined,
        patientId: context.patientId,
        coverageRef,
        coverageAssertionId: context.coverageAssertionId,
        fhirContext: fhirContextRefs,
        questionnaireResponseId: response.id,
      });
    },
    [
      allOrderRefs,
      orderRef,
      context.patientId,
      context.coverageAssertionId,
      coverageRef,
      fhirContextRefs,
    ],
  );

  const handleSave = useCallback(
    (response: QuestionnaireResponse, status: "in-progress" | "completed") => {
      const isAmend = isTerminalQrStatus(activeExistingQr?.status);
      const persistedStatus: "in-progress" | TerminalQrStatus = isAmend
        ? "amended"
        : status;
      response.status = persistedStatus;

      if (context.patientId) {
        response.subject = { reference: `Patient/${context.patientId}` };
      }
      if (context.encounterId) {
        response.encounter = { reference: `Encounter/${context.encounterId}` };
      }

      if (savedResponseId) {
        response.id = savedResponseId;
      }

      if (allOrderRefs.length > 0 || coverageRef) {
        response.extension = upsertQrDtrExtensions(
          response.extension ?? [],
          allOrderRefs,
          coverageRef,
        );

        const serviceRequestRefs = allOrderRefs.filter((ref) =>
          ref.startsWith("ServiceRequest/"),
        );
        if (serviceRequestRefs.length > 0) {
          response.basedOn = serviceRequestRefs.map((ref) => ({
            reference: ref,
          }));
        }
      }

      const sourceQr = activeExistingQr ?? mergedQr;
      if (sourceQr?.extension) {
        const existingUrls = new Set(
          (response.extension ?? []).map((e) => e.url),
        );
        for (const ext of sourceQr.extension) {
          if (!existingUrls.has(ext.url)) {
            response.extension = response.extension ?? [];
            response.extension.push(ext);
          }
        }
      }

      saveResponse.mutate(response, {
        onSuccess: async (saved) => {
          if (saved?.id) setSavedResponseId(saved.id);

          if (
            isTerminalQrStatus(persistedStatus) &&
            saved &&
            allOrderRefs.length > 0
          ) {
            await propagateCoverage(saved);
          }

          queryClient.invalidateQueries({
            queryKey: ["fhir", "QuestionnaireResponse"],
          });
          notifyDtrCompletion(saved, persistedStatus);

          const isTerminal = isTerminalQrStatus(persistedStatus);
          const hasMoreQuestionnaires =
            isMultiQ && safeActiveIndex < totalQuestionnaires - 1;

          if (isTerminal && hasMoreQuestionnaires) {
            setActiveQuestionnaireIndex(safeActiveIndex + 1);
          } else if (isTerminal && isMultiQ) {
            // Multi-Q final save: stay on the active tab. The patient-QR refetch
            // updates activeExistingQr, which the per-tab effect uses to flip
            // the form into terminal/view mode. Skip the completion card so the
            // user can still navigate between tabs.
          } else {
            setSavedStatus(persistedStatus);
          }
        },
      });
    },
    [
      context.patientId,
      context.encounterId,
      saveResponse,
      savedResponseId,
      allOrderRefs,
      coverageRef,
      activeExistingQr,
      mergedQr,
      propagateCoverage,
      notifyDtrCompletion,
      queryClient,
      isMultiQ,
      safeActiveIndex,
      totalQuestionnaires,
    ],
  );

  useEffect(() => {
    if (savedStatus === "in-progress") {
      setSavedStatus(null);
    }
  }, [savedStatus]);

  if (!isMultiQ && isTerminalQrStatus(savedStatus)) {
    const isAmended = savedStatus === "amended";
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              {isAmended ? "Documentation Updated" : "Documentation Complete"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {isAmended
                ? "The amended questionnaire response has been saved to the FHIR server."
                : "The questionnaire response has been saved to the FHIR server."}
            </p>
            {onClose ? (
              <Button variant="outline" className="w-full" onClick={onClose}>
                Close
              </Button>
            ) : isPatientUser ? (
              <Link to="/patient">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Back to Patient
                </Button>
              </Link>
            ) : (
              context.patientId && (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: context.patientId }}
                >
                  <Button variant="outline" className="w-full">
                    <ArrowLeft className="h-4 w-4 mr-1.5" />
                    Back to Patient
                  </Button>
                </Link>
              )
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-full flex-col p-4">
      <div className="mb-4 shrink-0 flex items-center gap-4 text-sm text-muted-foreground">
        {!onClose &&
          (isPatientUser ? (
            <Link
              to="/patient"
              className="flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Patient
            </Link>
          ) : (
            context.patientId && (
              <Link
                to="/patients/$patientId"
                params={{ patientId: context.patientId }}
                className="flex items-center gap-1 hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Patient
              </Link>
            )
          ))}
        {coverageRef && <span>Coverage: {coverageRef}</span>}
        {orderRef && <span>Order: {orderRef}</span>}
        {activeExistingQr && (
          <>
            <span className="text-amber-600 dark:text-amber-400">
              {activeExistingQr.status === "in-progress"
                ? "Resuming"
                : isEditing
                  ? "Amending"
                  : "Viewing"}
              : QuestionnaireResponse/{activeExistingQr.id}
            </span>
            {isTerminalQrStatus(activeExistingQr.status) && !isEditing && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setIsEditing(true)}
              >
                Amend
              </Button>
            )}
          </>
        )}
      </div>

      {isMultiQ && (
        <div className="mb-4 shrink-0 flex flex-wrap gap-1 border-b border-border">
          {questionnaireCanonicals.map((canonical, idx) => {
            const entry = packageEntries[idx];
            const qrEntry = qrByCanonical.get(canonical);
            const orderState = orderRef
              ? getOrderSatisfactionState(qrIndex, canonical, orderRef)
              : { kind: "notStarted" as const };
            const tabState =
              orderState.kind === "completedForThisOrder"
                ? "completed"
                : qrEntry?.inProgress.length ||
                    orderState.kind === "inProgressForThisOrder"
                  ? "in-progress"
                  : "pending";
            const title =
              entry?.questionnaire?.title ??
              entry?.questionnaire?.name ??
              friendlyCanonicalName(canonical);
            const isActive = idx === safeActiveIndex;
            return (
              <button
                key={canonical}
                type="button"
                onClick={() => setActiveQuestionnaireIndex(idx)}
                className={cn(
                  "flex cursor-pointer items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px transition-colors",
                  isActive
                    ? "border-primary text-foreground font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tabState === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                ) : tabState === "in-progress" ? (
                  <Clock className="h-3.5 w-3.5 text-amber-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-muted-foreground" />
                )}
                <span>{title}</span>
              </button>
            );
          })}
        </div>
      )}

      {isLoading && (
        <div className="flex items-center justify-center min-h-[30vh]">
          <div className="text-center space-y-3">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Loading questionnaire from payer...
            </p>
          </div>
        </div>
      )}

      {isError && (
        <div className="flex items-center justify-center min-h-[30vh]">
          <div className="max-w-md space-y-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="text-lg font-semibold">
              Failed to Load Questionnaire
            </h2>
            <p className="text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "An error occurred"}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !isError && !activePackage?.questionnaire && (
        <div className="flex items-center justify-center min-h-[30vh]">
          <div className="max-w-md space-y-4 text-center">
            <AlertCircle className="mx-auto h-12 w-12 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              No Questionnaire Available
            </h2>
            <p className="text-sm text-muted-foreground">
              The payer did not return a questionnaire for the given context.
              This may indicate that no additional documentation is needed.
            </p>
          </div>
        </div>
      )}

      {activePackage?.questionnaire && (
        <div className="min-h-0 flex-1">
          {isAdaptiveQuestionnaire(activePackage.questionnaire) ? (
            <AdaptiveDtrForm
              questionnaire={activePackage.questionnaire}
              prepopulated={initialQr ?? undefined}
              originIndex={originIndex}
              onSave={handleSave}
              isSaving={saveResponse.isPending}
              payerFhirUrl={payerFhirUrl}
              readOnly={!isEditing}
              allowInProgressSave={
                !isTerminalQrStatus(activeExistingQr?.status)
              }
            />
          ) : (
            <LhcFormRenderer
              questionnaire={activePackage.questionnaire}
              prepopulated={initialQr ?? undefined}
              originIndex={originIndex}
              onSave={handleSave}
              isSaving={saveResponse.isPending}
              readOnly={!isEditing}
              allowInProgressSave={
                !isTerminalQrStatus(activeExistingQr?.status)
              }
            />
          )}
        </div>
      )}
    </div>
  );
}

function isQuestionnaireResponse(
  resource: unknown,
): resource is QuestionnaireResponse {
  return (
    !!resource &&
    typeof resource === "object" &&
    (resource as { resourceType?: string }).resourceType ===
      "QuestionnaireResponse"
  );
}

function stripCanonicalVersion(canonical: string): string {
  const pipeIdx = canonical.indexOf("|");
  return pipeIdx === -1 ? canonical : canonical.substring(0, pipeIdx);
}

function friendlyCanonicalName(canonical: string): string {
  const stripped = stripCanonicalVersion(canonical);
  const slashIdx = stripped.lastIndexOf("/");
  return slashIdx === -1 ? stripped : stripped.substring(slashIdx + 1);
}

const SDC_LAUNCH_CONTEXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-launchContext";

/**
 * Reads the active Questionnaire's sdc-questionnaire-launchContext extensions
 * and binds each to the matching local FHIR resource reference for $populate.
 *
 * Always includes a `patient` context entry when a patient ref is provided —
 * HAPI cr's PopulateRequest.getSubjectId picks the first context entry's
 * content as the subject when no entry is named "patient", ignoring the
 * explicit `subject` parameter. Without this, a `clinical` context bound to an
 * order type leaks into the subject slot and the CQL `context Patient`
 * scope evaluates against the wrong resource.
 */
function buildLaunchContexts(
  questionnaire: Questionnaire | null,
  patientRef: string | undefined,
  orderRef: string | undefined,
  encounterRef: string | undefined,
): Record<string, string[]> {
  const contexts: Record<string, string[]> = {};
  if (patientRef) {
    contexts.patient = [patientRef];
  }
  if (!questionnaire?.extension) return contexts;

  for (const ext of questionnaire.extension) {
    if (ext.url !== SDC_LAUNCH_CONTEXT_URL) continue;
    const nameExt = ext.extension?.find((e) => e.url === "name");
    const code = nameExt?.valueCoding?.code;
    if (!code) continue;
    const ref = bindLaunchContextRef(code, orderRef, encounterRef);
    if (ref) {
      contexts[code] = [ref];
    }
  }
  return contexts;
}

function bindLaunchContextRef(
  code: string,
  orderRef: string | undefined,
  encounterRef: string | undefined,
): string | undefined {
  switch (code) {
    case "clinical":
      return orderRef;
    case "encounter":
      return encounterRef;
    default:
      return undefined;
  }
}
