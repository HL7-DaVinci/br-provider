import { createFileRoute, Link } from "@tanstack/react-router";
import type { Bundle } from "fhir/r4";
import { ChevronLeft, Loader2, RefreshCw } from "lucide-react";
import { useCallback } from "react";
import { AppointmentReview } from "@/components/appointment/appointment-review";
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
  const { fireHook, isLoading: isHookLoading } = useAppointmentCdsHooks(cdsUrl);
  const {
    data: appointment,
    isLoading: isAppointmentLoading,
    isError,
    error,
  } = useAppointment(appointmentId);

  const handleCheckCoverage = useCallback(async () => {
    if (!appointment) return;

    dispatch({ type: "SET_DRAFT", payload: appointment });

    const appointmentsBundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: appointment }],
    };

    await fireHook("appointment-book", {
      userId: `Patient/${patientId}`,
      patientId,
      appointments: appointmentsBundle,
    });
  }, [appointment, dispatch, fireHook, patientId]);

  if (isAppointmentLoading) {
    return (
      <div className="flex items-center justify-center p-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !appointment) {
    return (
      <div className="p-6 md:p-10 max-w-2xl">
        <p className="text-sm text-red-600">
          Failed to load appointment: {error?.message ?? "Not found"}
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-10 max-w-2xl space-y-6">
      <h1 className="text-lg font-semibold">Appointment Details</h1>

      <AppointmentReview
        appointment={appointment}
        coverageInfo={state.coverageInfo}
        cdsCards={state.cdsCards}
        rawResponse={state.lastRawResponse}
        systemActionResources={state.systemActionResources}
        isHookLoading={state.isHookLoading}
        hookError={state.hookError}
        patientId={patientId}
        actions={
          <div className="flex gap-3">
            <Link to="/patient/appointments">
              <Button variant="outline">
                <ChevronLeft className="mr-2 h-4 w-4" />
                All Appointments
              </Button>
            </Link>
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
          </div>
        }
      />
    </div>
  );
}
