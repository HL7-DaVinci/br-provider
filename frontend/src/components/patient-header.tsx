import type { Coverage, Patient } from "fhir/r4";
import { useCoverage, useOrganization } from "@/hooks/use-clinical-api";
import {
  calculateAge,
  formatClinicalDate,
  formatPatientName,
  getPrimaryIdentifier,
} from "@/lib/clinical-formatters";
import { CoverageInfo } from "./coverage-info.tsx";

interface PatientHeaderProps {
  patient: Patient;
  stats?: { conditions?: number; medications?: number; orders?: number };
}

export function PatientHeader({ patient, stats }: PatientHeaderProps) {
  const name = formatPatientName(patient.name);
  const dob = formatClinicalDate(patient.birthDate);
  const age = calculateAge(patient.birthDate);
  const mrn = getPrimaryIdentifier(patient.identifier);
  const today = new Date();
  const todayStr = today.toLocaleDateString();
  // Coverage details
  const patientId = typeof patient.id === "string" ? patient.id : "";
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
    stats?.conditions !== undefined && (
      <span key="conditions">
        <span className="tabular">{stats.conditions}</span> conditions
      </span>
    ),
    stats?.medications !== undefined && (
      <span key="medications">
        <span className="tabular">{stats.medications}</span> medications
      </span>
    ),
    stats?.orders !== undefined && (
      <span key="orders">
        <span className="tabular">{stats.orders}</span> orders
      </span>
    ),
  ].filter(Boolean);

  return (
    <div className="p-4 bg-card border-b">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold truncate">{name}</h1>
        <span className="text-sm text-muted-foreground">
          Today's Date : {todayStr}
        </span>
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
      {/* Coverage details */}
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
