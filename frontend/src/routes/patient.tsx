import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PatientSelfHeader } from "@/components/patient-self-header";
import { useAuth } from "@/hooks/use-auth";
import { usePatient } from "@/hooks/use-clinical-api";

export const Route = createFileRoute("/patient")({
  component: PatientLayout,
});

function PatientLayout() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";
  const { data: patient, isLoading } = usePatient(patientId);

  return (
    <div className="flex flex-col h-full">
      {isLoading ? (
        <div className="p-4 bg-card border-b">
          <div className="skeleton h-6 w-48 mb-2" />
          <div className="flex gap-3">
            <div className="skeleton h-4 w-24" />
            <div className="skeleton h-4 w-20" />
            <div className="skeleton h-4 w-16" />
          </div>
        </div>
      ) : (
        patient && <PatientSelfHeader patient={patient} />
      )}
      <div className="flex-1 min-h-0 overflow-auto">
        <Outlet />
      </div>
    </div>
  );
}
