import type { Appointment } from "fhir/r4";
import { ClinicalTable } from "@/components/clinical-table";
import { DeleteConfirmButton } from "@/components/delete-confirm-button";
import { Badge } from "@/components/ui/badge";
import { formatClinicalDate } from "@/lib/clinical-formatters";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<string, string> = {
  proposed: "bg-amber-500 text-white border-amber-500",
  booked: "bg-blue-600 text-white border-blue-600",
  fulfilled: "bg-green-600 text-white border-green-600",
  cancelled: "bg-red-600 text-white border-red-600",
  noshow: "bg-gray-500 text-white border-gray-500",
};

function getPractitionerDisplay(appointment: Appointment): string {
  const practitioner = appointment.participant?.find((p) =>
    p.actor?.reference?.startsWith("Practitioner/"),
  );
  return practitioner?.actor?.display ?? "Not assigned";
}

function getServiceTypeDisplay(appointment: Appointment): string {
  return (
    appointment.serviceType?.[0]?.text ??
    appointment.serviceType?.[0]?.coding?.[0]?.display ??
    ""
  );
}

function formatAppointmentTime(dateStr?: string): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

const baseColumns = [
  {
    header: "Status",
    accessor: (a: Appointment) => (
      <Badge className={cn(STATUS_STYLES[a.status ?? ""] ?? "bg-gray-400")}>
        {a.status ?? "unknown"}
      </Badge>
    ),
  },
  {
    header: "Date",
    accessor: (a: Appointment) => formatClinicalDate(a.start),
  },
  {
    header: "Time",
    accessor: (a: Appointment) => formatAppointmentTime(a.start),
  },
  {
    header: "Practitioner",
    accessor: (a: Appointment) => getPractitionerDisplay(a),
  },
  {
    header: "Service Type",
    accessor: (a: Appointment) => getServiceTypeDisplay(a),
  },
  {
    header: "Reason",
    accessor: (a: Appointment) => a.reasonCode?.[0]?.text ?? "",
  },
];

interface AppointmentListProps {
  appointments: Appointment[];
  loading?: boolean;
  onRowClick?: (appointment: Appointment) => void;
  onDelete?: (appointment: Appointment) => void;
  deletingId?: string;
}

export function AppointmentList({
  appointments,
  loading,
  onRowClick,
  onDelete,
  deletingId,
}: AppointmentListProps) {
  const columns = onDelete
    ? [
        ...baseColumns,
        {
          header: "",
          className: "w-10 text-right",
          accessor: (a: Appointment) => (
            <div className="flex justify-end">
              <DeleteConfirmButton
                onConfirm={() => onDelete(a)}
                isPending={deletingId === a.id}
                resourceLabel="appointment"
              />
            </div>
          ),
        },
      ]
    : baseColumns;

  return (
    <ClinicalTable
      columns={columns}
      data={appointments}
      keyExtractor={(a) => a.id ?? ""}
      loading={loading}
      emptyMessage="No appointments found"
      onRowClick={onRowClick}
    />
  );
}
