import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { Encounter } from "fhir/r4";
import { Play } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useEncounters } from "@/hooks/use-clinical-api";
import { useFhirServer } from "@/hooks/use-fhir-server";
import { fhirProxyUrl } from "@/lib/api";
import { formatClinicalDate } from "@/lib/clinical-formatters";

export const Route = createFileRoute("/patients/$patientId/encounter/")({
  component: EncounterListPage,
});

function EncounterListPage() {
  const { patientId } = Route.useParams();
  const { fhirUser } = useAuth();
  const practitionerId = fhirUser?.replace(/^Practitioner\//, "") ?? "";
  const { serverUrl } = useFhirServer();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading } = useEncounters(patientId);
  const [isCreating, setIsCreating] = useState(false);
  const createGuard = useRef(false);

  const encounters: Encounter[] =
    data?.entry?.map((e) => e.resource).filter((r): r is Encounter => !!r) ??
    [];

  const handleStartNew = useCallback(async () => {
    if (createGuard.current || !serverUrl) return;
    createGuard.current = true;
    setIsCreating(true);

    try {
      const encounter: Partial<Encounter> = {
        resourceType: "Encounter",
        status: "in-progress",
        class: {
          system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
          code: "AMB",
          display: "ambulatory",
        },
        subject: { reference: `Patient/${patientId}` },
        participant: practitionerId
          ? [
              {
                individual: {
                  reference: `Practitioner/${practitionerId}`,
                },
              },
            ]
          : [],
        period: { start: new Date().toISOString() },
      };

      const proxyUrl = fhirProxyUrl(`${serverUrl}/Encounter`);
      const response = await fetch(proxyUrl, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json" },
        body: JSON.stringify(encounter),
        credentials: "include",
      });

      if (!response.ok) {
        throw new Error(`Failed to create encounter: ${response.status}`);
      }

      const created = (await response.json()) as Encounter;
      queryClient.invalidateQueries({
        queryKey: ["fhir", "Encounter", "list", patientId, serverUrl],
      });
      navigate({
        to: "/patients/$patientId/encounter/$encounterId",
        params: { patientId, encounterId: created.id ?? "" },
      });
    } catch {
      createGuard.current = false;
      setIsCreating(false);
    }
  }, [serverUrl, patientId, practitionerId, navigate, queryClient]);

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Encounters</h2>
        <Button size="sm" onClick={handleStartNew} disabled={isCreating}>
          <Play className="h-3.5 w-3.5 mr-1" />
          {isCreating ? "Starting..." : "Start New Encounter"}
        </Button>
      </div>

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
            accessor: (e) => <span className="font-mono text-xs">{e.id}</span>,
          },
        ]}
        data={encounters}
        emptyMessage="No encounters found for this patient."
      />
    </div>
  );
}
