import { createFileRoute } from "@tanstack/react-router";
import type { Coverage } from "fhir/r4";
import { Code } from "lucide-react";
import { CoverageInfo } from "@/components/coverage-info";
import {
  JsonViewerDialog,
  useJsonViewer,
} from "@/components/json-viewer-dialog";
import { Button } from "@/components/ui/button";
import { useCoverage, useOrganization } from "@/hooks/use-clinical-api";

export const Route = createFileRoute("/patients/$patientId/coverage")({
  component: CoverageDetail,
});

function CoverageDetail() {
  const { patientId } = Route.useParams();
  const { data: coverageBundle, isLoading: coverageLoading } =
    useCoverage(patientId);
  const { viewerData, openViewer, closeViewer } = useJsonViewer();

  const coverages: Coverage[] =
    coverageBundle?.entry
      ?.map((e) => e.resource)
      .filter((r): r is Coverage => !!r) ?? [];

  if (coverageLoading) {
    return (
      <div className="p-6 max-w-7xl space-y-3">
        <div className="skeleton h-4 w-32" />
        <div className="skeleton h-4 w-64" />
        <div className="skeleton h-4 w-48" />
      </div>
    );
  }

  if (coverages.length === 0) {
    return (
      <div className="p-6 max-w-7xl">
        <h2 className="text-base font-semibold mb-3">Coverage</h2>
        <p className="text-sm text-muted-foreground">
          No coverage records found for this patient.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl space-y-4">
      <h2 className="text-base font-semibold">
        Coverage
        <span className="ml-2 text-sm font-normal text-muted-foreground">
          (<span className="tabular">{coverages.length}</span>)
        </span>
      </h2>
      {coverages.map((coverage) => (
        <CoverageCard
          key={coverage.id}
          coverage={coverage}
          onViewRaw={() =>
            openViewer(
              coverage,
              coverage.id ? `Coverage/${coverage.id}` : "Coverage",
              "Raw JSON representation",
            )
          }
        />
      ))}
      {viewerData && (
        <JsonViewerDialog
          data={viewerData.data}
          title={viewerData.title}
          description={viewerData.description}
          onClose={closeViewer}
        />
      )}
    </div>
  );
}

function CoverageCard({
  coverage,
  onViewRaw,
}: {
  coverage: Coverage;
  onViewRaw: () => void;
}) {
  const orgRef =
    Array.isArray(coverage.payor) && coverage.payor[0]?.reference
      ? coverage.payor[0].reference
      : undefined;
  const orgId = orgRef ? orgRef.split("/")[1] : undefined;
  const { data: orgData, isLoading: orgLoading } = useOrganization(orgId);

  return (
    <div className="rounded-md border p-4">
      <div className="mb-2 flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onViewRaw}
        >
          <Code className="h-3.5 w-3.5 mr-1" />
          View Raw
        </Button>
      </div>
      <CoverageInfo
        coverage={coverage}
        coverageLoading={false}
        orgLoading={orgLoading}
        orgData={orgData}
        orgId={orgId}
      />
    </div>
  );
}
