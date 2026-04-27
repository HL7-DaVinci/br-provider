import { createFileRoute, Link } from "@tanstack/react-router";
import type { Patient } from "fhir/r4";
import { useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { PatientSearch } from "@/components/patient-search";
import { Button } from "@/components/ui/button";
import { usePatientList, usePatientSearch } from "@/hooks/use-clinical-api";
import {
  calculateAge,
  formatClinicalDate,
  formatPatientName,
  getPrimaryIdentifier,
} from "@/lib/clinical-formatters";

export const Route = createFileRoute("/practitioner/")({
  component: PractitionerDashboard,
});

const patientColumns = [
  {
    header: "Name",
    accessor: (p: Patient) => (
      <Link
        to="/patients/$patientId"
        params={{ patientId: p.id ?? "" }}
        className="font-medium text-primary hover:underline"
      >
        {formatPatientName(p.name)}
      </Link>
    ),
  },
  {
    header: "DOB",
    accessor: (p: Patient) => formatClinicalDate(p.birthDate),
  },
  {
    header: "Age",
    accessor: (p: Patient) => calculateAge(p.birthDate),
  },
  {
    header: "Gender",
    accessor: (p: Patient) => (
      <span className="capitalize">{p.gender ?? ""}</span>
    ),
  },
  {
    header: "Identifier",
    accessor: (p: Patient) => getPrimaryIdentifier(p.identifier) ?? "",
    className: "font-mono text-xs",
  },
  {
    header: "Last Updated",
    accessor: (p: Patient) => formatClinicalDate(p.meta?.lastUpdated),
  },
];

function PractitionerDashboard() {
  const [searchParams, setSearchParams] = useState<{
    family?: string;
    given?: string;
    birthdate?: string;
    identifier?: string;
  }>({});
  const [pageUrl, setPageUrl] = useState<string | undefined>();

  const hasSearched = !!(
    searchParams.family ||
    searchParams.given ||
    searchParams.birthdate ||
    searchParams.identifier
  );

  const patientList = usePatientList(pageUrl);
  const searchResults = usePatientSearch(searchParams, pageUrl);

  const activeQuery = hasSearched ? searchResults : patientList;
  const { data, isLoading, isError, error } = activeQuery;

  const patients: Patient[] =
    data?.entry?.map((e) => e.resource).filter((r): r is Patient => !!r) ?? [];

  const links = data?.link ?? [];
  const nextLink = links.find((l) => l.relation === "next")?.url;
  const prevLink =
    links.find((l) => l.relation === "previous")?.url ??
    links.find((l) => l.relation === "prev")?.url;

  const handleSearch = (params: typeof searchParams) => {
    setSearchParams(params);
    setPageUrl(undefined);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <section>
        <h2 className="text-base font-semibold">Patient Search</h2>
        <p className="text-sm text-muted-foreground mt-0.5 mb-3">
          Search for patients by name, date of birth, or identifier
        </p>
        <PatientSearch onSearch={handleSearch} />
      </section>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to load patients"}
        </p>
      )}

      <section className="border-t pt-4">
        <h2 className="text-base font-semibold mb-3">
          {hasSearched ? "Results" : "Patients"}
          {!isLoading && data?.total !== undefined && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              (<span className="tabular">{data.total}</span>
              {hasSearched ? " found" : " total"})
            </span>
          )}
        </h2>
        <ClinicalTable
          loading={isLoading}
          keyExtractor={(p) => p.id ?? ""}
          columns={patientColumns}
          data={patients}
          emptyMessage={
            hasSearched
              ? "No patients found. Try adjusting your search criteria."
              : "No patients available."
          }
        />
        {(nextLink || prevLink) && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!prevLink}
              onClick={() => setPageUrl(prevLink)}
            >
              Previous
            </Button>
            {data?.total !== undefined && (
              <span className="text-sm text-muted-foreground">
                <span className="tabular">{data.total}</span> total
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={!nextLink}
              onClick={() => setPageUrl(nextLink)}
            >
              Next
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
