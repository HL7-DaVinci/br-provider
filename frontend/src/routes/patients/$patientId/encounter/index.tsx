import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Encounter } from "fhir/r4";
import { ClipboardList, Loader2, Play } from "lucide-react";
import { ClinicalTable } from "@/components/clinical-table";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEncounters } from "@/hooks/use-clinical-api";
import { useCreateEncounter } from "@/hooks/use-create-encounter";
import { formatClinicalDate } from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patients/$patientId/encounter/")({
  component: EncounterListPage,
});

function EncounterListPage() {
  const { patientId } = Route.useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useEncounters(patientId);
  const { createEncounter, isCreating } = useCreateEncounter(patientId);

  const encounters: Encounter[] =
    data?.entry?.map((e) => e.resource).filter((r): r is Encounter => !!r) ??
    [];

  return (
    <div className="p-6 max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Encounters</h2>
        <Button size="sm" onClick={createEncounter} disabled={isCreating}>
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5 mr-1" />
          )}
          {isCreating ? "Starting..." : "Start New Encounter"}
        </Button>
      </div>

      {!isLoading && encounters.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No encounters yet"
          description="Start a new encounter to begin documenting a visit and placing orders."
          action={
            <Button size="sm" onClick={createEncounter} disabled={isCreating}>
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5 mr-1" />
              )}
              {isCreating ? "Starting..." : "Start New Encounter"}
            </Button>
          }
        />
      ) : (
        <ClinicalTable<Encounter>
          loading={isLoading}
          keyExtractor={(e) => e.id ?? ""}
          onRowClick={(encounter) => {
            if (encounter.id) {
              navigate({
                to: "/patients/$patientId/encounter/$encounterId",
                params: { patientId, encounterId: encounter.id },
              });
            }
          }}
          columns={[
            {
              header: "Status",
              accessor: (e) => (
                <Badge
                  variant={e.status === "in-progress" ? "default" : "secondary"}
                >
                  {e.status}
                </Badge>
              ),
            },
            {
              header: "Class",
              accessor: (e) => e.class?.display ?? e.class?.code ?? "",
            },
            {
              header: "Date",
              accessor: (e) => formatClinicalDate(e.period?.start),
            },
            {
              header: "ID",
              accessor: (e) => (
                <span className="font-mono text-xs">{e.id}</span>
              ),
            },
          ]}
          data={encounters}
        />
      )}
    </div>
  );
}
