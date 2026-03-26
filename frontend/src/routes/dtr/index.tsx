import { createFileRoute, Link } from "@tanstack/react-router";
import type { QuestionnaireResponse } from "fhir/r4";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { LhcFormRenderer } from "@/components/questionnaire/lhc-form-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveDtrQuestionnaireResponseId } from "@/hooks/use-dtr-qr-store";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { usePayerServer } from "@/hooks/use-payer-server";
import { usePrePopulatedQr } from "@/hooks/use-prepopulated-qr";
import {
  useProviderPopulate,
  useQuestionnairePackage,
  useSaveQuestionnaireResponse,
} from "@/hooks/use-questionnaire";
import { normalizeServerUrl } from "@/lib/fhir-config";

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
  }),
  component: DtrFormPage,
});

function DtrFormPage() {
  const search = Route.useSearch();
  const { serverUrl: selectedProviderFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();
  const [savedStatus, setSavedStatus] = useState<
    "in-progress" | "completed" | null
  >(null);
  // Track the server-assigned ID so subsequent saves use PUT instead of POST
  const [savedResponseId, setSavedResponseId] = useState<string | undefined>();

  const providerFhirUrl = search.iss
    ? normalizeServerUrl(search.iss)
    : selectedProviderFhirUrl;

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
    questionnaire: search.questionnaire,
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

  const saveResponse = useSaveQuestionnaireResponse(providerFhirUrl);

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

      saveResponse.mutate(response, {
        onSuccess: (saved) => {
          if (saved?.id) setSavedResponseId(saved.id);
          if (status === "completed" && saved?.id && orderRef) {
            saveDtrQuestionnaireResponseId(orderRef, saved.id);
          }
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
              {search.patientId && (
                <> You may close this window or return to the patient record.</>
              )}
            </p>
            {search.patientId && (
              <Link
                to="/patients/$patientId"
                params={{ patientId: search.patientId }}
              >
                <Button variant="outline" className="w-full">
                  <ArrowLeft className="h-4 w-4 mr-1.5" />
                  Back to Patient
                </Button>
              </Link>
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
        {search.patientId && (
          <Link
            to="/patients/$patientId"
            params={{ patientId: search.patientId }}
            className="flex items-center gap-1 hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Patient
          </Link>
        )}
        {coverageRef && <span>Coverage: {coverageRef}</span>}
        {orderRef && <span>Order: {orderRef}</span>}
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
          <LhcFormRenderer
            questionnaire={packageData.questionnaire}
            prepopulated={mergedQr ?? undefined}
            originIndex={originIndex}
            onSave={handleSave}
            isSaving={saveResponse.isPending}
          />
        </div>
      )}
    </div>
  );
}
