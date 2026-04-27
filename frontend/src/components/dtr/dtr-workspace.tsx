import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { Extension, Questionnaire, QuestionnaireResponse } from "fhir/r4";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import { fhirProxyUrl } from "@/lib/api";
import {
  COVERAGE_INFO_EXT_URL,
  parseExtensionFields,
} from "@/lib/coverage-extensions";
import { broadcastDtrCompletion } from "@/lib/dtr-completion";
import { parseQuestionnaireSearch } from "@/lib/dtr-search";
import { normalizeServerUrl } from "@/lib/fhir-config";
import { isTerminalQrStatus, type TerminalQrStatus } from "@/lib/qr-status";

const ADAPTIVE_EXT_URL =
  "http://hl7.org/fhir/uv/sdc/StructureDefinition/sdc-questionnaire-questionnaireAdaptive";

const QR_CONTEXT_EXT_URL =
  "http://hl7.org/fhir/us/davinci-dtr/StructureDefinition/qr-context";

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
  appContext?: string;
}

interface DtrWorkspaceProps {
  context: DtrTaskContext;
  onClose?: () => void;
}

function isAdaptiveQuestionnaire(q: Questionnaire): boolean {
  return q.extension?.some((e) => e.url === ADAPTIVE_EXT_URL) ?? false;
}

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
  const [editingInitialized, setEditingInitialized] = useState<boolean>(false);

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
        r.startsWith("CommunicationRequest/"),
    );

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

  useEffect(() => {
    if (existingQr?.id && !savedResponseId) {
      setSavedResponseId(existingQr.id);
    }
  }, [existingQr?.id, savedResponseId]);

  useEffect(() => {
    if (editingInitialized) return;
    if (existingQrId && !existingQr) return;
    setIsEditing(!isTerminalQrStatus(existingQr?.status));
    setEditingInitialized(true);
  }, [existingQr, existingQrId, editingInitialized]);

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
    coverageAssertionId: context.coverageAssertionId,
    questionnaire: questionnaireCanonicals,
  });

  const { data: providerQr } = useProviderPopulate({
    payerFhirUrl,
    contentServerUrl: packageData?.contentServerUrl,
    terminologyServerUrl: packageData?.terminologyServerUrl,
    questionnaire: packageData?.questionnaire ?? null,
    patientId: context.patientId,
  });

  const { mergedQr, originIndex } = usePrePopulatedQr({
    payerQr: packageData?.questionnaireResponse ?? null,
    providerQr: providerQr ?? null,
  });

  const initialQr = existingQr ?? mergedQr;
  const saveResponse = useSaveQuestionnaireResponse(providerFhirUrl);

  const propagateCoverageInfo = useCallback(
    async (qr: QuestionnaireResponse) => {
      if (!orderRef || !providerFhirUrl) return;

      const matchingCoverageInfoExt = (qr.extension ?? []).find((ext) => {
        if (ext.url !== COVERAGE_INFO_EXT_URL || !ext.extension) return false;
        const parsed = parseExtensionFields(ext.extension);
        return (
          parsed.coverage === coverageRef ||
          parsed.coverageAssertionId === context.coverageAssertionId
        );
      });

      if (!matchingCoverageInfoExt) return;

      const orderUrl = `${providerFhirUrl}/${orderRef}`;
      const orderResponse = await fetch(fhirProxyUrl(orderUrl), {
        credentials: "same-origin",
      });
      if (!orderResponse.ok) return;
      const order = await orderResponse.json();

      order.extension = (order.extension ?? []).map((ext: Extension) => {
        if (ext.url !== COVERAGE_INFO_EXT_URL || !ext.extension) return ext;
        const parsed = parseExtensionFields(ext.extension);
        const isMatch =
          parsed.coverage === coverageRef ||
          parsed.coverageAssertionId === context.coverageAssertionId;
        return isMatch ? matchingCoverageInfoExt : ext;
      });

      await fetch(fhirProxyUrl(orderUrl), {
        method: "PUT",
        headers: { "Content-Type": "application/fhir+json" },
        credentials: "same-origin",
        body: JSON.stringify(order),
      });

      invalidateOrderQueries(queryClient);
    },
    [
      orderRef,
      providerFhirUrl,
      coverageRef,
      context.coverageAssertionId,
      queryClient,
    ],
  );

  const notifyDtrCompletion = useCallback(
    (
      response: QuestionnaireResponse,
      status: "in-progress" | TerminalQrStatus,
    ) => {
      broadcastDtrCompletion({
        status,
        orderRef,
        patientId: context.patientId,
        coverageRef,
        coverageAssertionId: context.coverageAssertionId,
        fhirContext: fhirContextRefs,
        questionnaireResponseId: response.id,
      });
    },
    [
      orderRef,
      context.patientId,
      context.coverageAssertionId,
      coverageRef,
      fhirContextRefs,
    ],
  );

  const handleSave = useCallback(
    (response: QuestionnaireResponse, status: "in-progress" | "completed") => {
      const persistedStatus: "in-progress" | TerminalQrStatus =
        isTerminalQrStatus(existingQr?.status) ? "amended" : status;
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

      if (orderRef) {
        response.extension = upsertQrContextExtension(
          response.extension ?? [],
          orderRef,
        );

        if (orderRef.startsWith("ServiceRequest/")) {
          response.basedOn = [{ reference: orderRef }];
        }
      }

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

          if (isTerminalQrStatus(persistedStatus) && saved && orderRef) {
            await propagateCoverageInfo(saved);
          }

          queryClient.invalidateQueries({
            queryKey: ["fhir", "QuestionnaireResponse"],
          });
          notifyDtrCompletion(saved, persistedStatus);
          setSavedStatus(persistedStatus);
        },
      });
    },
    [
      context.patientId,
      context.encounterId,
      saveResponse,
      savedResponseId,
      orderRef,
      existingQr,
      mergedQr,
      propagateCoverageInfo,
      notifyDtrCompletion,
      queryClient,
    ],
  );

  useEffect(() => {
    if (savedStatus === "in-progress") {
      setSavedStatus(null);
    }
  }, [savedStatus]);

  if (isTerminalQrStatus(savedStatus)) {
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
        {existingQr && (
          <>
            <span className="text-amber-600 dark:text-amber-400">
              {existingQr.status === "in-progress"
                ? "Resuming"
                : isEditing
                  ? "Amending"
                  : "Viewing"}
              : QuestionnaireResponse/{existingQr.id}
            </span>
            {isTerminalQrStatus(existingQr.status) && !isEditing && (
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
              readOnly={!isEditing}
              allowInProgressSave={!isTerminalQrStatus(existingQr?.status)}
            />
          ) : (
            <LhcFormRenderer
              questionnaire={packageData.questionnaire}
              prepopulated={initialQr ?? undefined}
              originIndex={originIndex}
              onSave={handleSave}
              isSaving={saveResponse.isPending}
              readOnly={!isEditing}
              allowInProgressSave={!isTerminalQrStatus(existingQr?.status)}
            />
          )}
        </div>
      )}
    </div>
  );
}
