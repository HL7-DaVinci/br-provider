import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type {
  Bundle,
  ClaimResponse,
  Coverage,
  Extension,
  QuestionnaireResponse,
  Resource,
  Task,
} from "fhir/r4";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useDtrTaskSheet } from "@/components/dtr/use-dtr-task-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSubmitAttachment } from "@/hooks/use-cdex";
import {
  invalidateOrderQueries,
  useCoverage,
  useOrderPaStatus,
  useOrderQuestionnaireResponses,
  usePatient,
} from "@/hooks/use-clinical-api";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import {
  extractTaskQuestionnaireContexts,
  fetchPasInquiry,
  type PasSubmitResult,
  persistClaimResponseToProvider,
  useCompleteDocumentationTask,
  useEnsurePasSubscription,
  usePasDocumentationTasks,
  usePasSubmit,
  usePersistDocumentationTasks,
} from "@/hooks/use-pas";
import { usePayerServer } from "@/hooks/use-payer-server";
import {
  formatClinicalDate,
  formatPatientName,
} from "@/lib/clinical-formatters";
import { isTerminalQrStatus } from "@/lib/qr-status";

interface PasSearch {
  coverageId?: string;
  claimResponseId?: string;
  qrIds?: string;
  orderType?: string;
}

export const Route = createFileRoute(
  "/patients/$patientId/orders/$orderId/pas",
)({
  component: PasPage,
  validateSearch: (search: Record<string, unknown>): PasSearch => ({
    coverageId: (search.coverageId as string) ?? undefined,
    claimResponseId: (search.claimResponseId as string) ?? undefined,
    qrIds: (search.qrIds as string) ?? undefined,
    orderType: (search.orderType as string) ?? undefined,
  }),
});

const TERMINAL_TASK_STATUSES = [
  "completed",
  "cancelled",
  "failed",
  "rejected",
  "entered-in-error",
];

