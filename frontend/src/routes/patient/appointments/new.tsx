import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Appointment } from "fhir/r4";
import { CalendarCheck } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { AppointmentBookingForm } from "@/components/appointment/appointment-booking-form";
import { AppointmentReview } from "@/components/appointment/appointment-review";
import { PageBackLink } from "@/components/page-back-link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreateAppointment } from "@/hooks/use-appointment-api";
import { useAppointmentCdsHooks } from "@/hooks/use-appointment-cds-hooks";
import {
  AppointmentContextProvider,
  useAppointmentContext,
} from "@/hooks/use-appointment-context";
import { useAuth } from "@/hooks/use-auth";
import { usePayerServer } from "@/hooks/use-payer-server";

export const Route = createFileRoute("/patient/appointments/new")({
  component: NewAppointmentWrapper,
});

function NewAppointmentWrapper() {
  const { fhirUser, displayName } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";

  return (
    <AppointmentContextProvider patientId={patientId}>
      <NewAppointmentPage
        patientId={patientId}
        patientDisplay={displayName ?? ""}
      />
    </AppointmentContextProvider>
  );
}

function NewAppointmentPage({
  patientId,
  patientDisplay,
}: {
  patientId: string;
  patientDisplay: string;
}) {
  const { state, dispatch } = useAppointmentContext();
  const { cdsUrl } = usePayerServer();
  const { checkAppointmentCoverage, isLoading: isHookLoading } =
    useAppointmentCdsHooks(cdsUrl);
  const createAppointment = useCreateAppointment();
  const navigate = useNavigate();

  const handleFormSubmit = useCallback(
    async (appointment: Appointment, coverageRef: string | undefined) => {
      dispatch({ type: "SET_DRAFT", payload: appointment });
      if (coverageRef) {
        dispatch({ type: "SET_COVERAGE_REF", payload: coverageRef });
      }

      await checkAppointmentCoverage(appointment);

      dispatch({ type: "SET_PHASE", payload: "review" });
    },
    [dispatch, checkAppointmentCoverage],
  );

  const handleDocumentationCompleted = useCallback(async () => {
    if (!state.draftAppointment) return;
    await checkAppointmentCoverage(state.draftAppointment as Appointment);
  }, [state.draftAppointment, checkAppointmentCoverage]);

  const handleConfirmBooking = useCallback(async () => {
    if (!state.draftAppointment) return;

    try {
      const booked: Appointment = {
        ...(state.draftAppointment as Appointment),
        status: "booked",
      };
      await createAppointment.mutateAsync(booked);
      dispatch({ type: "SET_PHASE", payload: "booked" });
      toast.success("Appointment booked successfully");
    } catch (err) {
      toast.error(
        `Failed to book appointment: ${err instanceof Error ? err.message : "Unknown error"}`,
      );
    }
  }, [state.draftAppointment, createAppointment, dispatch]);

  const handleBack = useCallback(() => {
    dispatch({ type: "SET_PHASE", payload: "form" });
  }, [dispatch]);

  const isReview = state.bookingPhase === "review";

  return (
    <div className="p-6 md:p-10 max-w-7xl space-y-6">
      <div className="space-y-1">
        <PageBackLink to="/patient/appointments" label="Appointments" />
        <h1 className="text-lg font-semibold">Book an Appointment</h1>
      </div>

      {state.bookingPhase === "form" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Appointment Details</CardTitle>
          </CardHeader>
          <CardContent>
            <AppointmentBookingForm
              patientId={patientId}
              patientDisplay={patientDisplay}
              isSubmitting={isHookLoading}
              onSubmit={handleFormSubmit}
            />
          </CardContent>
        </Card>
      )}

      {isReview && state.draftAppointment && (
        <AppointmentReview
          appointment={state.draftAppointment}
          coverageInfo={state.coverageInfo}
          cdsCards={state.cdsCards}
          rawResponse={state.lastRawResponse}
          systemActionResources={state.systemActionResources}
          isHookLoading={state.isHookLoading}
          hookError={state.hookError}
          patientId={patientId}
          isConfirming={createAppointment.isPending}
          onConfirm={handleConfirmBooking}
          onBack={handleBack}
          onDocumentationCompleted={handleDocumentationCompleted}
        />
      )}

      {state.bookingPhase === "booked" && (
        <Card>
          <CardContent className="py-8 text-center space-y-4">
            <CalendarCheck className="mx-auto h-12 w-12 text-green-600" />
            <div>
              <h2 className="text-lg font-semibold">Appointment Booked</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Your appointment has been successfully scheduled.
              </p>
            </div>
            <Button
              variant="outline"
              onClick={() => navigate({ to: "/patient/appointments" })}
            >
              View All Appointments
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
