import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Extension, Questionnaire, QuestionnaireResponse } from "fhir/r4";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AdaptiveDtrForm } from "@/components/questionnaire/adaptive-dtr-form";
import { LhcFormRenderer } from "@/components/questionnaire/lhc-form-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { invalidateOrderQueries } from "@/hooks/use-clinical-api";
import { saveDtrQuestionnaireResponseId } from "@/hooks/use-dtr-qr-store";
import { fhirFetch } from "@/hooks/use-fhir-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { usePayerServer } from "@/hooks/use-payer-server";
import { usePrePopulatedQr } from "@/hooks/use-prepopulated-qr";
import {
  useProviderPopulate,
  useQuestionnairePackage,
  useSaveQuestionnaireResponse,
} from "@/hooks/use-questionnaire";
import { DTR_COMPLETION_CHANNEL, fhirProxyUrl } from "@/lib/api";
import {
  COVERAGE_INFO_EXT_URL,
  parseExtensionFields,
} from "@/lib/coverage-extensions";
import { parseQuestionnaireSearch } from "@/lib/dtr-search";
import { normalizeServerUrl } from "@/lib/fhir-config";

const ADAPTIVE_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-questionnaireAdaptive";

function isAdaptiveQuestionnaire(q: Questionnaire): boolean {
  return q.extension?.some((e) => e.url === ADAPTIVE_EXT_URL) ?? false;
}

interface DtrSearch {
  iss: string;
  launch?: string;
  patientId?: string;
  encounterId?: string;
  fhirContext?: string;
  coverageRef?: string;
  orderRef?: string;
  coverageAssertionId?: string;
  questionnaire?: string;
  appContext?: string;
}

export const Route = createFileRoute("/dtr/")({
  validateSearch: (search: Record<string, unknown>): DtrSearch => ({
    iss: (search.iss as string) ?? "",
    launch: search.launch as string | undefined,
    patientId: search.patientId as string | undefined,
    encounterId: search.encounterId as string | undefined,
    fhirContext: search.fhirContext as string | undefined,
    coverageRef: search.coverageRef as string | undefined,
    orderRef: search.orderRef as string | undefined,
    coverageAssertionId: search.coverageAssertionId as string | undefined,
    questionnaire: search.questionnaire as string | undefined,
    appContext: search.appContext as string | undefined,
  }),
  component: DtrFormPage,
});

// -- DTR qr-context extension for order linkage --

const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

/**
 * Add or update the DTR qr-context extension on a QuestionnaireResponse.
 * This links the QR to the order it was completed for, enabling
 * server-side search via `QuestionnaireResponse?context=`.
 */
function upsertQrContextExtension(
  extensions: Extension[],
  orderRef: string,
): Extension[] {
  const filtered = extensions.filter((e) => e.url !== QR_CONTEXT_EXT_URL);
  filtered.push({
    url: QR_CONTEXT_EXT_URL,
    valueReference: { reference: orderRef },
  });
  return filtered;
}

