import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Appointment } from "fhir/r4";
import { CalendarPlus, ChevronLeft } from "lucide-react";
import { AppointmentList } from "@/components/appointment/appointment-list";
import { Button } from "@/components/ui/button";
import { useAppointments } from "@/hooks/use-appointment-api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/patient/appointments/")({
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useAppointments(patientId);

  const appointments: Appointment[] =
    data?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Appointment => r?.resourceType === "Appointment") ?? [];

  return (
    <div className="p-6 md:p-10 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link
            to="/patient"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Back to dashboard"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-lg font-semibold">My Appointments</h1>
        </div>
        <Link to="/patient/appointments/new">
          <Button size="sm">
            <CalendarPlus className="mr-2 h-4 w-4" />
            Book Appointment
          </Button>
        </Link>
      </div>

      {isError && (
        <p className="text-sm text-red-600">
          Failed to load appointments: {error?.message}
        </p>
      )}

      <AppointmentList
        appointments={appointments}
        loading={isLoading}
        onRowClick={(a) =>
          a.id &&
          navigate({
            to: "/patient/appointments/$appointmentId",
            params: { appointmentId: a.id },
          })
        }
      />
    </div>
  );
}
