import { createFileRoute } from "@tanstack/react-router";
import {
  type DtrTaskContext,
  DtrWorkspace,
} from "@/components/dtr/dtr-workspace";

export const Route = createFileRoute("/dtr/")({
  validateSearch: (search: Record<string, unknown>): DtrTaskContext => ({
    iss: (search.iss as string) ?? "",
    launch: search.launch as string | undefined,
    patientId: search.patientId as string | undefined,
    encounterId: search.encounterId as string | undefined,
    fhirContext: search.fhirContext as string | undefined,
    coverageRef: search.coverageRef as string | undefined,
    orderRef: search.orderRef as string | undefined,
    coverageAssertionId: search.coverageAssertionId as string | undefined,
    questionnaire: search.questionnaire as string | undefined,
    appContext: search.appContext as string | undefined,
  }),
  component: DtrFormPage,
});

function DtrFormPage() {
  return <DtrWorkspace context={Route.useSearch()} />;
}
