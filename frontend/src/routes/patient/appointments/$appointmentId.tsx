import { createFileRoute } from "@tanstack/react-router";
import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { AppointmentReview } from "@/components/appointment/appointment-review";
import { PageBackLink } from "@/components/page-back-link";
import { Button } from "@/components/ui/button";
import { useAppointment } from "@/hooks/use-appointment-api";
import { useAppointmentCdsHooks } from "@/hooks/use-appointment-cds-hooks";
import {
  AppointmentContextProvider,
  useAppointmentContext,
} from "@/hooks/use-appointment-context";
import { useAuth } from "@/hooks/use-auth";
import { usePayerServer } from "@/hooks/use-payer-server";

export const Route = createFileRoute("/patient/appointments/$appointmentId")({
  component: AppointmentDetailWrapper,
});

function AppointmentDetailWrapper() {
  const { appointmentId } = Route.useParams();
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";

  return (
    <AppointmentContextProvider patientId={patientId}>
      <AppointmentDetailPage
        patientId={patientId}
        appointmentId={appointmentId}
      />
    </AppointmentContextProvider>
  );
}

function AppointmentDetailPage({
  patientId,
  appointmentId,
}: {
  patientId: string;
  appointmentId: string;
}) {
  const { state, dispatch } = useAppointmentContext();
  const { cdsUrl } = usePayerServer();
  const { checkAppointmentCoverage, isLoading: isHookLoading } =
    useAppointmentCdsHooks(cdsUrl);
  const {
    data: appointment,
    isLoading: isAppointmentLoading,
    isError,
    error,
  } = useAppointment(appointmentId);

  const handleCheckCoverage = useCallback(async () => {
    if (!appointment) return;
    dispatch({ type: "SET_DRAFT", payload: appointment });
    await checkAppointmentCoverage(appointment);
  }, [appointment, dispatch, checkAppointmentCoverage]);

  const autoFiredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!appointment?.id || appointment.status !== "booked") return;
    if (autoFiredFor.current === appointment.id) return;
    autoFiredFor.current = appointment.id;
    void handleCheckCoverage();
  }, [appointment?.id, appointment?.status, handleCheckCoverage]);

  if (isAppointmentLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !appointment) {
    return (
      <div className="p-6 md:p-10 max-w-7xl">
        <p className="text-sm text-red-600">
          Failed to load appointment: {error?.message ?? "Not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-7xl space-y-6">
      <div className="space-y-1">
        <PageBackLink to="/patient/appointments" label="Appointments" />
        <h1 className="text-lg font-semibold">Appointment Details</h1>
      </div>

      <AppointmentReview
        appointment={appointment}
        coverageInfo={state.coverageInfo}
        cdsCards={state.cdsCards}
        rawResponse={state.lastRawResponse}
        systemActionResources={state.systemActionResources}
        isHookLoading={state.isHookLoading}
        hookError={state.hookError}
        patientId={patientId}
        onDocumentationCompleted={handleCheckCoverage}
        actions={
          <Button
            className="flex-1"
            onClick={handleCheckCoverage}
            disabled={isHookLoading}
          >
            {isHookLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            {isHookLoading ? "Checking..." : "Check Coverage"}
          </Button>
        }
      />
    </div>
  );
}