function DtrFormPage() {
  const search = Route.useSearch();
  const { serverUrl: selectedProviderFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();
  const { fhirUserType } = useAuth();
  const isPatientUser = fhirUserType === "Patient";
  const queryClient = useQueryClient();
  const [savedStatus, setSavedStatus] = useState<
    "in-progress" | "completed" | null
  >(null);
  // Track the server-assigned ID so subsequent saves use PUT instead of POST
  const [savedResponseId, setSavedResponseId] = useState<string | undefined>();

  const providerFhirUrl = search.iss
    ? normalizeServerUrl(search.iss)
    : selectedProviderFhirUrl;
  const questionnaireCanonicals = parseQuestionnaireSearch(
    search.questionnaire,
  );

  // Parse fhirContext references from comma-separated string
  const fhirContextRefs = search.fhirContext?.split(",").filter(Boolean) ?? [];

  // Derive coverage and order refs from fhirContext if not explicitly provided
  const coverageRef =
    search.coverageRef ??
    fhirContextRefs.find((r) => r.startsWith("Coverage/"));
  const orderRef =
    search.orderRef ??
    fhirContextRefs.find(
      (r) =>
        r.startsWith("ServiceRequest/") ||
        r.startsWith("MedicationRequest/") ||
        r.startsWith("DeviceRequest/") ||
        r.startsWith("NutritionOrder/") ||
        r.startsWith("VisionPrescription/") ||
        r.startsWith("CommunicationRequest/"),
    );

  // Detect existing QR reference in fhirContext for resume
  const existingQrRef = fhirContextRefs.find((ref) =>
    ref.startsWith("QuestionnaireResponse/"),
  );
  const existingQrId = existingQrRef?.split("/")[1];

  // Load the existing QR from the server when resuming
  const { data: existingQr } = useQuery({
    queryKey: ["fhir", "QuestionnaireResponse", existingQrId],
    queryFn: () =>
      fhirFetch<QuestionnaireResponse>(
        `${providerFhirUrl}/QuestionnaireResponse/${existingQrId}`,
      ),
    enabled: !!existingQrId && !!providerFhirUrl,
  });

  // Initialize savedResponseId from existing QR so saves use PUT
  useEffect(() => {
    if (existingQr?.id && !savedResponseId) {
      setSavedResponseId(existingQr.id);
    }
  }, [existingQr?.id, savedResponseId]);

  const {
    data: packageData,
    isLoading,
    isError,
    error,
  } = useQuestionnairePackage({
    payerFhirUrl,
    providerFhirUrl,
    coverageRef,
    orderRef,
    coverageAssertionId: search.coverageAssertionId,
    questionnaire: questionnaireCanonicals,
  });

  // Provider-side pre-population via server-side CQL evaluation
  const { data: providerQr } = useProviderPopulate({
    payerFhirUrl,
    contentServerUrl: packageData?.contentServerUrl,
    terminologyServerUrl: packageData?.terminologyServerUrl,
    questionnaire: packageData?.questionnaire ?? null,
    patientId: search.patientId,
  });

  // Merge payer + provider QRs with information-origin tracking
  const { mergedQr, originIndex } = usePrePopulatedQr({
    payerQr: packageData?.questionnaireResponse ?? null,
    providerQr: providerQr ?? null,
  });

  // When resuming, use the existing QR as the initial form state;
  // otherwise fall back to the merged payer+provider prepopulation
  const initialQr = existingQr ?? mergedQr;

  const saveResponse = useSaveQuestionnaireResponse(providerFhirUrl);

  /**
   * Extract the matching coverage-information block from a completed QR
   * and write it back to the order resource, replacing only the matching block.
   */
  const propagateCoverageInfo = useCallback(
    async (qr: QuestionnaireResponse) => {
      if (!orderRef || !providerFhirUrl) return;

      const matchingCoverageInfoExt = (qr.extension ?? []).find((ext) => {
        if (ext.url !== COVERAGE_INFO_EXT_URL || !ext.extension) return false;
        const parsed = parseExtensionFields(ext.extension);
        return (
          parsed.coverage === coverageRef ||
          parsed.coverageAssertionId === search.coverageAssertionId
        );
      });

      // No coverage-information on the QR -- this is expected until payer-side
      // output includes it. The mechanism is in place for when it does.
      if (!matchingCoverageInfoExt) return;

      const orderUrl = `${providerFhirUrl}/${orderRef}`;
      const orderResponse = await fetch(fhirProxyUrl(orderUrl), {
        credentials: "same-origin",
      });
      if (!orderResponse.ok) return;
      const order = await orderResponse.json();

      // Replace only the matching coverage-information block
      order.extension = (order.extension ?? []).map((ext: Extension) => {
        if (ext.url !== COVERAGE_INFO_EXT_URL || !ext.extension) return ext;
        const parsed = parseExtensionFields(ext.extension);
        const isMatch =
          parsed.coverage === coverageRef ||
          parsed.coverageAssertionId === search.coverageAssertionId;
        return isMatch ? matchingCoverageInfoExt : ext;
      });

      await fetch(fhirProxyUrl(orderUrl), {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        credentials: "same-origin",
        body: JSON.stringify(order),
      });

      // Invalidate order caches so the encounter review page refreshes
      invalidateOrderQueries(queryClient);
    },
    [
      orderRef,
      providerFhirUrl,
      coverageRef,
      search.coverageAssertionId,
      queryClient,
    ],
  );

  /**
   * Notify the parent encounter page that DTR has completed so it
   * can refetch order data immediately.
   */
  const notifyDtrCompletion = useCallback(() => {
    try {
      const channel = new BroadcastChannel(DTR_COMPLETION_CHANNEL);
      channel.postMessage({ type: "dtr-completed", orderRef });
      channel.close();
    } catch {
      // BroadcastChannel not supported -- parent will pick up changes on
      // next stale-time refetch
    }
  }, [orderRef]);

  const handleSave = useCallback(
    (response: QuestionnaireResponse, status: "in-progress" | "completed") => {
      // Attach patient and context references
      if (search.patientId) {
        response.subject = { reference: `Patient/${search.patientId}` };
      }
      if (search.encounterId) {
        response.encounter = { reference: `Encounter/${search.encounterId}` };
      }

      if (savedResponseId) {
        response.id = savedResponseId;
      }

      // Persist order linkage via qr-context extension and basedOn
      if (orderRef) {
        response.extension = upsertQrContextExtension(
          response.extension ?? [],
          orderRef,
        );

        // basedOn is only valid for ServiceRequest on QuestionnaireResponse in R4
        if (orderRef.startsWith("ServiceRequest/")) {
          response.basedOn = [{ reference: orderRef }];
        }
      }

      // Preserve top-level extensions from the source QR that LHC-Forms
      // export does not carry over (e.g., coverage-information extensions).
      const sourceQr = existingQr ?? mergedQr;
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
          if (saved?.id && orderRef) {
            saveDtrQuestionnaireResponseId(orderRef, saved.id);
          }

          // On completion, propagate coverage-information back to order
          if (status === "completed" && saved && orderRef) {
            await propagateCoverageInfo(saved);
          }

          // Notify parent encounter page so it can refresh DTR status
          notifyDtrCompletion();

          setSavedStatus(status);
        },
      });
    },
    [
      search.patientId,
      search.encounterId,
      saveResponse,
      savedResponseId,
      orderRef,
      existingQr,
      mergedQr,
      propagateCoverageInfo,
      notifyDtrCompletion,
    ],
  );

  // Clear the draft-saved flash after it renders once
  useEffect(() => {
    if (savedStatus === "in-progress") {
      setSavedStatus(null);
    }
  }, [savedStatus]);

  if (savedStatus === "completed") {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Documentation Complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              The questionnaire response has been saved to the FHIR server.
              {(isPatientUser || search.patientId) && (
                <> You may close this window or return to the patient record.</>
              )}
            </p>
            {isPatientUser ? (
              <Link to="/patient">
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Back to Patient
                </Button>
              </Link>
            ) : (
              search.patientId && (
                <Link
                  to="/patients/$patientId"
                  params={{ patientId: search.patientId }}
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
      {/* Context bar */}
      <div className="mb-4 shrink-0 flex items-center gap-4 text-sm text-muted-foreground">
        {isPatientUser ? (
          <Link
            to="/patient"
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Patient
          </Link>
        ) : (
          search.patientId && (
            <Link
              to="/patients/$patientId"
              params={{ patientId: search.patientId }}
              className="flex items-center gap-1 hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Patient
            </Link>
          )
        )}
        {coverageRef && <span>Coverage: {coverageRef}</span>}
        {orderRef && <span>Order: {orderRef}</span>}
        {existingQr && (
          <span className="text-amber-600 dark:text-amber-400">
            Resuming: QuestionnaireResponse/{existingQr.id}
          </span>
        )}
      </div>

      {/* Loading state */}
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

      {/* Error state */}
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

      {/* No questionnaire found */}
      {!isLoading && !isError && !packageData?.questionnaire && (
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

      {/* Questionnaire form */}
      {packageData?.questionnaire && (
        <div className="min-h-0 flex-1">
          {isAdaptiveQuestionnaire(packageData.questionnaire) ? (
            <AdaptiveDtrForm
              questionnaire={packageData.questionnaire}
              prepopulated={initialQr ?? undefined}
              originIndex={originIndex}
              onSave={handleSave}
              isSaving={saveResponse.isPending}
              payerFhirUrl={payerFhirUrl}
            />
          ) : (
            <LhcFormRenderer
              questionnaire={packageData.questionnaire}
              prepopulated={initialQr ?? undefined}
              originIndex={originIndex}
              onSave={handleSave}
              isSaving={saveResponse.isPending}
            />
          )}
        </div>
      )}
    </div>
  );
}
