import { Link } from "@tanstack/react-router";
import type { Coverage, Patient } from "fhir/r4";
import { Home } from "lucide-react";
import { useCoverage, useOrganization } from "@/hooks/use-clinical-api";
import {
  calculateAge,
  formatClinicalDate,
  formatPatientName,
  getPrimaryIdentifier,
} from "@/lib/clinical-formatters";
import { CoverageInfo } from "./coverage-info.tsx";

interface PatientSelfHeaderProps {
  patient: Patient;
}

export function PatientSelfHeader({ patient }: PatientSelfHeaderProps) {
  const name = formatPatientName(patient.name);
  const dob = formatClinicalDate(patient.birthDate);
  const age = calculateAge(patient.birthDate);
  const mrn = getPrimaryIdentifier(patient.identifier);
  const patientId = patient.id ?? "";

  const { data: coverageBundle, isLoading: coverageLoading } =
    useCoverage(patientId);
  const coverage = coverageBundle?.entry?.[0]?.resource as Coverage | undefined;
  const orgRef =
    coverage && Array.isArray(coverage?.payor) && coverage.payor[0]?.reference
      ? coverage.payor[0].reference
      : undefined;
  const orgId = orgRef ? orgRef.split("/")[1] : undefined;
  const { data: orgData, isLoading: orgLoading } = useOrganization(orgId);

  const meta = [
    dob && `DOB: ${dob}`,
    age && `Age: ${age}`,
    patient.gender &&
      patient.gender.charAt(0).toUpperCase() + patient.gender.slice(1),
    mrn && (
      <span key="mrn">
        MRN: <span className="tabular">{mrn}</span>
      </span>
    ),
  ].filter(Boolean);

  return (
    <div className="p-4 bg-card border-b">
      <div className="flex items-center gap-2">
        <Link
          to="/patient"
          className="text-muted-foreground hover:text-foreground"
        >
          <Home className="h-4 w-4" />
        </Link>
        <h1 className="text-lg font-semibold truncate">{name}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-y-1 text-sm text-muted-foreground mt-0.5">
        {meta.map((item, i) => (
          <span
            key={typeof item === "string" ? item : i}
            className="flex items-center"
          >
            {i > 0 && <span className="text-border mx-2">|</span>}
            {item}
          </span>
        ))}
      </div>
      <div className="mt-2 ml-0 text-sm text-primary font-normal flex items-center">
        <CoverageInfo
          coverage={coverage}
          coverageLoading={coverageLoading}
          orgLoading={orgLoading}
          orgData={orgData}
          orgId={orgId}
        />
      </div>
    </div>
  );
}
