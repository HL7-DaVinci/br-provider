import { useQuery } from "@tanstack/react-query";
import type { Bundle, Condition, MedicationRequest, Patient } from "fhir/r4";
import { fhirFetch } from "./use-fhir-api";
import { useFhirServer } from "./use-fhir-server";

interface PatientSearchParams {
  family?: string;
  given?: string;
  birthdate?: string;
  identifier?: string;
}

export function usePatientSearch(params: PatientSearchParams) {
  const { serverUrl } = useFhirServer();

  const searchParams = new URLSearchParams();
  searchParams.set("_count", "50");
  searchParams.set("_sort", "-_lastUpdated");

  if (params.family) searchParams.set("family", params.family);
  if (params.given) searchParams.set("given", params.given);
  if (params.birthdate) searchParams.set("birthdate", params.birthdate);
  if (params.identifier) searchParams.set("identifier", params.identifier);

  const hasSearchParams = !!(
    params.family ||
    params.given ||
    params.birthdate ||
    params.identifier
  );

  return useQuery({
    queryKey: ["fhir", "Patient", "search", serverUrl, params],
    queryFn: () =>
      fhirFetch<Bundle<Patient>>(
        `${serverUrl}/Patient?${searchParams.toString()}`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && hasSearchParams,
  });
}

export function usePatient(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Patient", patientId, serverUrl],
    queryFn: () => fhirFetch<Patient>(`${serverUrl}/Patient/${patientId}`),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useConditions(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<Condition>>(
        `${serverUrl}/Condition?patient=${patientId}&_sort=-recorded-date&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequests(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle<MedicationRequest>>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&_sort=-authoredon&_count=50`,
      ),
    staleTime: 30 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useConditionCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "Condition", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/Condition?patient=${patientId}&clinical-status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}

export function useMedicationRequestCount(patientId: string) {
  const { serverUrl } = useFhirServer();

  return useQuery({
    queryKey: ["fhir", "MedicationRequest", "count", patientId, serverUrl],
    queryFn: () =>
      fhirFetch<Bundle>(
        `${serverUrl}/MedicationRequest?patient=${patientId}&status=active&_summary=count`,
      ),
    staleTime: 60 * 1000,
    retry: 1,
    enabled: !!serverUrl && !!patientId,
  });
}
