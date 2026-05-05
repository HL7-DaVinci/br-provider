import { createFileRoute, useParams } from "@tanstack/react-router";
import { PatientDocumentationView } from "@/components/dtr/patient-documentation-view";

export const Route = createFileRoute("/patients/$patientId/documentation")({
  component: PatientDocumentationRoute,
});

function PatientDocumentationRoute() {
  const { patientId } = useParams({
    from: "/patients/$patientId/documentation",
  });

  return (
    <div className="p-6 md:p-10 max-w-7xl space-y-6">
      <h1 className="text-lg font-semibold">Documentation</h1>
      <PatientDocumentationView patientId={patientId} />
    </div>
  );
}
