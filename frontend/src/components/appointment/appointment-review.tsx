import type { Appointment, Resource } from "fhir/r4";
import {
  CalendarCheck,
  ChevronLeft,
  Code,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { CoverageDetermination } from "@/components/order-form/coverage-determination";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { DTR_COMPLETION_CHANNEL, launchSmartApp } from "@/lib/api";
import type {
  CdsCard as CdsCardType,
  CdsHookResponse,
  CoverageInformation,
} from "@/lib/cds-types";
import { formatClinicalDate } from "@/lib/clinical-formatters";
import { COVERAGE_INFO_EXT_URL, hasDtrDoc } from "@/lib/coverage-extensions";
import { AppointmentCdsPanel } from "./appointment-cds-panel";

function getPractitionerDisplay(appointment: Partial<Appointment>): string {
  const practitioner = appointment.participant?.find((p) =>
    p.actor?.reference?.startsWith("Practitioner/"),
  );
  return practitioner?.actor?.display ?? "Not assigned";
}

function getServiceTypeDisplay(appointment: Partial<Appointment>): string {
  return (
    appointment.serviceType?.[0]?.text ??
    appointment.serviceType?.[0]?.coding?.[0]?.display ??
    ""
  );
}

function formatTime(dateStr?: string): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

interface AppointmentReviewProps {
  appointment: Partial<Appointment>;
  coverageInfo: CoverageInformation[];
  cdsCards: CdsCardType[];
  rawResponse: CdsHookResponse | null;
  systemActionResources: Map<string, Resource>;
  isHookLoading: boolean;
  hookError: Error | null;
  patientId: string;
  /** Booking-specific props. When omitted, the default booking action bar is hidden. */
  isConfirming?: boolean;
  onConfirm?: () => void;
  onBack?: () => void;
  /** Custom action bar rendered instead of the default booking actions. */
  actions?: React.ReactNode;
}

export function AppointmentReview({
  appointment,
  coverageInfo,
  cdsCards,
  rawResponse,
  systemActionResources,
  isHookLoading,
  hookError,
  patientId,
  isConfirming,
  onConfirm,
  onBack,
  actions,
}: AppointmentReviewProps) {
  const { serverUrl } = useFhirServer();
  const { viewerData, openViewer, closeViewer } = useJsonViewer();
  const dtrNeeded = coverageInfo.some(hasDtrDoc);

  // Listen for DTR completion
  useEffect(() => {
    const channel = new BroadcastChannel(DTR_COMPLETION_CHANNEL);
    channel.onmessage = () => {
      toast.success("Documentation completed");
    };
    return () => channel.close();
  }, []);

  const handleDtrLaunch = useCallback(
    async (ci: CoverageInformation) => {
      try {
        const fhirContext: string[] = [];
        if (ci.coverage) fhirContext.push(ci.coverage);

        await launchSmartApp({
          patientId,
          fhirContext,
          coverageAssertionId: ci.coverageAssertionId,
          questionnaire: ci.questionnaire ?? [],
          providerFhirUrl: serverUrl,
        });
      } catch (err) {
        console.error("DTR launch failed:", err);
        toast.error("Failed to launch documentation");
      }
    },
    [patientId, serverUrl],
  );

  return (
    <div className="space-y-6">
      {/* Appointment Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Appointment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Practitioner</dt>
            <dd className="font-medium">
              {getPractitionerDisplay(appointment)}
            </dd>

            <dt className="text-muted-foreground">Date</dt>
            <dd className="font-medium">
              {formatClinicalDate(appointment.start)}
            </dd>

            <dt className="text-muted-foreground">Time</dt>
            <dd className="font-medium">{formatTime(appointment.start)}</dd>

            <dt className="text-muted-foreground">Service Type</dt>
            <dd className="font-medium">
              {getServiceTypeDisplay(appointment)}
            </dd>

            {appointment.reasonCode?.[0]?.text && (
              <>
                <dt className="text-muted-foreground">Reason</dt>
                <dd className="font-medium">
                  {appointment.reasonCode[0].text}
                </dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* CDS Response */}
      <AppointmentCdsPanel
        cards={cdsCards}
        isLoading={isHookLoading}
        hookError={hookError}
        patientId={patientId}
        rawResponse={rawResponse}
      />

      {/* Coverage Determination */}
      {coverageInfo.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Coverage Determination</CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const coverageExtensions = [
                    ...systemActionResources.values(),
                  ].flatMap((r) =>
                    ("extension" in r && Array.isArray(r.extension)
                      ? r.extension
                      : []
                    ).filter(
                      (ext: { url?: string }) =>
                        ext.url === COVERAGE_INFO_EXT_URL,
                    ),
                  );
                  openViewer(
                    coverageExtensions.length === 1
                      ? coverageExtensions[0]
                      : coverageExtensions,
                    "Coverage Information Extension",
                    "CRD ext-coverage-information extension from the system action response",
                  );
                }}
              >
                <Code className="h-3.5 w-3.5 mr-1" />
                View Extension
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <CoverageDetermination coverageInfo={coverageInfo} />
          </CardContent>
        </Card>
      )}

      {/* DTR Launch */}
      {dtrNeeded && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              Documentation Required
              <Badge className="bg-amber-500 text-white border-amber-500">
                Action Needed
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              The payer requires additional documentation for this appointment.
              Completing it now can speed up prior authorization.
            </p>
            {coverageInfo.filter(hasDtrDoc).map((ci) => (
              <Button
                key={ci.coverageAssertionId ?? "dtr"}
                variant="outline"
                size="sm"
                onClick={() => handleDtrLaunch(ci)}
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Complete Documentation
              </Button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      {actions ??
        (onConfirm && onBack && (
          <div className="flex gap-3">
            <Button variant="outline" onClick={onBack}>
              <ChevronLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            <Button
              className="flex-1"
              disabled={isConfirming}
              onClick={onConfirm}
            >
              {isConfirming ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CalendarCheck className="mr-2 h-4 w-4" />
              )}
              {isConfirming ? "Booking..." : "Confirm Booking"}
            </Button>
          </div>
        ))}

      {viewerData && (
        <JsonViewerDialog
          data={viewerData.data}
          title={viewerData.title}
          description={viewerData.description}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}
