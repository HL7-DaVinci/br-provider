import { createFileRoute, Link } from "@tanstack/react-router";
import type { Patient } from "fhir/r4";
import { useState } from "react";
import { ClinicalTable } from "@/components/clinical-table";
import { PatientSearch } from "@/components/patient-search";
import { usePatientSearch } from "@/hooks/use-clinical-api";
import {
  calculateAge,
  formatClinicalDate,
  formatPatientName,
  getPrimaryIdentifier,
} from "@/lib/clinical-formatters";

export const Route = createFileRoute("/")({
  component: PatientSearchPage,
});

function PatientSearchPage() {
  const [searchParams, setSearchParams] = useState<{
    family?: string;
    given?: string;
    birthdate?: string;
    identifier?: string;
  }>({});

  const { data, isLoading, isError, error } = usePatientSearch(searchParams);

  const patients: Patient[] =
    data?.entry?.map((e) => e.resource).filter((r): r is Patient => !!r) ?? [];

  const hasSearched = !!(
    searchParams.family ||
    searchParams.given ||
    searchParams.birthdate ||
    searchParams.identifier
  );

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <section>
        <h2 className="text-base font-semibold">Patient Search</h2>
        <p className="text-sm text-muted-foreground mt-0.5 mb-3">
          Search for patients by name, date of birth, or identifier
        </p>
        <PatientSearch onSearch={setSearchParams} />
      </section>

      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : "Failed to search patients"}
        </p>
      )}

      {(isLoading || (hasSearched && !isError)) && (
        <section className="border-t pt-4">
          <h2 className="text-base font-semibold mb-3">
            Results
            {!isLoading && data?.total !== undefined && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                (<span className="tabular">{data.total}</span> found)
              </span>
            )}
          </h2>
          <ClinicalTable
            loading={isLoading}
            keyExtractor={(p) => p.id ?? ""}
            columns={[
              {
                header: "Name",
                accessor: (p) => (
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
                accessor: (p) => formatClinicalDate(p.birthDate),
              },
              {
                header: "Age",
                accessor: (p) => calculateAge(p.birthDate),
              },
              {
                header: "Gender",
                accessor: (p) => (
                  <span className="capitalize">{p.gender ?? ""}</span>
                ),
              },
              {
                header: "Identifier",
                accessor: (p) => getPrimaryIdentifier(p.identifier) ?? "",
                className: "font-mono text-xs",
              },
              {
                header: "Last Updated",
                accessor: (p) => formatClinicalDate(p.meta?.lastUpdated),
              },
            ]}
            data={patients}
            emptyMessage="No patients found. Try adjusting your search criteria."
          />
        </section>
      )}

      {!hasSearched && !isLoading && (
        <p className="py-8 text-sm text-muted-foreground">
          Enter a name, date of birth, or identifier to find patients in the
          FHIR server.
        </p>
      )}
    </div>
  );
}
