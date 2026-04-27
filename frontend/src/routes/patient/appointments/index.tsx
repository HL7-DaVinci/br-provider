import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import type { Appointment } from "fhir/r4";
import { Calendar, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { AppointmentList } from "@/components/appointment/appointment-list";
import { EmptyState } from "@/components/empty-state";
import { PageBackLink } from "@/components/page-back-link";
import { Button } from "@/components/ui/button";
import {
  useAppointments,
  useDeleteAppointment,
} from "@/hooks/use-appointment-api";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/patient/appointments/")({
  component: AppointmentsPage,
});

function AppointmentsPage() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";
  const navigate = useNavigate();

  const { data, isLoading, isError, error } = useAppointments(patientId);
  const deleteAppointment = useDeleteAppointment();

  const appointments: Appointment[] =
    data?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Appointment => r?.resourceType === "Appointment") ?? [];

  const handleDelete = (appt: Appointment) => {
    if (!appt.id) return;
    deleteAppointment.mutate(appt.id, {
      onSuccess: () => toast.success("Appointment deleted"),
      onError: (err) =>
        toast.error(err instanceof Error ? err.message : "Delete failed"),
    });
  };

  return (
    <div className="p-6 md:p-10 max-w-7xl space-y-6">
      <div className="flex items-end justify-between">
        <div className="space-y-1">
          <PageBackLink to="/patient" label="Home" />
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

      {!isLoading && appointments.length === 0 && !isError ? (
        <EmptyState
          icon={Calendar}
          title="No appointments yet"
          description="Schedule your first visit to get started."
          action={
            <Link to="/patient/appointments/new">
              <Button size="sm">
                <CalendarPlus className="mr-2 h-4 w-4" />
                Book Appointment
              </Button>
            </Link>
          }
        />
      ) : (
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
          onDelete={handleDelete}
          deletingId={
            deleteAppointment.isPending
              ? (deleteAppointment.variables as string | undefined)
              : undefined
          }
        />
      )}
    </div>
  );
}
