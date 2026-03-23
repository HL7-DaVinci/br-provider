import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/patient/")({
  component: PatientDashboard,
});

function PatientDashboard() {
  return (
    <div className="p-6 md:p-10 max-w-3xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Patient Dashboard</h1>
      <p className="text-muted-foreground leading-relaxed max-w-[65ch]">
        View your clinical information, pending prior authorizations, and
        documentation requests.
      </p>
    </div>
  );
}
