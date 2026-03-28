import { createFileRoute, Link } from "@tanstack/react-router";
import type { ClaimResponse, Coverage, Extension, Resource } from "fhir/r4";
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
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useCoverage, usePatient } from "@/hooks/use-clinical-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { usePasInquiry, usePasSubmit } from "@/hooks/use-pas";
import { usePayerServer } from "@/hooks/use-payer-server";
import {
  formatClinicalDate,
  formatPatientName,
} from "@/lib/clinical-formatters";

interface PasSearch {
  coverageId?: string;
  qrIds?: string;
  orderType?: string;
}

export const Route = createFileRoute(
  "/patients/$patientId/orders/$orderId/pas",
)({
  component: PasPage,
  validateSearch: (search: Record<string, unknown>): PasSearch => ({
    coverageId: (search.coverageId as string) ?? undefined,
    qrIds: (search.qrIds as string) ?? undefined,
    orderType: (search.orderType as string) ?? undefined,
  }),
});

function PasPage() {
  const { patientId, orderId } = Route.useParams();
  const { coverageId, qrIds, orderType } = Route.useSearch();
  const { serverUrl: providerFhirUrl } = useFhirServer();
  const { fhirUrl: payerFhirUrl } = usePayerServer();

  const { data: patient } = usePatient(patientId);
  const { data: coverageBundle } = useCoverage(patientId);
  const coverage = coverageId
    ? (coverageBundle?.entry?.find(
        (e) => (e.resource as Resource)?.id === coverageId,
      )?.resource as Coverage | undefined)
    : (coverageBundle?.entry?.[0]?.resource as Coverage | undefined);

  const resolvedCoverageId = coverageId ?? coverage?.id;
  const resolvedOrderType = orderType ?? "ServiceRequest";
  const questionnaireResponseIds = qrIds
    ? qrIds.split(",").filter(Boolean)
    : [];

  const pasSubmit = usePasSubmit();

  // After submission, track the ClaimResponse for status polling
  const [claimResponse, setClaimResponse] = useState<ClaimResponse | null>(
    null,
  );

  const pasInquiry = usePasInquiry(
    claimResponse?.id
      ? { claimResponseId: claimResponse.id, payerFhirUrl }
      : undefined,
  );

  const latestResponse =
    (pasInquiry.data as ClaimResponse | undefined) ?? claimResponse;
  const isPended =
    latestResponse?.outcome === "queued" ||
    latestResponse?.outcome === "partial";

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
        onSuccess: (data) => {
          setClaimResponse(data as ClaimResponse);
        },
      },
    );
  }

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
            <ul className="space-y-1">
              {questionnaireResponseIds.map((qrId) => (
                <li key={qrId} className="flex items-center gap-2 text-sm">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-mono text-xs">
                    QuestionnaireResponse/{qrId}
                  </span>
                </li>
              ))}
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
        <PasResponseDisplay
          claimResponse={latestResponse}
          isPolling={isPended && pasInquiry.isFetching}
        />
      )}

      {/* Error Display */}
      {pasSubmit.isError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
          <div className="flex items-center gap-2 text-red-700 dark:text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="text-sm">{pasSubmit.error.message}</p>
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
