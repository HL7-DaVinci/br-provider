import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/patients/$patientId/encounter")({
  component: EncounterLayout,
});

function EncounterLayout() {
  return <Outlet />;
}