function PasPage() {
  const { patientId, orderId } = Route.useParams();
  const { coverageId, claimResponseId, qrIds, orderType } = Route.useSearch();
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();
  const openDtrTask = useDtrTaskSheet();
  const queryClient = useQueryClient();

  const invalidateClaimResponseList = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ["fhir", "ClaimResponse", patientId],
    });
  }, [patientId, queryClient]);

  const { data: existingClaimResponse } = useQuery({
    queryKey: ["fhir", "ClaimResponse", claimResponseId, providerFhirUrl],
    queryFn: async (): Promise<ClaimResponse | null> => {
      if (!claimResponseId) return null;
      // Prefer the ClaimResponse persisted on the provider (no payer round-trip, no $inquire).
      try {
        const bundle = await fhirFetch<Bundle<ClaimResponse>>(
          `${providerFhirUrl}/ClaimResponse?identifier=${encodeURIComponent(
            claimResponseId,
          )}&_sort=-_lastUpdated`,
        );
        const persisted = bundle.entry?.[0]?.resource;
        if (persisted) return persisted;
      } catch {
        // fall through to a payer inquiry
      }
      try {
        return await fetchPasInquiry({
          claimResponseId,
          payerFhirUrl,
          patientId,
          orderId,
          orderType: orderType ?? "ServiceRequest",
          coverageId,
          providerFhirUrl,
        });
      } catch {
        return null;
      }
    },
    enabled: !!claimResponseId && !!providerFhirUrl,
    staleTime: 60 * 1000,
    retry: false,
  });

  const { data: patient } = usePatient(patientId);
  const { data: coverageBundle } = useCoverage(patientId);
  const coverage = coverageId
    ? (coverageBundle?.entry?.find(
        (e) => (e.resource as Resource)?.id === coverageId,
      )?.resource as Coverage | undefined)
    : (coverageBundle?.entry?.[0]?.resource as Coverage | undefined);

  const resolvedCoverageId = coverageId ?? coverage?.id;
  const resolvedOrderType = orderType ?? "ServiceRequest";
  const orderRef = `${resolvedOrderType}/${orderId}`;
  const questionnaireResponseIds = qrIds
    ? qrIds.split(",").filter(Boolean)
    : [];

  // Fetch each QR to display metadata (status, questionnaire title)
  const qrQueries = useQueries({
    queries: questionnaireResponseIds.map((id) => ({
      queryKey: ["fhir", "QuestionnaireResponse", id, providerFhirUrl],
      queryFn: () =>
        fhirFetch<QuestionnaireResponse>(
          `${providerFhirUrl}/QuestionnaireResponse/${id}`,
        ),
      enabled: !!providerFhirUrl,
      staleTime: 60 * 1000,
      retry: 1,
    })),
  });

  const pasSubmit = usePasSubmit();
  const submitAttachment = useSubmitAttachment();
  const persistDocTasks = usePersistDocumentationTasks();
  const completeDocTask = useCompleteDocumentationTask();
  const ensureSubscription = useEnsurePasSubscription();

  // After submission, track the ClaimResponse and any documentation request Tasks
  const [claimResponse, setClaimResponse] = useState<ClaimResponse | null>(
    null,
  );
  const [docTasks, setDocTasks] = useState<Task[]>([]);
  const activeClaimResponse = claimResponse ?? existingClaimResponse ?? null;

  // Learn the final decision from our own persisted ClaimResponse (fed by the PAS subscription
  // notification), not by polling the payer's Claim/$inquire (PAS spec-9: SHOULD NOT while waiting).
  const trackingId = activeClaimResponse?.identifier?.[0]?.value;
  const paStatus = useOrderPaStatus(
    trackingId,
    providerFhirUrl,
    !!activeClaimResponse,
  );

  const latestResponse: ClaimResponse | null =
    paStatus.data ?? activeClaimResponse;
  const isPended =
    latestResponse?.outcome === "queued" ||
    latestResponse?.outcome === "partial";
  const priorClaimId = latestResponse?.request?.reference?.replace(
    /^.*Claim\//,
    "",
  );

  const rehydratedDocTasks = usePasDocumentationTasks(
    docTasks.length === 0 && latestResponse?.id && providerFhirUrl
      ? {
          patientId,
          providerFhirUrl,
          claimId: priorClaimId,
          claimResponseId: latestResponse.id,
          claimTrackingId: latestResponse.identifier?.[0]?.value,
          orderRef,
        }
      : undefined,
  );
  const documentationTasks =
    docTasks.length > 0 ? docTasks : (rehydratedDocTasks.data ?? []);
  const taskQuestionnaireContexts =
    extractTaskQuestionnaireContexts(documentationTasks);

  // An outstanding documentation request is an open (non-terminal) documentation Task. The submit is
  // driven by this request plus completed documentation, independent of the claim's current decision:
  // the payer asked for documents, so they are sent when ready whether the claim is still pended,
  // approved, or denied. A completed Task means its attachment was already sent, which keeps the
  // auto-submit idempotent across navigation.
  const openDocTask = documentationTasks.find(
    (task) => !TERMINAL_TASK_STATUSES.includes(task.status ?? ""),
  );
  const hasOpenDocRequest =
    !!openDocTask && taskQuestionnaireContexts.length > 0;

  // Detect documentation completed in response to the request (newer than the request), to send to the
  // payer via $submit-attachment. The "newer than" anchor is the Task's authoredOn so it survives the
  // claim being resolved, since a resolved ClaimResponse may carry a later created date.
  const { data: orderQrBundle } = useOrderQuestionnaireResponses(
    hasOpenDocRequest ? orderRef : undefined,
    hasOpenDocRequest ? patientId : undefined,
  );
  const docRequestAnchor =
    openDocTask?.authoredOn ?? activeClaimResponse?.created;
  const newCompletedQrs = (orderQrBundle?.entry ?? [])
    .filter((e) => isTerminalQrStatus(e.resource?.status))
    .map((e) => e.resource as QuestionnaireResponse)
    .filter((qr) => {
      if (!docRequestAnchor) return true;
      const qrDate = qr.authored ? new Date(qr.authored) : null;
      return qrDate ? qrDate >= new Date(docRequestAnchor) : true;
    });
  const newCompletedQrIds = newCompletedQrs
    .map((qr) => qr.id)
    .filter((id): id is string => !!id);

  const [isLaunchingDtr, setIsLaunchingDtr] = useState(false);

  function handleSubmit() {
    if (!resolvedCoverageId) return;

    pasSubmit.mutate(
      {
        patientId,
        orderId,
        orderType: resolvedOrderType,
        coverageId: resolvedCoverageId,
        questionnaireResponseIds,
        payerFhirUrl,
        providerFhirUrl,
      },
      {
        onSuccess: (result: PasSubmitResult) => {
          setClaimResponse(result.claimResponse);
          setDocTasks(result.documentationTasks);
          // Persist the ClaimResponse + Task(s) so PA status survives navigation and the inbound
          // subscription notification can correlate the resolution by tracking id.
          void (async () => {
            try {
              await persistClaimResponseToProvider(
                providerFhirUrl,
                result.claimResponse,
              );
            } catch {
              // best-effort: the server backfills the ClaimResponse on resolution
            }
            invalidateOrderQueries(queryClient);
          })();
          if (result.documentationTasks.length > 0) {
            persistDocTasks.mutate(result.documentationTasks);
          }
          // Pended PA: subscribe to the payer for the final-decision notification (PAS SHALL).
          if (
            result.claimResponse.outcome === "queued" ||
            result.claimResponse.outcome === "partial"
          ) {
            ensureSubscription.mutate(payerFhirUrl);
          }
        },
      },
    );
  }

  const handleDtrLaunch = useCallback(() => {
    if (!taskQuestionnaireContexts.length) return;
    setIsLaunchingDtr(true);
    try {
      const fhirContext = [
        resolvedCoverageId ? `Coverage/${resolvedCoverageId}` : null,
        `${resolvedOrderType}/${orderId}`,
      ].filter(Boolean);

      openDtrTask({
        iss: providerFhirUrl,
        patientId,
        fhirContext: fhirContext.join(","),
        coverageAssertionId: taskQuestionnaireContexts[0],
      });
    } catch (err) {
      console.error("DTR launch from PAS failed:", err);
    } finally {
      setIsLaunchingDtr(false);
    }
  }, [
    taskQuestionnaireContexts,
    resolvedCoverageId,
    resolvedOrderType,
    orderId,
    patientId,
    providerFhirUrl,
    openDtrTask,
  ]);

  // Solicited additional documentation: the payer requested documents via the documentation Task, so
  // the conformant response is CDex $submit-attachment (which associates the documents with the prior
  // auth by tracking id), not a Claim/$submit resubmission. This fulfills the request regardless of the
  // claim's current decision.
  const handleSubmitAttachment = useCallback(() => {
    if (!openDocTask || newCompletedQrIds.length === 0) return;

    submitAttachment.mutate(
      {
        task: openDocTask,
        payerFhirUrl,
        providerFhirUrl,
        questionnaireResponseIds: newCompletedQrIds,
      },
      {
        onSuccess: () => {
          invalidateClaimResponseList();
          void paStatus.refetch();
          completeDocTask.mutate({
            task: openDocTask,
            questionnaireResponseIds: newCompletedQrIds,
          });
          // Reflect the completed Task in local state so the outstanding-request UI clears immediately.
          setDocTasks((prev) =>
            prev.map((t) =>
              t.id === openDocTask.id ? { ...t, status: "completed" } : t,
            ),
          );
        },
      },
    );
  }, [
    openDocTask,
    newCompletedQrIds,
    submitAttachment,
    payerFhirUrl,
    providerFhirUrl,
    invalidateClaimResponseList,
    paStatus,
    completeDocTask,
  ]);

  // Auto-submit the completed questionnaire to the payer as soon as it is detected, fulfilling the
  // request without a manual step. Fires once per set of completed QRs and only while an open
  // documentation Task remains, so it never resubmits an attachment that was already sent.
  const newCompletedSig = newCompletedQrIds.slice().sort().join(",");
  const [autoSubmittedSig, setAutoSubmittedSig] = useState<string | null>(null);
  useEffect(() => {
    if (!openDocTask || newCompletedQrIds.length === 0) return;
    if (submitAttachment.isPending || newCompletedSig === autoSubmittedSig) {
      return;
    }
    setAutoSubmittedSig(newCompletedSig);
    handleSubmitAttachment();
  }, [
    openDocTask,
    newCompletedQrIds.length,
    newCompletedSig,
    autoSubmittedSig,
    submitAttachment.isPending,
    handleSubmitAttachment,
  ]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      {/* Back navigation */}
      <Link
        to="/patients/$patientId/orders"
        params={{ patientId }}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Orders
      </Link>

      <h2 className="text-xl font-semibold">Prior Authorization Review</h2>

      {/* Order Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Order Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-muted-foreground">Patient:</span>{" "}
              {patient ? formatPatientName(patient.name) : patientId}
            </div>
            <div>
              <span className="text-muted-foreground">Order Type:</span>{" "}
              {resolvedOrderType}
            </div>
            <div>
              <span className="text-muted-foreground">Order ID:</span>{" "}
              <span className="font-mono text-xs">{orderId}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Date:</span>{" "}
              {formatClinicalDate(new Date().toISOString())}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Coverage Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Coverage</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {coverage ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <span className="text-muted-foreground">Coverage ID:</span>{" "}
                <span className="font-mono text-xs">{coverage.id}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>{" "}
                <Badge variant="secondary" className="text-xs">
                  {coverage.status}
                </Badge>
              </div>
              {coverage.type?.coding?.[0] && (
                <div>
                  <span className="text-muted-foreground">Type:</span>{" "}
                  {coverage.type.coding[0].display ??
                    coverage.type.coding[0].code}
                </div>
              )}
              {coverage.period?.start && (
                <div>
                  <span className="text-muted-foreground">Period:</span>{" "}
                  {formatClinicalDate(coverage.period.start)}
                  {coverage.period.end
                    ? ` - ${formatClinicalDate(coverage.period.end)}`
                    : " - present"}
                </div>
              )}
            </div>
          ) : (
            <p className="text-muted-foreground">
              {resolvedCoverageId
                ? "Loading coverage..."
                : "No coverage selected"}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Supporting Documentation */}
      {questionnaireResponseIds.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Supporting Documentation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {qrQueries.map((query, i) => {
                const qrId = questionnaireResponseIds[i];
                const qr = query.data;
                return (
                  <li key={qrId} className="flex items-center gap-2 text-sm">
                    <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <Badge
                      variant={
                        isTerminalQrStatus(qr?.status) ? "default" : "secondary"
                      }
                      className="text-xs"
                    >
                      {query.isLoading ? "loading" : (qr?.status ?? "unknown")}
                    </Badge>
                    <span className="font-mono text-xs truncate">
                      QuestionnaireResponse/{qrId}
                    </span>
                    {qr?.questionnaire && (
                      <span className="text-xs text-muted-foreground truncate">
                        {qr.questionnaire.split("/").pop()?.split("|")[0]}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Payer Target */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Payer Endpoint</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <span className="text-muted-foreground">FHIR Server:</span>{" "}
          <span className="font-mono text-xs">{payerFhirUrl}</span>
          <div className="text-muted-foreground mt-1">
            Operation: <span className="font-mono">Claim/$submit</span>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Submit / Response Section */}
      {!latestResponse ? (
        <div className="flex justify-center">
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={pasSubmit.isPending || !resolvedCoverageId}
          >
            {pasSubmit.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Prior Authorization
              </>
            )}
          </Button>
        </div>
      ) : (
        <>
          <PasResponseDisplay
            claimResponse={latestResponse}
            isPolling={isPended && paStatus.isFetching}
          />

          {/* Documentation request (from PAS Task resources). Shown while a request is outstanding or a
              submission is in flight; the submit is driven by the request, not the claim's decision. */}
          {taskQuestionnaireContexts.length > 0 &&
            (openDocTask ||
              submitAttachment.isPending ||
              submitAttachment.isSuccess ||
              submitAttachment.isError) && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4 text-amber-500" />
                    Additional Documentation Requested
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {openDocTask && (
                    <>
                      <p className="text-sm text-muted-foreground">
                        The payer requested additional documentation for this
                        order. Complete the required questionnaire(s) using DTR;
                        completed documentation is submitted to the payer
                        automatically.
                      </p>
                      <ul className="space-y-1">
                        {taskQuestionnaireContexts.map((url) => (
                          <li
                            key={url}
                            className="text-xs font-mono text-muted-foreground"
                          >
                            {url}
                          </li>
                        ))}
                      </ul>
                      <Button
                        onClick={handleDtrLaunch}
                        disabled={isLaunchingDtr}
                      >
                        {isLaunchingDtr ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <FileText className="h-4 w-4 mr-2" />
                        )}
                        {isLaunchingDtr
                          ? "Launching..."
                          : "Complete Additional Documentation"}
                      </Button>
                    </>
                  )}

                  {(newCompletedQrs.length > 0 ||
                    submitAttachment.isPending ||
                    submitAttachment.isSuccess) &&
                    documentationTasks.length > 0 && (
                      <div className="space-y-2 pt-2 border-t">
                        {submitAttachment.isPending ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span>
                              Submitting completed documentation to the payer...
                            </span>
                          </div>
                        ) : submitAttachment.isError ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                              <AlertCircle className="h-3.5 w-3.5" />
                              <span>Attachment submission failed.</span>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={handleSubmitAttachment}
                              disabled={!openDocTask}
                            >
                              <Send className="h-4 w-4 mr-2" />
                              Retry Submission
                            </Button>
                          </div>
                        ) : submitAttachment.isSuccess ? (
                          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Documentation submitted to the payer.</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>
                              {newCompletedQrs.length} document
                              {newCompletedQrs.length !== 1 ? "s" : ""}{" "}
                              completed; submitting to the payer...
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                </CardContent>
              </Card>
            )}
        </>
      )}

      {/* Error Display */}
      {(pasSubmit.isError || submitAttachment.isError) && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="text-sm">
              {(pasSubmit.error ?? submitAttachment.error)?.message}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// -- PAS extension URL constants --------------------------------------------------

const EXT_REVIEW_ACTION =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewAction";
const EXT_REVIEW_ACTION_CODE =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-reviewActionCode";
const EXT_PRE_AUTH_PERIOD =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemPreAuthPeriod";
const EXT_PRE_AUTH_ISSUE_DATE =
  "http://hl7.org/fhir/us/davinci-pas/StructureDefinition/extension-itemPreAuthIssueDate";

// -- Extension helpers ------------------------------------------------------------

function findExt(exts: Extension[] | undefined, url: string) {
  return exts?.find((e) => e.url === url);
}

interface ReviewAction {
  code?: string;
  display?: string;
  authNumber?: string;
}

type ClaimResponseAdjudication = NonNullable<
  NonNullable<ClaimResponse["item"]>[number]["adjudication"]
>;

function extractReviewAction(
  adjudication: ClaimResponseAdjudication | undefined,
): ReviewAction | undefined {
  for (const adj of adjudication ?? []) {
    const ra = findExt(adj.extension, EXT_REVIEW_ACTION);
    if (!ra?.extension) continue;

    const codeConcept = findExt(
      ra.extension,
      EXT_REVIEW_ACTION_CODE,
    )?.valueCodeableConcept;
    const authNum = ra.extension.find((e) => e.url === "number")?.valueString;

    return {
      code: codeConcept?.coding?.[0]?.code,
      display: codeConcept?.coding?.[0]?.display,
      authNumber: authNum,
    };
  }
  return undefined;
}

interface ItemDetails {
  sequence: number;
  reviewAction?: ReviewAction;
  preAuthPeriodStart?: string;
  preAuthPeriodEnd?: string;
  preAuthIssueDate?: string;
}

function extractItemDetails(
  items: ClaimResponse["item"] | undefined,
): ItemDetails[] {
  if (!items) return [];
  return items.map((item) => {
    const period = findExt(item.extension, EXT_PRE_AUTH_PERIOD)?.valuePeriod;
    const issueDate = findExt(
      item.extension,
      EXT_PRE_AUTH_ISSUE_DATE,
    )?.valueDate;
    return {
      sequence: item.itemSequence,
      reviewAction: extractReviewAction(item.adjudication),
      preAuthPeriodStart: period?.start,
      preAuthPeriodEnd: period?.end,
      preAuthIssueDate: issueDate,
    };
  });
}

// -- Display components -----------------------------------------------------------

function PasResponseDisplay({
  claimResponse,
  isPolling,
}: {
  claimResponse: ClaimResponse;
  isPolling: boolean;
}) {
  const outcome = claimResponse.outcome;
  const preAuthRef = claimResponse.preAuthRef;
  const items = extractItemDetails(claimResponse.item);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Prior Authorization Response</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Status:</span>
          <StatusBadge outcome={outcome} />
        </div>

        {preAuthRef && (
          <DetailRow label="Authorization Number">
            <span className="font-mono font-semibold">{preAuthRef}</span>
          </DetailRow>
        )}

        {claimResponse.disposition && (
          <DetailRow label="Disposition">{claimResponse.disposition}</DetailRow>
        )}

        {claimResponse.id && (
          <DetailRow label="ClaimResponse ID">
            <span className="font-mono text-xs">{claimResponse.id}</span>
          </DetailRow>
        )}

        {claimResponse.created && (
          <DetailRow label="Created">
            {formatClinicalDate(claimResponse.created)}
          </DetailRow>
        )}

        {/* Item-level authorization details */}
        {items.length > 0 && (
          <div className="space-y-2 pt-1">
            <Separator />
            <span className="text-sm font-medium">Item Details</span>
            {items.map((item) => (
              <ItemDetailCard key={item.sequence} item={item} />
            ))}
          </div>
        )}

        {/* Denial reasons */}
        {outcome === "error" && claimResponse.error && (
          <div className="space-y-1">
            <span className="text-sm text-muted-foreground">Reasons:</span>
            <ul className="list-disc list-inside text-sm">
              {claimResponse.error.map((err) => (
                <li
                  key={
                    err.code?.coding?.[0]?.code ?? err.code?.text ?? "unknown"
                  }
                >
                  {err.code?.coding?.[0]?.display ??
                    err.code?.coding?.[0]?.code ??
                    "Unknown reason"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(outcome === "queued" || outcome === "partial") && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            {isPolling ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Clock className="h-3.5 w-3.5" />
            )}
            <span>Waiting for payer review. Checking every 30 seconds.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}:</span>
      {children}
    </div>
  );
}

function ItemDetailCard({ item }: { item: ItemDetails }) {
  const ra = item.reviewAction;
  return (
    <div className="rounded-md border px-3 py-2 text-sm space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground">Item {item.sequence}</span>
        {ra?.display && (
          <Badge variant="outline" className="text-xs">
            {ra.display}
          </Badge>
        )}
        {ra?.code && !ra.display && (
          <Badge variant="outline" className="text-xs font-mono">
            {ra.code}
          </Badge>
        )}
      </div>
      {ra?.authNumber && (
        <div className="text-xs">
          <span className="text-muted-foreground">Auth #:</span>{" "}
          <span className="font-mono font-semibold">{ra.authNumber}</span>
        </div>
      )}
      {item.preAuthIssueDate && (
        <div className="text-xs">
          <span className="text-muted-foreground">Issued:</span>{" "}
          {formatClinicalDate(item.preAuthIssueDate)}
        </div>
      )}
      {item.preAuthPeriodStart && (
        <div className="text-xs">
          <span className="text-muted-foreground">Valid:</span>{" "}
          {formatClinicalDate(item.preAuthPeriodStart)}
          {item.preAuthPeriodEnd
            ? ` - ${formatClinicalDate(item.preAuthPeriodEnd)}`
            : " - ongoing"}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ outcome }: { outcome: ClaimResponse["outcome"] }) {
  switch (outcome) {
    case "complete":
      return (
        <Badge className="bg-green-100 text-green-800 border-green-300 dark:bg-green-900/40 dark:text-green-300 dark:border-green-700">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Approved
        </Badge>
      );
    case "error":
      return (
        <Badge className="bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-300 dark:border-red-700">
          <XCircle className="h-3 w-3 mr-1" />
          Denied
        </Badge>
      );
    case "queued":
    case "partial":
      return (
        <Badge className="bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700">
          <Clock className="h-3 w-3 mr-1" />
          Pended
        </Badge>
      );
    default:
      return <Badge variant="secondary">{outcome ?? "Unknown"}</Badge>;
  }
}
