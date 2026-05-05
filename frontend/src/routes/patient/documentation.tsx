import { createFileRoute } from "@tanstack/react-router";
import { PatientDocumentationView } from "@/components/dtr/patient-documentation-view";
import { PageBackLink } from "@/components/page-back-link";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/patient/documentation")({
  component: DocumentationPage,
});

function DocumentationPage() {
  const { fhirUser } = useAuth();
  const patientId = fhirUser?.replace(/^Patient\//, "") ?? "";

  return (
    <div className="p-6 md:p-10 max-w-7xl space-y-6">
      <div className="space-y-1">
        <PageBackLink to="/patient" label="Home" />
        <h1 className="text-lg font-semibold">Documentation</h1>
      </div>
      <PatientDocumentationView patientId={patientId} />
    </div>
  );
}
